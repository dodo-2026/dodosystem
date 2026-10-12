import assert from "node:assert/strict";
import test from "node:test";

import {
  createGuidePhoneChallengeState,
  attemptGuidePhoneChallenge,
} from "../lib/dodo/guidePhoneChallenge.ts";
import { createGuidePhoneCodeDigest } from "../lib/server/guidePhoneCode.ts";
import { attemptGuidePhoneVerification } from "../lib/server/guidePhoneVerification.ts";

const secret = "guide-phone-primary-secret-32-characters-long";
const challengeId = "123e4567-e89b-42d3-a456-426614174000";

function configureSecret() {
  process.env.GUIDE_PHONE_CODE_SECRET = secret;
}

test("verifies and consumes a matching challenge exactly once", async () => {
  configureSecret();
  const state = createGuidePhoneChallengeState(1_000);
  const digest = await createGuidePhoneCodeDigest(challengeId, "004271");

  const result = await attemptGuidePhoneVerification({
    state,
    challengeId,
    code: "004271",
    digest,
    now: 1_100,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, "accepted");
  assert.equal(result.state.consumedAt, 1_100);

  const replay = await attemptGuidePhoneVerification({
    state: result.state,
    challengeId,
    code: "004271",
    digest,
    now: 1_101,
  });
  assert.equal(replay.accepted, false);
  assert.equal(replay.reason, "consumed");
});

test("charges one attempt for an invalid or tampered code", async () => {
  configureSecret();
  const state = createGuidePhoneChallengeState(1_000);
  const digest = await createGuidePhoneCodeDigest(challengeId, "004271");

  const result = await attemptGuidePhoneVerification({
    state,
    challengeId,
    code: "004272",
    digest,
    now: 1_100,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "invalid_code");
  assert.equal(result.state.failedAttempts, 1);
  assert.equal(state.failedAttempts, 0);
});

test("does not run cryptographic verification for terminal challenges", async () => {
  configureSecret();
  const initial = createGuidePhoneChallengeState(1_000);
  const consumed = attemptGuidePhoneChallenge({
    state: initial,
    codeMatches: true,
    now: 1_100,
  }).state;
  delete process.env.GUIDE_PHONE_CODE_SECRET;

  const consumedResult = await attemptGuidePhoneVerification({
    state: consumed,
    challengeId,
    code: "004271",
    digest: "0".repeat(64),
    now: 1_101,
  });
  assert.equal(consumedResult.reason, "consumed");

  const expiredResult = await attemptGuidePhoneVerification({
    state: initial,
    challengeId,
    code: "004271",
    digest: "0".repeat(64),
    now: initial.expiresAt,
  });
  assert.equal(expiredResult.reason, "expired");
});

test("does not consume an attempt when server configuration is unavailable", async () => {
  configureSecret();
  const state = createGuidePhoneChallengeState(1_000);
  const digest = await createGuidePhoneCodeDigest(challengeId, "004271");
  delete process.env.GUIDE_PHONE_CODE_SECRET;

  await assert.rejects(
    () =>
      attemptGuidePhoneVerification({
        state,
        challengeId,
        code: "004271",
        digest,
        now: 1_100,
      }),
    /GUIDE_PHONE_CODE_SECRET/
  );
  assert.equal(state.failedAttempts, 0);
  assert.equal(state.consumedAt, null);
});
