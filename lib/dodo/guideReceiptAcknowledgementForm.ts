import type { GuideReceiptAcknowledgementResponseBody } from "../server/guideReceiptAcknowledgementHttp.ts";
import { createGuideReceiptAcknowledgementView } from "./guideReceiptAcknowledgementView.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GuideReceiptAcknowledgementFormState = Readonly<
  | {
      phase: "ready";
      message: "受取内容を確認してください";
      canSubmit: true;
    }
  | {
      phase: "submitting";
      submissionId: string;
      message: "確認を記録しています";
      canSubmit: false;
    }
  | {
      phase: "acknowledged";
      message: string;
      canSubmit: false;
    }
  | {
      phase: "unavailable";
      message: "現在この受取書を確認できません。画面を再読み込みしてください";
      canSubmit: false;
    }
  | {
      phase: "retryable_error";
      message: "確認を記録できませんでした。時間をおいて再度お試しください";
      canSubmit: true;
    }
>;

function normalizeSubmissionId(submissionId: string): string {
  if (typeof submissionId !== "string" || !UUID_PATTERN.test(submissionId)) {
    throw new Error("submissionId must be a valid UUID.");
  }
  return submissionId.toLowerCase();
}

export function createGuideReceiptAcknowledgementFormState(input: Readonly<{
  status: "pending" | "acknowledged" | "void";
  acknowledgedAt: number | null;
}>): GuideReceiptAcknowledgementFormState {
  const view = createGuideReceiptAcknowledgementView(input);
  if (view.status === "pending") {
    return Object.freeze({
      phase: "ready",
      message: "受取内容を確認してください",
      canSubmit: true,
    });
  }
  if (view.status === "acknowledged") {
    return Object.freeze({
      phase: "acknowledged",
      message: view.detail,
      canSubmit: false,
    });
  }
  return Object.freeze({
    phase: "unavailable",
    message: "現在この受取書を確認できません。画面を再読み込みしてください",
    canSubmit: false,
  });
}

export function beginGuideReceiptAcknowledgement(
  state: GuideReceiptAcknowledgementFormState,
  submissionId: string
): GuideReceiptAcknowledgementFormState {
  const normalizedSubmissionId = normalizeSubmissionId(submissionId);
  if (!state.canSubmit) return state;
  return Object.freeze({
    phase: "submitting",
    submissionId: normalizedSubmissionId,
    message: "確認を記録しています",
    canSubmit: false,
  });
}

export function completeGuideReceiptAcknowledgement(
  state: GuideReceiptAcknowledgementFormState,
  submissionId: string,
  result: GuideReceiptAcknowledgementResponseBody
): GuideReceiptAcknowledgementFormState {
  const normalizedSubmissionId = normalizeSubmissionId(submissionId);
  if (state.phase !== "submitting" || state.submissionId !== normalizedSubmissionId) {
    return state;
  }
  if (result.ok) {
    const view = createGuideReceiptAcknowledgementView({
      status: "acknowledged",
      acknowledgedAt: result.acknowledgedAt,
    });
    return Object.freeze({
      phase: "acknowledged",
      message: view.detail,
      canSubmit: false,
    });
  }
  if (result.error === "temporarily_unavailable") {
    return Object.freeze({
      phase: "retryable_error",
      message: "確認を記録できませんでした。時間をおいて再度お試しください",
      canSubmit: true,
    });
  }
  return Object.freeze({
    phase: "unavailable",
    message: "現在この受取書を確認できません。画面を再読み込みしてください",
    canSubmit: false,
  });
}
