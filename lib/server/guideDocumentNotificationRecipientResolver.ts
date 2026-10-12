import type { GuideDocumentNotificationRecipient } from "./guideDocumentReadyNotificationDispatch.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^guide-document-ready:[0-9a-f]{64}$/;
const RECIPIENT_HANDLE_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

type Binding = Readonly<{
  idempotencyKey: string;
  documentId: string;
  guideId: string;
  documentVersion: number;
}>;

type OwnedDocument = Readonly<{
  documentId: string;
  guideId: string;
  version: number;
  status: "draft" | "final" | "void";
}>;

type RecipientRecord = Readonly<{
  guideId: string;
  status: "active" | "disabled";
  recipient: GuideDocumentNotificationRecipient;
}>;

export type GuideDocumentNotificationRecipientResolution = Readonly<
  | { resolved: false }
  | { resolved: true; recipient: GuideDocumentNotificationRecipient }
>;

const UNRESOLVED: GuideDocumentNotificationRecipientResolution = Object.freeze({
  resolved: false,
});

function exactKeys(value: object, expected: string): boolean {
  return Object.keys(value).sort().join(",") === expected;
}

function normalizeUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${field} is malformed.`);
  }
  return value.toLowerCase();
}

function normalizeVersion(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} is malformed.`);
  }
  return value as number;
}

function normalizeBinding(value: unknown): Binding {
  if (!value || typeof value !== "object" || !exactKeys(
    value,
    "documentId,documentVersion,guideId,idempotencyKey"
  )) {
    throw new Error("Notification binding is malformed.");
  }
  const binding = value as Record<string, unknown>;
  if (
    typeof binding.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY_PATTERN.test(binding.idempotencyKey)
  ) {
    throw new Error("Notification binding key is malformed.");
  }
  return Object.freeze({
    idempotencyKey: binding.idempotencyKey,
    documentId: normalizeUuid(binding.documentId, "documentId"),
    guideId: normalizeUuid(binding.guideId, "guideId"),
    documentVersion: normalizeVersion(binding.documentVersion, "documentVersion"),
  });
}

function normalizeDocument(value: unknown): OwnedDocument {
  if (!value || typeof value !== "object" || !exactKeys(
    value,
    "documentId,guideId,status,version"
  )) {
    throw new Error("Notification document is malformed.");
  }
  const document = value as Record<string, unknown>;
  if (!new Set(["draft", "final", "void"]).has(document.status as string)) {
    throw new Error("Notification document status is malformed.");
  }
  return Object.freeze({
    documentId: normalizeUuid(document.documentId, "documentId"),
    guideId: normalizeUuid(document.guideId, "guideId"),
    version: normalizeVersion(document.version, "version"),
    status: document.status as OwnedDocument["status"],
  });
}

function normalizeRecipientRecord(value: unknown): RecipientRecord {
  if (!value || typeof value !== "object" || !exactKeys(
    value,
    "guideId,recipient,status"
  )) {
    throw new Error("Notification recipient record is malformed.");
  }
  const record = value as Record<string, unknown>;
  if (record.status !== "active" && record.status !== "disabled") {
    throw new Error("Notification recipient status is malformed.");
  }
  const recipient = record.recipient;
  if (
    !recipient ||
    typeof recipient !== "object" ||
    !exactKeys(recipient, "handle,kind")
  ) {
    throw new Error("Notification recipient is malformed.");
  }
  const candidate = recipient as Record<string, unknown>;
  if (
    candidate.kind !== "provider-user-v1" ||
    typeof candidate.handle !== "string" ||
    !RECIPIENT_HANDLE_PATTERN.test(candidate.handle)
  ) {
    throw new Error("Notification recipient is malformed.");
  }
  return Object.freeze({
    guideId: normalizeUuid(record.guideId, "guideId"),
    status: record.status,
    recipient: Object.freeze({
      kind: "provider-user-v1",
      handle: candidate.handle,
    }),
  });
}

function reportPrivateFailure(onPrivateError: (() => void) | undefined): void {
  try {
    onPrivateError?.();
  } catch {
    // Observability must not change the fixed outward result.
  }
}

/**
 * Resolves one private provider recipient only after the notification binding,
 * final document ownership and guide recipient record agree exactly.
 *
 * All readers are injected. This module adds no route, live database access,
 * provider adapter, secret, or external send.
 */
export async function resolveGuideDocumentNotificationRecipient({
  idempotencyKey,
  loadBinding,
  loadDocument,
  loadRecipient,
  onPrivateError,
}: {
  idempotencyKey: string;
  loadBinding: (idempotencyKey: string) => Promise<unknown>;
  loadDocument: (documentId: string) => Promise<unknown>;
  loadRecipient: (guideId: string) => Promise<unknown>;
  onPrivateError?: () => void;
}): Promise<GuideDocumentNotificationRecipientResolution> {
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return UNRESOLVED;
  }

  try {
    const bindingInput = await loadBinding(idempotencyKey);
    if (bindingInput === null) return UNRESOLVED;
    const binding = normalizeBinding(bindingInput);
    if (binding.idempotencyKey !== idempotencyKey) return UNRESOLVED;

    const documentInput = await loadDocument(binding.documentId);
    if (documentInput === null) return UNRESOLVED;
    const document = normalizeDocument(documentInput);
    if (
      document.documentId !== binding.documentId ||
      document.guideId !== binding.guideId ||
      document.version !== binding.documentVersion ||
      document.status !== "final"
    ) {
      return UNRESOLVED;
    }

    const recipientInput = await loadRecipient(binding.guideId);
    if (recipientInput === null) return UNRESOLVED;
    const recipientRecord = normalizeRecipientRecord(recipientInput);
    if (
      recipientRecord.guideId !== binding.guideId ||
      recipientRecord.status !== "active"
    ) {
      return UNRESOLVED;
    }

    return Object.freeze({
      resolved: true,
      recipient: recipientRecord.recipient,
    });
  } catch {
    reportPrivateFailure(onPrivateError);
    return UNRESOLVED;
  }
}
