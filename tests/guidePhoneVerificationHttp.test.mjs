import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import {
  attemptGuidePhoneChallenge,
  createGuidePhoneChallengeState,
} from "../lib/dodo/guidePhoneChallenge.ts";
import { createGuidePhoneCodeDigest } from "../lib/server/guidePhoneCode.ts";
import {
  handleGuidePhoneVerificationRequest,
  parseGuidePhoneVerificationPayload,
} from "../lib/server/guidePhoneVerificationHttp.ts";
import { verifyGuideSession } from "../lib/server/guideSession.ts";

const challengeId = "123e4567-e89b-42d3-a456-426614174000";
const guideId = "223e4567-e89b-42d3-a456-426614174000";
const codeSecret = "guide-phone-primary-secret-32-characters-long";
const sessionSecret = "guide-session-primary-secret-32-characters-long";

afterEach(() => {
  mock.restoreAll();
  delete process.env.GUIDE_PHONE_CODE_SECRET;
  delete process.env.GUIDE_SESSION_SECRET;
});

async function createRecord(state = createGuidePhoneChallengeState(1_000)) {
  process.env.GUIDE_PHONE_CODE_SECRET = codeSecret;
  return {
    challengeId,
    guideId,
    codeDigest: await createGuidePhoneCodeDigest(challengeId, "004271"),
    state,
  };
}

test("accepts only an exact bounded JSON payload", () => {
  assert.deepEqual(
    parseGuidePhoneVerificationPayload({
      challengeId: challengeId.toUpperCase(),
      code: "004271",
    }),
    { challengeId, code: "004271" }
  );

  for (const value of [
    null,
    [],
    {},
    { challengeId, code: "4271" },
    { challengeId, code: "００４２７１" },
    { challengeId, code: " 004271" },
    { challengeId: "challenge-1", code: "004271" },
    { challengeId, code: "004271", guideId },
  ]) {
    assert.equal(parseGuidePhoneVerificationPayload(value), null);
  }
});

test("rejects malformed input before loading any challenge", async () => {
  let loadCalls = 0;
  let commitCalls = 0;
  const result = await handleGuidePhoneVerificationRequest({
    body: { challengeId, code: "1234567" },
    load: async () => {
      loadCalls += 1;
      return null;
    },
    commit: async () => {
      commitCalls += 1;
      return true;
    },
  });

  assert.deepEqual(result, {
    status: 400,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    body: { ok: false, error: "invalid_request" },
  });
  assert.equal(loadCalls, 0);
  assert.equal(commitCalls, 0);
});

test("uses one outward response for missing and denied challenges", async () => {
  const pending = createGuidePhoneChallengeState(1_000);
  const consumed = attemptGuidePhoneChallenge({
    state: pending,
    codeMatches: true,
    now: 1_100,
  }).state;
  const digestRecord = await createRecord(pending);
  process.env.GUIDE_SESSION_SECRET = sessionSecret;
  let signCalls = 0;
  let verifyCalls = 0;
  const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
  mock.method(crypto.subtle, "verify", async (...args) => {
    verifyCalls += 1;
    return originalVerify(...args);
  });
  const originalSign = crypto.subtle.sign.bind(crypto.subtle);
  mock.method(crypto.subtle, "sign", async (...args) => {
    signCalls += 1;
    return originalSign(...args);
  });

  const expected = {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    body: { ok: false, error: "verification_failed" },
  };
  const cases = [
    { record: null, code: "004271", now: 1_100, commit: true },
    { record: digestRecord, code: "004272", now: 1_100, commit: true },
    {
      record: { ...digestRecord, state: pending },
      code: "004271",
      now: pending.expiresAt,
      commit: true,
    },
    {
      record: { ...digestRecord, state: { ...pending, failedAttempts: 5 } },
      code: "004271",
      now: 1_100,
      commit: true,
    },
    {
      record: { ...digestRecord, state: consumed },
      code: "004271",
      now: 1_101,
      commit: true,
    },
    { record: digestRecord, code: "004271", now: 1_100, commit: false },
  ];

  for (const item of cases) {
    const previousVerifyCalls = verifyCalls;
    let commitCalls = 0;
    const result = await handleGuidePhoneVerificationRequest({
      body: { challengeId, code: item.code },
      load: async () => item.record,
      commit: async () => {
        commitCalls += 1;
        return item.commit;
      },
      now: item.now,
    });
    assert.deepEqual(result, expected);
    assert.equal("cookie" in result, false);
    assert.equal(verifyCalls - previousVerifyCalls, 1);
    if (
      !item.record ||
      item.now >= item.record.state.expiresAt ||
      item.record.state.failedAttempts >= 5 ||
      item.record.state.consumedAt !== null
    ) {
      assert.equal(commitCalls, 0);
    }
  }
  assert.equal(signCalls, 0);
});

test("dummy verification can never authenticate a missing record", async () => {
  process.env.GUIDE_PHONE_CODE_SECRET = codeSecret;
  mock.method(crypto.subtle, "verify", async () => true);
  const result = await handleGuidePhoneVerificationRequest({
    body: { challengeId, code: "004271" },
    load: async () => null,
    commit: async () => assert.fail("must not commit a missing record"),
  });
  assert.equal(result.status, 401);
  assert.equal("cookie" in result, false);
});

test("returns cookie metadata only after the atomic completion succeeds", async () => {
  const record = await createRecord();
  process.env.GUIDE_SESSION_SECRET = sessionSecret;
  let committedAt = null;
  const result = await handleGuidePhoneVerificationRequest({
    body: { challengeId: challengeId.toUpperCase(), code: "004271" },
    load: async (normalizedChallengeId) => {
      assert.equal(normalizedChallengeId, challengeId);
      return record;
    },
    commit: async ({ nextState }) => {
      committedAt = nextState.consumedAt;
      return true;
    },
    now: 1_100,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(committedAt, 1_100);
  assert.equal("cookie" in result, true);
  if (!("cookie" in result)) return;
  assert.equal(await verifyGuideSession(result.cookie.value), guideId);
});

test("treats mismatched or malformed trusted records as server errors", async () => {
  const record = await createRecord();
  let commitCalls = 0;
  const commit = async () => {
    commitCalls += 1;
    return true;
  };

  await assert.rejects(
    () =>
      handleGuidePhoneVerificationRequest({
        body: { challengeId, code: "004271" },
        load: async () => ({
          ...record,
          challengeId: "323e4567-e89b-42d3-a456-426614174000",
        }),
        commit,
        now: 1_100,
      }),
    /does not match/
  );
  await assert.rejects(
    () =>
      handleGuidePhoneVerificationRequest({
        body: { challengeId, code: "004271" },
        load: async () => ({ ...record, codeDigest: "not-a-digest" }),
        commit,
        now: 1_100,
      }),
    /digest is malformed/
  );
  assert.equal(commitCalls, 0);
});
