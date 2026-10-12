import { createGuideFinancialDocumentView } from "./guideFinancialDocumentView.ts";
import { createSettlementDocumentSnapshot } from "../server/guideFinancialDocuments.ts";

const lines = Object.freeze([
  Object.freeze({
    importRowId: "123e4567-e89b-42d3-a456-426614174001",
    workDate: "2026-09-03",
    grossComYen: 22_000,
    dodoFeeYen: 2_200,
    guidePaymentYen: 19_800,
  }),
  Object.freeze({
    importRowId: "123e4567-e89b-42d3-a456-426614174002",
    workDate: "2026-09-12",
    grossComYen: 18_000,
    dodoFeeYen: 1_800,
    guidePaymentYen: 16_200,
  }),
  Object.freeze({
    importRowId: "123e4567-e89b-42d3-a456-426614174003",
    workDate: "2026-09-24",
    grossComYen: 14_000,
    dodoFeeYen: 1_400,
    guidePaymentYen: 12_600,
  }),
]);

/** Builds a validated fictional settlement without reading persistence. */
export function createGuideSettlementPreview() {
  const snapshot = createSettlementDocumentSnapshot({
    documentId: "123e4567-e89b-42d3-a456-426614174010",
    version: 1,
    settlementId: "123e4567-e89b-42d3-a456-426614174011",
    guideId: "123e4567-e89b-42d3-a456-426614174012",
    statementMonth: "2026-09",
    settlementStatus: "paid",
    confirmedAt: "2026-10-01T00:00:00.000Z",
    totals: {
      grossComYen: 54_000,
      dodoFeeYen: 5_400,
      adjustmentYen: 0,
      guidePaymentYen: 48_600,
    },
    lines,
  });
  return createGuideFinancialDocumentView(snapshot, {
    guideDisplayName: "サンプルガイド",
    issuerDisplayName: "DODO GUIDE OFFICE",
    issuedOn: "2026-10-02",
  });
}
