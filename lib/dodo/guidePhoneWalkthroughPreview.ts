import {
  attemptGuidePhoneChallenge,
  createGuidePhoneChallengeState,
  getGuidePhoneChallengeStatus,
  type GuidePhoneChallengeStatus,
} from "./guidePhoneChallenge.ts";
import { GUIDE_PHONE_CODE_MAX_ATTEMPTS } from "./guidePortal.ts";

export type GuidePhoneWalkthroughPreviewKey =
  | "phone_entry"
  | "code_entry"
  | "invalid_code"
  | "verified"
  | "expired"
  | "locked";

export type GuidePhoneWalkthroughPreview = Readonly<{
  key: GuidePhoneWalkthroughPreviewKey;
  label: string;
  phase: "not_started" | "invalid_code" | GuidePhoneChallengeStatus;
  title: string;
  description: string;
  fieldLabel: string;
  fieldValue: string;
  actionLabel: string;
  requestEnabled: false;
}>;

const PREVIEW_CREATED_AT = 2_000_000_000;

function challengeStatus(now: number, failedAttempts = 0): GuidePhoneChallengeStatus {
  const state = createGuidePhoneChallengeState(PREVIEW_CREATED_AT);
  return getGuidePhoneChallengeStatus({ ...state, failedAttempts }, now);
}

function invalidCodePhase(): "invalid_code" {
  const result = attemptGuidePhoneChallenge({
    state: createGuidePhoneChallengeState(PREVIEW_CREATED_AT),
    codeMatches: false,
    now: PREVIEW_CREATED_AT + 60,
  });
  if (result.reason !== "invalid_code") {
    throw new Error("Expected the fictional challenge to reject an invalid code.");
  }
  return result.reason;
}

function consumedChallengeStatus(): "consumed" {
  const accepted = attemptGuidePhoneChallenge({
    state: createGuidePhoneChallengeState(PREVIEW_CREATED_AT),
    codeMatches: true,
    now: PREVIEW_CREATED_AT + 60,
  });
  if (!accepted.accepted) throw new Error("Expected the fictional challenge to be accepted.");
  const status = getGuidePhoneChallengeStatus(accepted.state, PREVIEW_CREATED_AT + 61);
  if (status !== "consumed") {
    throw new Error("Expected the accepted fictional challenge to be consumed.");
  }
  return status;
}

/** Returns fictional, request-free states for reviewing the phone UI locally. */
export function createGuidePhoneWalkthroughPreviews(): readonly GuidePhoneWalkthroughPreview[] {
  return Object.freeze([
    Object.freeze({
      key: "phone_entry",
      label: "携帯番号入力",
      phase: "not_started",
      title: "登録済みの携帯番号を入力",
      description: "DODOへ登録した本人の携帯番号を使う画面です。",
      fieldLabel: "携帯番号",
      fieldValue: "090-XXXX-XXXX",
      actionLabel: "認証コードを受け取る",
      requestEnabled: false,
    }),
    Object.freeze({
      key: "code_entry",
      label: "コード入力",
      phase: challengeStatus(PREVIEW_CREATED_AT + 60),
      title: "6桁の認証コードを入力",
      description: "コードは10分間だけ有効です。",
      fieldLabel: "認証コード",
      fieldValue: "••••••",
      actionLabel: "本人確認を続ける",
      requestEnabled: false,
    }),
    Object.freeze({
      key: "invalid_code",
      label: "コード不一致",
      phase: invalidCodePhase(),
      title: "認証コードを確認してください",
      description: "入力に誤りがある場合も、有効期限内なら安全にやり直せます。",
      fieldLabel: "認証コード",
      fieldValue: "入力内容を確認してください",
      actionLabel: "もう一度入力する",
      requestEnabled: false,
    }),
    Object.freeze({
      key: "verified",
      label: "確認完了",
      phase: consumedChallengeStatus(),
      title: "本人確認が完了しました",
      description: "確認済みの認証コードは消費され、同じコードは再利用できません。",
      fieldLabel: "本人確認",
      fieldValue: "完了・コード再利用不可",
      actionLabel: "書類一覧へ進む（表示のみ）",
      requestEnabled: false,
    }),
    Object.freeze({
      key: "expired",
      label: "期限切れ",
      phase: challengeStatus(PREVIEW_CREATED_AT + 600),
      title: "認証コードの期限が切れました",
      description: "古いコードを受け付けず、新しいコードの発行へ戻す状態です。",
      fieldLabel: "認証コード",
      fieldValue: "期限切れ",
      actionLabel: "新しいコードを受け取る",
      requestEnabled: false,
    }),
    Object.freeze({
      key: "locked",
      label: "入力停止",
      phase: challengeStatus(PREVIEW_CREATED_AT + 60, GUIDE_PHONE_CODE_MAX_ATTEMPTS),
      title: "安全のため入力を停止しました",
      description: "連続5回失敗した場合は、コード入力を止めて事務局確認へ切り替えます。",
      fieldLabel: "認証コード",
      fieldValue: "入力停止中",
      actionLabel: "事務局へ確認する",
      requestEnabled: false,
    }),
  ]);
}
