import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import {
  attemptGuidePhoneChallenge,
  createGuidePhoneChallengeState,
} from "../lib/dodo/guidePhoneChallenge.ts";
import {
  completeGuidePhoneAuthentication,
  completePersistedGuidePhoneAuthentication,
} from "../lib/server/guidePhoneAuthentication.ts";
import { createGuidePhoneCodeDigest } from "../lib/server/guidePhoneCode.ts";
import {
  GUIDE_SESSION_COOKIE,
  GUIDE_SESSION_MAX_AGE_SECONDS,
  verifyGuideSession,
} from "../lib/server/guideSession.ts";

const challengeId = "123e4567-e89b-42d3-a456-426614174000";
const guideId = "223e4567-e89b-42d3-a456-426614174000";
const codeSecret = "guide-phone-primary-secret-32-characters-long";
const sessionSecret = "guide-session-primary-secret-32-characters-long";

afterEach(() => {
  mock.restoreAll();
  delete process.env.GUIDE_PHONE_CODE_SECRET;
  delete process.env.GUIDE_SESSION_SECRET;
});

async function createFixture() {
  process.env.GUIDE_PHONE_CODE_SECRET = codeSecret;
  return {
    state: createGuidePhoneChallengeState(1_000),
    digest: await createGuidePhoneCodeDigest(challengeId, "004271"),
  };
}

test("creates a guide session only after consuming a matching challenge", async () => {
  const { state, digest } = await createFixture();
  process.env.GUIDE_SESSION_SECRET = sessionSecret;

  const result = await completeGuidePhoneAuthentication({
    guideId: guideId.toUpperCase(),
    state,
    challengeId,
    code: "004271",
    digest,
    now: 1_100,
  });

  assert.equal(result.authenticated, true);
  if (!result.authenticated) return;
  assert.equal(result.reason, "accepted");
  assert.equal(result.guideId, guideId);
  assert.equal(result.state.consumedAt, 1_100);
  assert.equal(state.consumedAt, null);
  assert.equal(await verifyGuideSession(result.sessionToken), guideId);
});

test("an invalid code advances the attempt state without signing a session", async () => {
  const { state, digest } = await createFixture();
  let sessionSignCalls = 0;
  mock.method(crypto.subtle, "sign", async () => {
    sessionSignCalls += 1;
    throw new Error("session signing must not run for an invalid code");
  });

  const result = await completeGuidePhoneAuthentication({
    guideId,
    state,
    challengeId,
    code: "004272",
    digest,
    now: 1_100,
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.reason, "invalid_code");
  assert.equal(result.state.failedAttempts, 1);
  assert.equal(sessionSignCalls, 0);
});

test("terminal challenges never sign a guide session", async () => {
  const { state, digest } = await createFixture();
  const consumed = attemptGuidePhoneChallenge({
    state,
    codeMatches: true,
    now: 1_100,
  }).state;
  const locked = { ...state, failedAttempts: 5 };
  let sessionSignCalls = 0;
  mock.method(crypto.subtle, "sign", async () => {
    sessionSignCalls += 1;
    throw new Error("session signing must not run for a terminal challenge");
  });

  for (const [terminalState, now, reason] of [
    [consumed, 1_101, "consumed"],
    [locked, 1_101, "locked"],
    [state, state.expiresAt, "expired"],
  ]) {
    const result = await completeGuidePhoneAuthentication({
      guideId,
      state: terminalState,
      challengeId,
      code: "004271",
      digest,
      now,
    });
    assert.equal(result.authenticated, false);
    assert.equal(result.reason, reason);
  }
  assert.equal(sessionSignCalls, 0);
});

test("a missing session secret returns no consumed state to the caller", async () => {
  const { state, digest } = await createFixture();

  await assert.rejects(
    () =>
      completeGuidePhoneAuthentication({
        guideId,
        state,
        challengeId,
        code: "004271",
        digest,
        now: 1_100,
      }),
    /GUIDE_SESSION_SECRET/
  );
  assert.equal(state.consumedAt, null);
  assert.equal(state.failedAttempts, 0);
});

test("commits the consumed transition before returning secure cookie metadata", async () => {
  const { state, digest } = await createFixture();
  process.env.GUIDE_SESSION_SECRET = sessionSecret;
  const events = [];
  const originalSign = crypto.subtle.sign.bind(crypto.subtle);
  mock.method(crypto.subtle, "sign", async (...args) => {
    events.push("sign");
    return originalSign(...args);
  });

  const result = await completePersistedGuidePhoneAuthentication({
    guideId: guideId.toUpperCase(),
    state,
    challengeId,
    code: "004271",
    digest,
    now: 1_100,
    commit: async (transition) => {
      events.push("commit");
      assert.equal(Object.isFrozen(transition), true);
      assert.equal(Object.isFrozen(transition.expectedState), true);
      assert.equal(Object.isFrozen(transition.nextState), true);
      assert.equal(transition.guideId, guideId);
      assert.deepEqual(transition.expectedState, state);
      assert.equal(transition.nextState.consumedAt, 1_100);
      return true;
    },
  });

  assert.equal(result.authenticated, true);
  if (!result.authenticated) return;
  assert.deepEqual(events, ["commit", "sign"]);
  assert.equal(result.cookie.name, GUIDE_SESSION_COOKIE);
  assert.deepEqual(result.cookie.options, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: GUIDE_SESSION_MAX_AGE_SECONDS,
  });
  assert.equal(await verifyGuideSession(result.cookie.value), guideId);
});

test("allows only one concurrent compare-and-set attempt to create a session", async () => {
  const { state, digest } = await createFixture();
  process.env.GUIDE_SESSION_SECRET = sessionSecret;
  let persistedState = { ...state };
  let signCalls = 0;
  const originalSign = crypto.subtle.sign.bind(crypto.subtle);
  mock.method(crypto.subtle, "sign", async (...args) => {
    signCalls += 1;
    return originalSign(...args);
  });

  const commit = async ({ expectedState, nextState }) => {
    await Promise.resolve();
    if (
      persistedState.createdAt !== expectedState.createdAt ||
      persistedState.expiresAt !== expectedState.expiresAt ||
      persistedState.failedAttempts !== expectedState.failedAttempts ||
      persistedState.consumedAt !== expectedState.consumedAt
    ) {
      return false;
    }
    persistedState = { ...nextState };
    return true;
  };

  const results = await Promise.all([
    completePersistedGuidePhoneAuthentication({
      guideId,
      state,
      challengeId,
      code: "004271",
      digest,
      now: 1_100,
      commit,
    }),
    completePersistedGuidePhoneAuthentication({
      guideId,
      state,
      challengeId,
      code: "004271",
      digest,
      now: 1_100,
      commit,
    }),
  ]);

  assert.equal(results.filter((result) => result.authenticated).length, 1);
  assert.equal(
    results.filter((result) => result.reason === "state_conflict").length,
    1
  );
  assert.equal(signCalls, 1);
  assert.equal(persistedState.consumedAt, 1_100);
});

test("persists an invalid attempt without creating cookie metadata", async () => {
  const { state, digest } = await createFixture();
  let committedState = null;
  let signCalls = 0;
  mock.method(crypto.subtle, "sign", async () => {
    signCalls += 1;
    throw new Error("session signing must not run for an invalid code");
  });

  const result = await completePersistedGuidePhoneAuthentication({
    guideId,
    state,
    challengeId,
    code: "004272",
    digest,
    now: 1_100,
    commit: async ({ nextState }) => {
      committedState = { ...nextState };
      return true;
    },
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.reason, "invalid_code");
  assert.equal(committedState.failedAttempts, 1);
  assert.equal(signCalls, 0);
  assert.equal("cookie" in result, false);
});

test("returns a state conflict without signing when compare-and-set loses", async () => {
  const { state, digest } = await createFixture();
  process.env.GUIDE_SESSION_SECRET = sessionSecret;
  let signCalls = 0;
  mock.method(crypto.subtle, "sign", async () => {
    signCalls += 1;
    throw new Error("session signing must happen only after a successful commit");
  });

  const result = await completePersistedGuidePhoneAuthentication({
    guideId,
    state,
    challengeId,
    code: "004271",
    digest,
    now: 1_100,
    commit: async () => false,
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.reason, "state_conflict");
  assert.deepEqual(result.state, state);
  assert.equal(signCalls, 0);
  assert.equal("cookie" in result, false);
});

test("does not commit or sign an unchanged terminal challenge", async () => {
  const { state, digest } = await createFixture();
  let commitCalls = 0;
  let signCalls = 0;
  mock.method(crypto.subtle, "sign", async () => {
    signCalls += 1;
    throw new Error("session signing must not run for an expired challenge");
  });

  const result = await completePersistedGuidePhoneAuthentication({
    guideId,
    state,
    challengeId,
    code: "004271",
    digest,
    now: state.expiresAt,
    commit: async () => {
      commitCalls += 1;
      return true;
    },
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.reason, "expired");
  assert.equal(commitCalls, 0);
  assert.equal(signCalls, 0);
});

test("checks session configuration before committing a valid code", async () => {
  const { state, digest } = await createFixture();
  let commitCalls = 0;

  await assert.rejects(
    () =>
      completePersistedGuidePhoneAuthentication({
        guideId,
        state,
        challengeId,
        code: "004271",
        digest,
        now: 1_100,
        commit: async () => {
          commitCalls += 1;
          return true;
        },
      }),
    /GUIDE_SESSION_SECRET/
  );
  assert.equal(commitCalls, 0);
});
