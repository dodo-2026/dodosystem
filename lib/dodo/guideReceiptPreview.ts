export type GuideReceiptPreview = Readonly<{
  previewLabel: "架空データ・表示確認専用";
  documentId: string;
  title: "受取書";
  guideName: string;
  statementMonth: string;
  amountLabel: string;
  paidOnLabel: string;
  settlementReference: string;
  status: "pending";
  acknowledgedAt: null;
  persistenceEnabled: false;
  notificationEnabled: false;
}>;

/** Returns a deterministic, request-free receipt used only for local UI review. */
export function createGuideReceiptPreview(): GuideReceiptPreview {
  return Object.freeze({
    previewLabel: "架空データ・表示確認専用",
    documentId: "423e4567-e89b-42d3-a456-426614174000",
    title: "受取書",
    guideName: "サンプルガイド",
    statementMonth: "2026年9月分",
    amountLabel: "¥48,600",
    paidOnLabel: "2026年10月2日",
    settlementReference: "DODO-202609-S-12345678",
    status: "pending",
    acknowledgedAt: null,
    persistenceEnabled: false,
    notificationEnabled: false,
  });
}
