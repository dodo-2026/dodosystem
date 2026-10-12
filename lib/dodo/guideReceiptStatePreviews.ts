import {
  beginGuideReceiptAcknowledgement,
  completeGuideReceiptAcknowledgement,
  createGuideReceiptAcknowledgementFormState,
} from "./guideReceiptAcknowledgementForm.ts";

export type GuideReceiptStatePreviewKey =
  | "pending"
  | "acknowledged"
  | "retryable_error"
  | "void";

export type GuideReceiptStatePreview = Readonly<{
  key: GuideReceiptStatePreviewKey;
  label: string;
  message: string;
  actionLabel: string;
  requestEnabled: false;
}>;

const SUBMISSION_ID = "123e4567-e89b-42d3-a456-426614174099";

/** Derives fictional UI states from the real acknowledgement state model. */
export function createGuideReceiptStatePreviews(): readonly GuideReceiptStatePreview[] {
  const pending = createGuideReceiptAcknowledgementFormState({
    status: "pending",
    acknowledgedAt: null,
  });
  const acknowledged = createGuideReceiptAcknowledgementFormState({
    status: "acknowledged",
    acknowledgedAt: 1_759_377_600,
  });
  const retryable = completeGuideReceiptAcknowledgement(
    beginGuideReceiptAcknowledgement(pending, SUBMISSION_ID),
    SUBMISSION_ID,
    { ok: false, error: "temporarily_unavailable" }
  );
  const unavailable = createGuideReceiptAcknowledgementFormState({
    status: "void",
    acknowledgedAt: null,
  });

  return Object.freeze([
    Object.freeze({
      key: "pending",
      label: "未確認",
      message: pending.message,
      actionLabel: "受取内容を確認する",
      requestEnabled: false,
    }),
    Object.freeze({
      key: "acknowledged",
      label: "確認済み",
      message: acknowledged.message,
      actionLabel: "確認済み",
      requestEnabled: false,
    }),
    Object.freeze({
      key: "retryable_error",
      label: "一時エラー",
      message: retryable.message,
      actionLabel: "時間をおいて再試行",
      requestEnabled: false,
    }),
    Object.freeze({
      key: "void",
      label: "取消済み",
      message: unavailable.message,
      actionLabel: "操作できません",
      requestEnabled: false,
    }),
  ]);
}
