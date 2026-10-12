import {
  GUIDE_PHONE_CODE_MAX_ATTEMPTS,
  GUIDE_PHONE_CODE_TTL_SECONDS,
} from "./guidePortal.ts";

export type GuidePhoneChallengeState = {
  createdAt: number;
  expiresAt: number;
  failedAttempts: number;
  consumedAt: number | null;
};

export type GuidePhoneChallengeStatus =
  | "pending"
  | "consumed"
  | "expired"
  | "locked";

export type GuidePhoneChallengeAttemptResult =
  | {
      accepted: true;
      reason: "accepted";
      state: GuidePhoneChallengeState;
    }
  | {
      accepted: false;
      reason: "invalid_code" | "consumed" | "expired" | "locked";
      state: GuidePhoneChallengeState;
    };

function requireSafeTimestamp(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer timestamp.`);
  }
}

function validateChallengeState(state: GuidePhoneChallengeState) {
  requireSafeTimestamp(state.createdAt, "createdAt");
  requireSafeTimestamp(state.expiresAt, "expiresAt");

  if (state.expiresAt <= state.createdAt) {
    throw new Error("expiresAt must be later than createdAt.");
  }
  if (
    !Number.isSafeInteger(state.failedAttempts) ||
    state.failedAttempts < 0 ||
    state.failedAttempts > GUIDE_PHONE_CODE_MAX_ATTEMPTS
  ) {
    throw new Error("failedAttempts is outside the allowed range.");
  }
  if (state.consumedAt !== null) {
    requireSafeTimestamp(state.consumedAt, "consumedAt");
    if (state.consumedAt < state.createdAt || state.consumedAt >= state.expiresAt) {
      throw new Error("consumedAt must fall within the challenge lifetime.");
    }
  }
}

export function createGuidePhoneChallengeState(
  now = Math.floor(Date.now() / 1000)
): GuidePhoneChallengeState {
  requireSafeTimestamp(now, "now");
  const expiresAt = now + GUIDE_PHONE_CODE_TTL_SECONDS;
  requireSafeTimestamp(expiresAt, "expiresAt");

  return {
    createdAt: now,
    expiresAt,
    failedAttempts: 0,
    consumedAt: null,
  };
}

export function getGuidePhoneChallengeStatus(
  state: GuidePhoneChallengeState,
  now = Math.floor(Date.now() / 1000)
): GuidePhoneChallengeStatus {
  validateChallengeState(state);
  requireSafeTimestamp(now, "now");
  if (now < state.createdAt) {
    throw new Error("now must not be earlier than createdAt.");
  }

  if (state.consumedAt !== null) return "consumed";
  if (state.failedAttempts >= GUIDE_PHONE_CODE_MAX_ATTEMPTS) return "locked";
  if (now >= state.expiresAt) return "expired";
  return "pending";
}

/**
 * Advances the verification state after a server-side, constant-time code
 * comparison. The raw SMS code is deliberately not accepted or stored here.
 */
export function attemptGuidePhoneChallenge({
  state,
  codeMatches,
  now = Math.floor(Date.now() / 1000),
}: {
  state: GuidePhoneChallengeState;
  codeMatches: boolean;
  now?: number;
}): GuidePhoneChallengeAttemptResult {
  if (typeof codeMatches !== "boolean") {
    throw new Error("codeMatches must be a boolean.");
  }
  const status = getGuidePhoneChallengeStatus(state, now);

  if (status !== "pending") {
    return {
      accepted: false,
      reason: status,
      state: { ...state },
    };
  }

  if (codeMatches) {
    return {
      accepted: true,
      reason: "accepted",
      state: { ...state, consumedAt: now },
    };
  }

  const failedAttempts = state.failedAttempts + 1;
  return {
    accepted: false,
    reason:
      failedAttempts >= GUIDE_PHONE_CODE_MAX_ATTEMPTS
        ? "locked"
        : "invalid_code",
    state: { ...state, failedAttempts },
  };
}
