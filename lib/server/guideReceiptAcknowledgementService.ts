import {
  type GuideReceiptAcknowledgementRecord,
} from "./guideReceiptAcknowledgement.ts";
import {
  handleGuideReceiptAcknowledgementRequest,
  type GuideReceiptAcknowledgementHttpResponse,
} from "./guideReceiptAcknowledgementHttp.ts";
import {
  acknowledgeGuideReceiptWithAudit,
  type CommitGuideReceiptAcknowledgementTransaction,
} from "./guideReceiptAcknowledgementTransaction.ts";

/**
 * Composes the strict HTTP boundary with the one-time acknowledgement domain
 * operation. All persistence remains injected so this can be verified without
 * adding a public route or connecting a live database.
 */
export async function handlePersistedGuideReceiptAcknowledgementRequest({
  sessionToken,
  body,
  loadReceipt,
  commitTransaction,
  verifySession,
  createEventId,
  now,
  onPrivateError,
}: {
  sessionToken: string | undefined;
  body: unknown;
  loadReceipt: (documentId: string) => Promise<GuideReceiptAcknowledgementRecord | null>;
  commitTransaction: CommitGuideReceiptAcknowledgementTransaction;
  verifySession?: (token: string | undefined) => Promise<string | null>;
  createEventId?: () => string;
  now?: number;
  onPrivateError?: (event: "guide_receipt_acknowledgement_failed") => void;
}): Promise<GuideReceiptAcknowledgementHttpResponse> {
  return handleGuideReceiptAcknowledgementRequest({
    sessionToken,
    body,
    onPrivateError,
    acknowledge: ({ sessionToken: verifiedToken, documentId }) =>
      acknowledgeGuideReceiptWithAudit({
        sessionToken: verifiedToken,
        documentId,
        loadReceipt,
        commitTransaction,
        ...(verifySession ? { verifySession } : {}),
        ...(createEventId ? { createEventId } : {}),
        ...(now === undefined ? {} : { now }),
      }),
  });
}
