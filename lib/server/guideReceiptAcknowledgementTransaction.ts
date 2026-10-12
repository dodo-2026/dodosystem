import {
  acknowledgeGuideReceipt,
  type GuideReceiptAcknowledgementRecord,
} from "./guideReceiptAcknowledgement.ts";
import {
  createGuideReceiptAcknowledgementAuditRecord,
  fingerprintGuideReceiptAcknowledgementAuditRecord,
  type GuideReceiptAcknowledgementAuditRecord,
} from "./guideReceiptAcknowledgementAudit.ts";

export type GuideReceiptAcknowledgementTransaction = Readonly<{
  previous: GuideReceiptAcknowledgementRecord;
  next: GuideReceiptAcknowledgementRecord;
  audit: GuideReceiptAcknowledgementAuditRecord;
  auditFingerprint: string;
}>;

export type CommitGuideReceiptAcknowledgementTransaction = (
  transaction: GuideReceiptAcknowledgementTransaction
) => Promise<boolean>;

/**
 * Builds the acknowledgement update and its audit record as one persistence
 * unit. The injected adapter must atomically compare every `previous` field,
 * write `next`, and insert the unique audit event plus fingerprint. It must
 * return false without writing either item when any condition loses a race.
 */
export async function acknowledgeGuideReceiptWithAudit({
  sessionToken,
  documentId,
  loadReceipt,
  commitTransaction,
  verifySession,
  createEventId = () => crypto.randomUUID(),
  now,
}: {
  sessionToken: string | undefined;
  documentId: string;
  loadReceipt: (documentId: string) => Promise<GuideReceiptAcknowledgementRecord | null>;
  commitTransaction: CommitGuideReceiptAcknowledgementTransaction;
  verifySession?: (token: string | undefined) => Promise<string | null>;
  createEventId?: () => string;
  now?: number;
}): Promise<Readonly<{ acknowledged: false } | { acknowledged: true; acknowledgedAt: number }>> {
  return acknowledgeGuideReceipt({
    sessionToken,
    documentId,
    loadReceipt,
    commitAcknowledgement: async (previous, next) => {
      const audit = createGuideReceiptAcknowledgementAuditRecord({
        eventId: createEventId(),
        previous,
        next,
      });
      const auditFingerprint =
        await fingerprintGuideReceiptAcknowledgementAuditRecord(audit);
      return commitTransaction(Object.freeze({
        previous,
        next,
        audit,
        auditFingerprint,
      }));
    },
    ...(verifySession ? { verifySession } : {}),
    ...(now === undefined ? {} : { now }),
  });
}
