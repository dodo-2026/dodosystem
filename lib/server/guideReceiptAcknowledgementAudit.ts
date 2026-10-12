import {
  type GuideReceiptAcknowledgementRecord,
  normalizeGuideReceiptAcknowledgementRecord,
} from "./guideReceiptAcknowledgement.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AUDIT_KEYS = [
  "schemaVersion",
  "eventKind",
  "eventId",
  "documentId",
  "guideId",
  "receiptFingerprint",
  "acknowledgedAt",
] as const;

export type GuideReceiptAcknowledgementAuditRecord = Readonly<{
  schemaVersion: 1;
  eventKind: "receipt_acknowledged";
  eventId: string;
  documentId: string;
  guideId: string;
  receiptFingerprint: string;
  acknowledgedAt: number;
}>;

function normalizeAuditRecord(
  input: GuideReceiptAcknowledgementAuditRecord
): GuideReceiptAcknowledgementAuditRecord {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).length !== AUDIT_KEYS.length ||
    AUDIT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(input, key)) ||
    input.schemaVersion !== 1 ||
    input.eventKind !== "receipt_acknowledged" ||
    typeof input.eventId !== "string" ||
    !UUID_PATTERN.test(input.eventId) ||
    typeof input.documentId !== "string" ||
    !UUID_PATTERN.test(input.documentId) ||
    typeof input.guideId !== "string" ||
    !UUID_PATTERN.test(input.guideId) ||
    typeof input.receiptFingerprint !== "string" ||
    !SHA256_PATTERN.test(input.receiptFingerprint) ||
    !Number.isSafeInteger(input.acknowledgedAt) ||
    input.acknowledgedAt < 0
  ) {
    throw new Error("Receipt acknowledgement audit record is malformed.");
  }

  return Object.freeze({
    schemaVersion: 1,
    eventKind: "receipt_acknowledged",
    eventId: input.eventId.toLowerCase(),
    documentId: input.documentId.toLowerCase(),
    guideId: input.guideId.toLowerCase(),
    receiptFingerprint: input.receiptFingerprint,
    acknowledgedAt: input.acknowledgedAt,
  });
}

export function createGuideReceiptAcknowledgementAuditRecord({
  eventId,
  previous,
  next,
}: {
  eventId: string;
  previous: GuideReceiptAcknowledgementRecord;
  next: GuideReceiptAcknowledgementRecord;
}): GuideReceiptAcknowledgementAuditRecord {
  if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) {
    throw new Error("eventId must be a UUID.");
  }
  const normalizedPrevious = normalizeGuideReceiptAcknowledgementRecord(previous);
  const normalizedNext = normalizeGuideReceiptAcknowledgementRecord(next);

  if (
    normalizedPrevious.documentStatus !== "final" ||
    normalizedPrevious.acknowledgementStatus !== "pending" ||
    normalizedPrevious.acknowledgedAt !== null ||
    normalizedNext.documentStatus !== "final" ||
    normalizedNext.acknowledgementStatus !== "acknowledged" ||
    normalizedNext.acknowledgedAt === null ||
    normalizedPrevious.documentId !== normalizedNext.documentId ||
    normalizedPrevious.guideId !== normalizedNext.guideId ||
    normalizedPrevious.receiptFingerprint !== normalizedNext.receiptFingerprint
  ) {
    throw new Error("Audit record requires one exact pending-to-acknowledged transition.");
  }

  return normalizeAuditRecord({
    schemaVersion: 1,
    eventKind: "receipt_acknowledged",
    eventId,
    documentId: normalizedNext.documentId,
    guideId: normalizedNext.guideId,
    receiptFingerprint: normalizedNext.receiptFingerprint,
    acknowledgedAt: normalizedNext.acknowledgedAt,
  });
}

export async function fingerprintGuideReceiptAcknowledgementAuditRecord(
  input: GuideReceiptAcknowledgementAuditRecord
): Promise<string> {
  const record = normalizeAuditRecord(input);
  const canonicalJson = JSON.stringify({
    schemaVersion: record.schemaVersion,
    eventKind: record.eventKind,
    eventId: record.eventId,
    documentId: record.documentId,
    guideId: record.guideId,
    receiptFingerprint: record.receiptFingerprint,
    acknowledgedAt: record.acknowledgedAt,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function verifyGuideReceiptAcknowledgementAuditFingerprint(
  record: GuideReceiptAcknowledgementAuditRecord,
  expectedFingerprint: string
): Promise<boolean> {
  if (
    typeof expectedFingerprint !== "string" ||
    !SHA256_PATTERN.test(expectedFingerprint)
  ) {
    return false;
  }
  try {
    return (
      (await fingerprintGuideReceiptAcknowledgementAuditRecord(record)) ===
      expectedFingerprint
    );
  } catch {
    return false;
  }
}
