import assert from "node:assert/strict";
import test from "node:test";

import {
  attemptGuidePhoneChallenge,
  createGuidePhoneChallengeState,
  getGuidePhoneChallengeStatus,
} from "../lib/dodo/guidePhoneChallenge.ts";
import {
  GUIDE_PHONE_CODE_MAX_ATTEMPTS,
  GUIDE_PHONE_CODE_TTL_SECONDS,
} from "../lib/dodo/guidePortal.ts";

test("creates a pending challenge with a bounded lifetime", () => {
  const state = createGuidePhoneChallengeState(1_000);

  assert.deepEqual(state, {
    createdAt: 1_000,
    expiresAt: 1_000 + GUIDE_PHONE_CODE_TTL_SECONDS,
    failedAttempts: 0,
    consumedAt: null,
  });
  assert.equal(getGuidePhoneChallengeStatus(state, 1_001), "pending");
});

test("consumes a matching challenge exactly once", () => {
  const initial = createGuidePhoneChallengeState(1_000);
  const accepted = attemptGuidePhoneChallenge({
    state: initial,
    codeMatches: true,
    now: 1_100,
  });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.reason, "accepted");
  assert.equal(accepted.state.consumedAt, 1_100);
  assert.equal(initial.consumedAt, null);

  const replayed = attemptGuidePhoneChallenge({
    state: accepted.state,
    codeMatches: true,
    now: 1_101,
  });
  assert.deepEqual(replayed, {
    accepted: false,
    reason: "consumed",
    state: accepted.state,
  });
});

test("rejects a code at the exact expiry boundary", () => {
  const state = createGuidePhoneChallengeState(1_000);
  const result = attemptGuidePhoneChallenge({
    state,
    codeMatches: true,
    now: 1_000 + GUIDE_PHONE_CODE_TTL_SECONDS,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "expired");
  assert.deepEqual(result.state, state);
});

test("locks after the maximum number of failed attempts", () => {
  let state = createGuidePhoneChallengeState(1_000);

  for (let attempt = 1; attempt <= GUIDE_PHONE_CODE_MAX_ATTEMPTS; attempt += 1) {
    const result = attemptGuidePhoneChallenge({
      state,
      codeMatches: false,
      now: 1_000 + attempt,
    });
    state = result.state;
    assert.equal(
      result.reason,
      attempt === GUIDE_PHONE_CODE_MAX_ATTEMPTS ? "locked" : "invalid_code"
    );
  }

  const bypass = attemptGuidePhoneChallenge({
    state,
    codeMatches: true,
    now: 1_010,
  });
  assert.equal(bypass.accepted, false);
  assert.equal(bypass.reason, "locked");
  assert.equal(bypass.state.failedAttempts, GUIDE_PHONE_CODE_MAX_ATTEMPTS);
});

test("rejects malformed persisted challenge state", () => {
  const state = createGuidePhoneChallengeState(1_000);

  assert.throws(
    () =>
      getGuidePhoneChallengeStatus(
        { ...state, failedAttempts: GUIDE_PHONE_CODE_MAX_ATTEMPTS + 1 },
        1_001
      ),
    /outside the allowed range/
  );
  assert.throws(
    () => getGuidePhoneChallengeStatus({ ...state, expiresAt: 1_000 }, 1_001),
    /later than createdAt/
  );
  assert.throws(
    () => getGuidePhoneChallengeStatus(state, 999),
    /not be earlier than createdAt/
  );
  assert.throws(
    () =>
      attemptGuidePhoneChallenge({
        state,
        codeMatches: "yes",
        now: 1_001,
      }),
    /must be a boolean/
  );
});
