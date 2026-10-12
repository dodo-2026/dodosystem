import type {
  GuidePhoneChallengeAttemptResult,
  GuidePhoneChallengeState,
} from "../dodo/guidePhoneChallenge.ts";
import { attemptGuidePhoneVerification } from "./guidePhoneVerification.ts";
import {
  assertGuideSessionConfigured,
  createGuideSession,
  GUIDE_SESSION_COOKIE,
  GUIDE_SESSION_MAX_AGE_SECONDS,
  normalizeGuideSessionGuideId,
} from "./guideSession.ts";

type GuidePhoneAuthenticationDenialReason = Exclude<
  GuidePhoneChallengeAttemptResult["reason"],
  "accepted"
>;

type GuidePhoneAuthenticationCommitDenialReason =
  | GuidePhoneAuthenticationDenialReason
  | "state_conflict";

export type GuidePhoneChallengeTransition = {
  challengeId: string;
  guideId: string;
  expectedState: Readonly<GuidePhoneChallengeState>;
  nextState: Readonly<GuidePhoneChallengeState>;
};

export type CommitGuidePhoneChallengeTransition = (
  transition: Readonly<GuidePhoneChallengeTransition>
) => Promise<boolean>;

export type GuideSessionCookie = {
  name: typeof GUIDE_SESSION_COOKIE;
  value: string;
  options: {
    httpOnly: true;
    secure: true;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
};

export type GuidePhoneAuthenticationResult =
  | {
      authenticated: false;
      reason: GuidePhoneAuthenticationDenialReason;
      state: GuidePhoneChallengeState;
    }
  | {
      authenticated: true;
      reason: "accepted";
      guideId: string;
      state: GuidePhoneChallengeState;
      sessionToken: string;
    };

export type PersistedGuidePhoneAuthenticationResult =
  | {
      authenticated: false;
      reason: GuidePhoneAuthenticationCommitDenialReason;
      state: GuidePhoneChallengeState;
    }
  | {
      authenticated: true;
      reason: "accepted";
      guideId: string;
      state: GuidePhoneChallengeState;
      cookie: GuideSessionCookie;
    };

function copyState(state: GuidePhoneChallengeState) {
  return { ...state };
}

function stateChanged(
  before: GuidePhoneChallengeState,
  after: GuidePhoneChallengeState
) {
  return (
    before.createdAt !== after.createdAt ||
    before.expiresAt !== after.expiresAt ||
    before.failedAttempts !== after.failedAttempts ||
    before.consumedAt !== after.consumedAt
  );
}

async function commitTransition({
  challengeId,
  guideId,
  expectedState,
  nextState,
  commit,
}: {
  challengeId: string;
  guideId: string;
  expectedState: GuidePhoneChallengeState;
  nextState: GuidePhoneChallengeState;
  commit: CommitGuidePhoneChallengeTransition;
}) {
  const committed = await commit(
    Object.freeze({
      challengeId,
      guideId,
      expectedState: Object.freeze(copyState(expectedState)),
      nextState: Object.freeze(copyState(nextState)),
    })
  );

  if (typeof committed !== "boolean") {
    throw new Error("Challenge transition commit must return a boolean.");
  }
  return committed;
}

/**
 * Completes local-only guide authentication. A session is signed only after
 * the challenge verifier returns its one-time consumed transition. A future
 * live caller must atomically persist the returned consumed state before it
 * places `sessionToken` in the guide cookie. Live routes must use
 * `completePersistedGuidePhoneAuthentication` instead of this low-level
 * helper; this helper performs no DB write.
 */
export async function completeGuidePhoneAuthentication({
  guideId,
  state,
  challengeId,
  code,
  digest,
  now = Math.floor(Date.now() / 1000),
}: {
  guideId: string;
  state: GuidePhoneChallengeState;
  challengeId: string;
  code: string;
  digest: string;
  now?: number;
}): Promise<GuidePhoneAuthenticationResult> {
  const attempt = await attemptGuidePhoneVerification({
    state,
    challengeId,
    code,
    digest,
    now,
  });

  if (!attempt.accepted) {
    return {
      authenticated: false,
      reason: attempt.reason,
      state: attempt.state,
    };
  }

  return {
    authenticated: true,
    reason: "accepted",
    guideId: guideId.toLowerCase(),
    state: attempt.state,
    sessionToken: await createGuideSession(guideId),
  };
}

/**
 * Completes the route-independent authentication transaction. Attempt-state
 * changes are committed through a caller-provided compare-and-set operation.
 * A signed session and its secure cookie metadata are created only after the
 * accepted consumed transition is durably committed. This module performs no
 * database, cookie or network I/O itself.
 */
export async function completePersistedGuidePhoneAuthentication({
  guideId,
  state,
  challengeId,
  code,
  digest,
  commit,
  now = Math.floor(Date.now() / 1000),
}: {
  guideId: string;
  state: GuidePhoneChallengeState;
  challengeId: string;
  code: string;
  digest: string;
  commit: CommitGuidePhoneChallengeTransition;
  now?: number;
}): Promise<PersistedGuidePhoneAuthenticationResult> {
  const normalizedGuideId = normalizeGuideSessionGuideId(guideId);
  const attempt = await attemptGuidePhoneVerification({
    state,
    challengeId,
    code,
    digest,
    now,
  });

  if (attempt.accepted) {
    // Fail before consuming the one-time code when session configuration is
    // unavailable. Session signing itself still happens only after commit.
    assertGuideSessionConfigured();
  }

  if (stateChanged(state, attempt.state)) {
    const committed = await commitTransition({
      challengeId,
      guideId: normalizedGuideId,
      expectedState: state,
      nextState: attempt.state,
      commit,
    });
    if (!committed) {
      return {
        authenticated: false,
        reason: "state_conflict",
        state: copyState(state),
      };
    }
  }

  if (!attempt.accepted) {
    return {
      authenticated: false,
      reason: attempt.reason,
      state: copyState(attempt.state),
    };
  }

  const sessionToken = await createGuideSession(normalizedGuideId);
  return {
    authenticated: true,
    reason: "accepted",
    guideId: normalizedGuideId,
    state: copyState(attempt.state),
    cookie: {
      name: GUIDE_SESSION_COOKIE,
      value: sessionToken,
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: GUIDE_SESSION_MAX_AGE_SECONDS,
      },
    },
  };
}
