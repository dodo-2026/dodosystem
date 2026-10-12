import {
  attemptGuidePhoneChallenge,
  getGuidePhoneChallengeStatus,
  type GuidePhoneChallengeAttemptResult,
  type GuidePhoneChallengeState,
} from "../dodo/guidePhoneChallenge.ts";
import { verifyConfiguredGuidePhoneCodeDigest } from "./guidePhoneCode.ts";

/**
 * Verifies one submitted code and returns the state that must be persisted.
 * The caller must store that state atomically before returning success; this
 * module intentionally does not write a database or send an SMS.
 */
export async function attemptGuidePhoneVerification({
  state,
  challengeId,
  code,
  digest,
  now = Math.floor(Date.now() / 1000),
}: {
  state: GuidePhoneChallengeState;
  challengeId: string;
  code: string;
  digest: string;
  now?: number;
}): Promise<GuidePhoneChallengeAttemptResult> {
  const status = getGuidePhoneChallengeStatus(state, now);

  if (status !== "pending") {
    return attemptGuidePhoneChallenge({ state, codeMatches: false, now });
  }

  const codeMatches = await verifyConfiguredGuidePhoneCodeDigest({
    challengeId,
    code,
    digest,
  });

  return attemptGuidePhoneChallenge({ state, codeMatches, now });
}
