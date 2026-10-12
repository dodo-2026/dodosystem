import type { GuideDocumentReadyNotificationPayload } from "./guideDocumentReadyNotificationPolicy.ts";
import type { GuideDocumentNotificationProviderRequest } from "./guideDocumentReadyNotificationWorker.ts";

const IDEMPOTENCY_KEY_PATTERN = /^guide-document-ready:[0-9a-f]{64}$/;
const RECIPIENT_HANDLE_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const OUTCOMES = ["delivered", "temporary_failure", "permanent_failure"] as const;

type ProviderOutcome = (typeof OUTCOMES)[number];

export type GuideDocumentNotificationRecipient = Readonly<{
  kind: "provider-user-v1";
  handle: string;
}>;

export type GuideDocumentNotificationAdapterRequest = Readonly<{
  idempotencyKey: string;
  recipient: GuideDocumentNotificationRecipient;
  payload: GuideDocumentReadyNotificationPayload;
}>;

export type GuideDocumentNotificationAdapter = Readonly<{
  getCapabilities: () => Promise<unknown>;
  send: (request: GuideDocumentNotificationAdapterRequest) => Promise<unknown>;
}>;

function normalizePayload(
  input: GuideDocumentReadyNotificationPayload
): GuideDocumentReadyNotificationPayload {
  const keys = input && typeof input === "object" ? Object.keys(input).sort() : [];
  if (
    keys.join(",") !== "actionLabel,body,event,schemaVersion,title" ||
    input.schemaVersion !== 1 ||
    input.event !== "guide.document-ready" ||
    input.title !== "書類の準備ができました" ||
    input.body !== "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。" ||
    input.actionLabel !== "DODOで確認する"
  ) {
    throw new Error("Notification payload is outside the public allowlist.");
  }
  return Object.freeze({ ...input });
}

export function normalizeGuideDocumentNotificationProviderRequest(
  input: GuideDocumentNotificationProviderRequest
): GuideDocumentNotificationProviderRequest {
  const keys = input && typeof input === "object" ? Object.keys(input).sort() : [];
  if (
    keys.join(",") !== "idempotencyKey,payload" ||
    !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
  ) {
    throw new Error("Notification provider request is malformed.");
  }
  return Object.freeze({
    idempotencyKey: input.idempotencyKey,
    payload: normalizePayload(input.payload),
  });
}

function normalizeRecipient(input: GuideDocumentNotificationRecipient) {
  const keys = input && typeof input === "object" ? Object.keys(input).sort() : [];
  if (
    keys.join(",") !== "handle,kind" ||
    input.kind !== "provider-user-v1" ||
    !RECIPIENT_HANDLE_PATTERN.test(input.handle)
  ) {
    throw new Error("Notification recipient is malformed.");
  }
  return Object.freeze({ kind: input.kind, handle: input.handle });
}

function supportsRequiredIdempotency(value: unknown): boolean {
  try {
    const keys = value && typeof value === "object" ? Object.keys(value).sort() : [];
    const capabilities = value as {
      idempotencyMode?: unknown;
      requestSchemaVersion?: unknown;
    } | null;
    return (
      keys.join(",") === "idempotencyMode,requestSchemaVersion" &&
      capabilities?.idempotencyMode === "provider-key-v1" &&
      capabilities.requestSchemaVersion === 1
    );
  } catch {
    return false;
  }
}

function normalizeOutcome(value: unknown): ProviderOutcome {
  try {
    const keys = value && typeof value === "object" ? Object.keys(value).sort() : [];
    const outcome = (value as { outcome?: unknown } | null)?.outcome;
    if (keys.join(",") === "outcome" && OUTCOMES.includes(outcome as ProviderOutcome)) {
      return outcome as ProviderOutcome;
    }
  } catch {
    // A hostile provider result is a generic temporary failure.
  }
  return "temporary_failure";
}

function reportPrivateFailure(onPrivateError: (() => void) | undefined): void {
  try {
    onPrivateError?.();
  } catch {
    // Observability must not alter the fixed result.
  }
}

/**
 * Validates a private recipient separately from the fixed public payload and
 * dispatches only through an adapter that declares provider-key idempotency.
 *
 * This module contains no live adapter, recipient lookup, route, or secret.
 */
export async function dispatchGuideDocumentReadyNotification({
  recipient,
  request,
  adapter,
  onPrivateError,
}: {
  recipient: GuideDocumentNotificationRecipient;
  request: GuideDocumentNotificationProviderRequest;
  adapter: GuideDocumentNotificationAdapter;
  onPrivateError?: () => void;
}): Promise<Readonly<{ outcome: ProviderOutcome }>> {
  let normalizedRecipient: GuideDocumentNotificationRecipient;
  let normalizedRequest: GuideDocumentNotificationProviderRequest;
  try {
    normalizedRecipient = normalizeRecipient(recipient);
    normalizedRequest = normalizeGuideDocumentNotificationProviderRequest(request);
  } catch {
    reportPrivateFailure(onPrivateError);
    return Object.freeze({ outcome: "permanent_failure" });
  }

  try {
    const capabilities = await adapter.getCapabilities();
    if (!supportsRequiredIdempotency(capabilities)) {
      reportPrivateFailure(onPrivateError);
      return Object.freeze({ outcome: "temporary_failure" });
    }

    const result = await adapter.send(
      Object.freeze({
        idempotencyKey: normalizedRequest.idempotencyKey,
        recipient: normalizedRecipient,
        payload: normalizedRequest.payload,
      })
    );
    const outcome = normalizeOutcome(result);
    return Object.freeze({ outcome });
  } catch {
    reportPrivateFailure(onPrivateError);
    return Object.freeze({ outcome: "temporary_failure" });
  }
}
