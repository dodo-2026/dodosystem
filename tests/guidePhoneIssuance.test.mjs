import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { issueGuidePhoneCode } from "../lib/server/guidePhoneIssuance.ts";

const challengeId = "123e4567-e89b-42d3-a456-426614174000";
const secret = "guide-phone-primary-secret-32-characters-long";
const phoneE164 = "+819012345678";
const activeGuide = { guideId: challengeId, phoneE164, isActive: true };

afterEach(() => {
  mock.restoreAll();
  delete process.env.GUIDE_PHONE_CODE_SECRET;
});

function acceptedDependencies(events = []) {
  return {
    loadContext: async (phone) => {
      events.push(`load:${phone}`);
      return { guideCandidates: [activeGuide], issuedAt: [] };
    },
    persistChallenge: async (challenge) => {
      events.push("persist");
      assert.equal(Object.isFrozen(challenge), true);
      assert.equal(Object.isFrozen(challenge.state), true);
      return true;
    },
    sendCode: async (delivery) => {
      events.push("send");
      assert.equal(Object.isFrozen(delivery), true);
    },
  };
}

function mockAcceptedChallenge() {
  process.env.GUIDE_PHONE_CODE_SECRET = secret;
  mock.method(crypto, "randomUUID", () => challengeId);
  mock.method(crypto, "getRandomValues", (target) => {
    target[0] = 73;
    return target;
  });
}

test("rejects an invalid phone before trusted reads, persistence or send", async () => {
  const calls = [];
  const result = await issueGuidePhoneCode({
    phone: "092-123-4567",
    loadContext: async () => {
      calls.push("load");
      throw new Error("must not load");
    },
    persistChallenge: async () => {
      calls.push("persist");
      return true;
    },
    sendCode: async () => {
      calls.push("send");
    },
    now: 1_000,
  });

  assert.deepEqual(result, {
    issued: false,
    reason: "invalid_phone",
    retryAt: null,
  });
  assert.deepEqual(calls, []);
});

test("does not persist or send when no active guide matches", async () => {
  const calls = [];
  const result = await issueGuidePhoneCode({
    phone: "09012345678",
    loadContext: async () => ({ guideCandidates: [], issuedAt: [] }),
    persistChallenge: async () => {
      calls.push("persist");
      return true;
    },
    sendCode: async () => {
      calls.push("send");
    },
    now: 1_000,
  });

  assert.deepEqual(result, {
    issued: false,
    reason: "guide_not_available",
    retryAt: null,
  });
  assert.deepEqual(calls, []);
});

test("does not persist or send when the issuance policy denies a resend", async () => {
  const calls = [];
  const result = await issueGuidePhoneCode({
    phone: "09012345678",
    loadContext: async () => ({
      guideCandidates: [activeGuide],
      issuedAt: [980],
    }),
    persistChallenge: async () => {
      calls.push("persist");
      return true;
    },
    sendCode: async () => {
      calls.push("send");
    },
    now: 1_000,
  });

  assert.deepEqual(result, {
    issued: false,
    reason: "cooldown",
    retryAt: 1_040,
  });
  assert.deepEqual(calls, []);
});

test("persists before send and exposes only the challenge handle", async () => {
  mockAcceptedChallenge();
  const events = [];
  const result = await issueGuidePhoneCode({
    phone: "090-1234-5678",
    ...acceptedDependencies(events),
    now: 1_000,
  });

  assert.deepEqual(events, [`load:${phoneE164}`, "persist", "send"]);
  assert.deepEqual(result, {
    issued: true,
    challengeId,
    expiresAt: 1_600,
  });
  assert.equal(Object.isFrozen(result), true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("000073"), false);
  assert.equal(serialized.includes(phoneE164), false);
  assert.equal(serialized.includes("codeDigest"), false);
  assert.equal(serialized.includes("guideId"), false);
});

test("does not send when atomic persistence rejects the challenge", async () => {
  mockAcceptedChallenge();
  const events = [];
  const result = await issueGuidePhoneCode({
    phone: "09012345678",
    loadContext: async () => ({
      guideCandidates: [activeGuide],
      issuedAt: [],
    }),
    persistChallenge: async () => {
      events.push("persist");
      return false;
    },
    sendCode: async () => {
      events.push("send");
    },
    now: 1_000,
  });

  assert.deepEqual(result, {
    issued: false,
    reason: "state_conflict",
    retryAt: null,
  });
  assert.deepEqual(events, ["persist"]);
});

test("rejects a non-boolean persistence result without sending", async () => {
  mockAcceptedChallenge();
  const events = [];

  await assert.rejects(
    issueGuidePhoneCode({
      phone: "09012345678",
      loadContext: async () => ({
        guideCandidates: [activeGuide],
        issuedAt: [],
      }),
      persistChallenge: async () => {
        events.push("persist");
        return "yes";
      },
      sendCode: async () => {
        events.push("send");
      },
      now: 1_000,
    }),
    /must resolve to a boolean/
  );
  assert.deepEqual(events, ["persist"]);
});

test("propagates a fake send failure only after persistence", async () => {
  mockAcceptedChallenge();
  const events = [];

  await assert.rejects(
    issueGuidePhoneCode({
      phone: "09012345678",
      loadContext: async () => ({
        guideCandidates: [activeGuide],
        issuedAt: [],
      }),
      persistChallenge: async () => {
        events.push("persist");
        return true;
      },
      sendCode: async () => {
        events.push("send");
        throw new Error("fake SMS outage");
      },
      now: 1_000,
    }),
    /fake SMS outage/
  );
  assert.deepEqual(events, ["persist", "send"]);
});
