import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export type GuideDocumentReadyRecord = Readonly<{
  documentId: string;
  guideId: string;
  documentStatus: "draft" | "final" | "void";
  version: number;
  contentFingerprint: string;
}>;

export type GuideDocumentReadyNotificationPayload = Readonly<{
  schemaVersion: 1;
  event: "guide.document-ready";
  title: "書類の準備ができました";
  body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。";
  actionLabel: "DODOで確認する";
}>;

export type GuideDocumentReadyNotificationClaim = Readonly<{
  idempotencyKey: string;
  documentId: string;
  guideId: string;
  documentVersion: number;
}>;

export type GuideDocumentReadyNotificationDecision = Readonly<
  | { allowed: false }
  | {
      allowed: true;
      idempotencyKey: string;
      payload: GuideDocumentReadyNotificationPayload;
    }
>;

const DENIED: GuideDocumentReadyNotificationDecision = Object.freeze({ allowed: false });
const PAYLOAD: GuideDocumentReadyNotificationPayload = Object.freeze({
  schemaVersion: 1,
  event: "guide.document-ready",
  title: "書類の準備ができました",
  body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
  actionLabel: "DODOで確認する",
});

function normalizeRecord(input: GuideDocumentReadyRecord): GuideDocumentReadyRecord {
  if (
    !input ||
    typeof input !== "object" ||
    !UUID_PATTERN.test(input.documentId) ||
    !UUID_PATTERN.test(input.guideId) ||
    !["draft", "final", "void"].includes(input.documentStatus) ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    !SHA256_PATTERN.test(input.contentFingerprint)
  ) {
    throw new Error("Document-ready notification record is malformed.");
  }
  return Object.freeze({
    ...input,
    documentId: input.documentId.toLowerCase(),
    guideId: input.guideId.toLowerCase(),
    contentFingerprint: input.contentFingerprint.toLowerCase(),
  });
}

function createIdempotencyKey(record: GuideDocumentReadyRecord): string {
  const digest = createHash("sha256")
    .update(`${record.documentId}:${record.version}:${record.contentFingerprint}`, "utf8")
    .digest("hex");
  return `guide-document-ready:${digest}`;
}

/**
 * Prepares one minimal provider-neutral notification after identity and
 * ownership checks. The injected claim must atomically accept a key once.
 * This module exposes no route and performs no database write or external send.
 */
export async function prepareGuideDocumentReadyNotification({
  verifiedGuideId,
  document,
  claimIdempotencyKey,
}: {
  verifiedGuideId: string | null;
  document: GuideDocumentReadyRecord;
  claimIdempotencyKey: (claim: GuideDocumentReadyNotificationClaim) => Promise<boolean>;
}): Promise<GuideDocumentReadyNotificationDecision> {
  if (!verifiedGuideId || !UUID_PATTERN.test(verifiedGuideId)) return DENIED;

  const record = normalizeRecord(document);
  if (
    record.guideId !== verifiedGuideId.toLowerCase() ||
    record.documentStatus !== "final"
  ) {
    return DENIED;
  }

  const idempotencyKey = createIdempotencyKey(record);
  const claimed = await claimIdempotencyKey(
    Object.freeze({
      idempotencyKey,
      documentId: record.documentId,
      guideId: record.guideId,
      documentVersion: record.version,
    })
  );
  if (claimed !== true) return DENIED;

  return Object.freeze({ allowed: true, idempotencyKey, payload: PAYLOAD });
}
