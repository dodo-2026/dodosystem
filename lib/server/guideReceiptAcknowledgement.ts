import {
  normalizeGuideSessionGuideId,
  verifyGuideSession,
} from "./guideSession.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type GuideReceiptAcknowledgementRecord = Readonly<{
  documentId: string;
  guideId: string;
  documentStatus: "draft" | "final" | "void";
  acknowledgementStatus: "pending" | "acknowledged" | "void";
  receiptFingerprint: string;
  acknowledgedAt: number | null;
}>;

type VerifySession = (token: string | undefined) => Promise<string | null>;

export function normalizeGuideReceiptAcknowledgementRecord(
  input: GuideReceiptAcknowledgementRecord
): GuideReceiptAcknowledgementRecord {
  if (
    !input ||
    typeof input !== "object" ||
    !UUID_PATTERN.test(input.documentId) ||
    !UUID_PATTERN.test(input.guideId) ||
    !["draft", "final", "void"].includes(input.documentStatus) ||
    !["pending", "acknowledged", "void"].includes(input.acknowledgementStatus) ||
    !SHA256_PATTERN.test(input.receiptFingerprint) ||
    (input.acknowledgedAt !== null &&
      (!Number.isSafeInteger(input.acknowledgedAt) || input.acknowledgedAt < 0)) ||
    (input.acknowledgementStatus === "acknowledged") !== (input.acknowledgedAt !== null)
  ) {
    throw new Error("Loaded receipt acknowledgement record is malformed.");
  }
  return Object.freeze({
    ...input,
    documentId: input.documentId.toLowerCase(),
    guideId: input.guideId.toLowerCase(),
  });
}

/**
 * Records one guide confirmation for one final receipt. The injected commit
 * must compare the complete previous state atomically; a concurrent winner
 * makes every other request fail without claiming acknowledgement.
 */
export async function acknowledgeGuideReceipt({
  sessionToken,
  documentId,
  loadReceipt,
  commitAcknowledgement,
  verifySession = verifyGuideSession,
  now = Math.floor(Date.now() / 1000),
}: {
  sessionToken: string | undefined;
  documentId: string;
  loadReceipt: (documentId: string) => Promise<GuideReceiptAcknowledgementRecord | null>;
  commitAcknowledgement: (
    previous: GuideReceiptAcknowledgementRecord,
    next: GuideReceiptAcknowledgementRecord
  ) => Promise<boolean>;
  verifySession?: VerifySession;
  now?: number;
}): Promise<Readonly<{ acknowledged: false } | { acknowledged: true; acknowledgedAt: number }>> {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer timestamp.");
  }
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    return Object.freeze({ acknowledged: false });
  }
  const verifiedGuideId = await verifySession(sessionToken);
  if (!verifiedGuideId) return Object.freeze({ acknowledged: false });
  const sessionGuideId = normalizeGuideSessionGuideId(verifiedGuideId);
  const loaded = await loadReceipt(documentId.toLowerCase());
  if (!loaded) return Object.freeze({ acknowledged: false });
  const previous = normalizeGuideReceiptAcknowledgementRecord(loaded);
  if (
    previous.documentId !== documentId.toLowerCase() ||
    previous.guideId !== sessionGuideId ||
    previous.documentStatus !== "final" ||
    previous.acknowledgementStatus !== "pending"
  ) {
    return Object.freeze({ acknowledged: false });
  }

  const next = Object.freeze({
    ...previous,
    acknowledgementStatus: "acknowledged" as const,
    acknowledgedAt: now,
  });
  const committed = await commitAcknowledgement(previous, next);
  return committed
    ? Object.freeze({ acknowledged: true, acknowledgedAt: now })
    : Object.freeze({ acknowledged: false });
}
