export type GuideReceiptAcknowledgementView = Readonly<{
  status: "pending" | "acknowledged" | "void";
  label: "未確認" | "確認済み" | "取消済み";
  detail: string;
  canAcknowledge: boolean;
}>;

function formatJapanTimestamp(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error("acknowledgedAt must be a non-negative safe integer timestamp.");
  }
  const date = new Date(timestamp * 1_000 + 9 * 60 * 60 * 1_000);
  if (Number.isNaN(date.getTime())) {
    throw new Error("acknowledgedAt is outside the supported date range.");
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

export function createGuideReceiptAcknowledgementView(input: Readonly<{
  status: "pending" | "acknowledged" | "void";
  acknowledgedAt: number | null;
}>): GuideReceiptAcknowledgementView {
  if (!input || typeof input !== "object") {
    throw new Error("Receipt acknowledgement state is required.");
  }
  if (input.status === "pending" && input.acknowledgedAt === null) {
    return Object.freeze({
      status: "pending",
      label: "未確認",
      detail: "ガイド本人の確認待ち",
      canAcknowledge: true,
    });
  }
  if (input.status === "acknowledged" && input.acknowledgedAt !== null) {
    return Object.freeze({
      status: "acknowledged",
      label: "確認済み",
      detail: `${formatJapanTimestamp(input.acknowledgedAt)}に確認`,
      canAcknowledge: false,
    });
  }
  if (input.status === "void" && input.acknowledgedAt === null) {
    return Object.freeze({
      status: "void",
      label: "取消済み",
      detail: "この受取書は無効です",
      canAcknowledge: false,
    });
  }
  throw new Error("Receipt acknowledgement state is inconsistent.");
}
