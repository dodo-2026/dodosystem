import { GUIDE_PHONE_CODE_LENGTH } from "../dodo/guidePortal.ts";
import {
  createGuidePhoneChallengeState,
  type GuidePhoneChallengeState,
} from "../dodo/guidePhoneChallenge.ts";
import { createGuidePhoneCodeDigest } from "./guidePhoneCode.ts";

const UINT32_RANGE = 0x1_0000_0000;
const CODE_SPACE = 10 ** GUIDE_PHONE_CODE_LENGTH;
const UNBIASED_LIMIT = Math.floor(UINT32_RANGE / CODE_SPACE) * CODE_SPACE;

export type GuidePhoneChallengeCreationEnvelope = {
  delivery: {
    code: string;
  };
  persisted: {
    challengeId: string;
    codeDigest: string;
    state: GuidePhoneChallengeState;
  };
};

/**
 * Generates every six-digit code with equal probability. Values in the
 * incomplete tail of the uint32 range are discarded instead of using a
 * biased modulo conversion.
 */
export function generateGuidePhoneCode() {
  const randomWord = new Uint32Array(1);

  do {
    crypto.getRandomValues(randomWord);
  } while (randomWord[0] >= UNBIASED_LIMIT);

  return String(randomWord[0] % CODE_SPACE).padStart(
    GUIDE_PHONE_CODE_LENGTH,
    "0"
  );
}

/**
 * Creates a server-only handoff. `delivery.code` must go only to the SMS
 * provider and must never be persisted. Only `persisted` may be written to a
 * database, in one atomic operation when the live DODO store is connected.
 */
export async function createGuidePhoneChallengeEnvelope({
  challengeId = crypto.randomUUID(),
  now = Math.floor(Date.now() / 1000),
}: {
  /** Server-generated receipt ID only; never accept this from a public payload. */
  challengeId?: string;
  now?: number;
} = {}): Promise<GuidePhoneChallengeCreationEnvelope> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(challengeId)) {
    throw new Error("Challenge receipt must be a lowercase UUID v4.");
  }
  const code = generateGuidePhoneCode();
  const state = createGuidePhoneChallengeState(now);
  const codeDigest = await createGuidePhoneCodeDigest(challengeId, code);

  return {
    delivery: { code },
    persisted: {
      challengeId,
      codeDigest,
      state,
    },
  };
}
