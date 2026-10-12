import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import {
  createGuidePhoneChallengeEnvelope,
  generateGuidePhoneCode,
} from "../lib/server/guidePhoneChallengeCreation.ts";
import { verifyGuidePhoneCodeDigest } from "../lib/server/guidePhoneCode.ts";

const challengeId = "123e4567-e89b-42d3-a456-426614174000";
const secret = "guide-phone-primary-secret-32-characters-long";

afterEach(() => {
  mock.restoreAll();
  delete process.env.GUIDE_PHONE_CODE_SECRET;
});

test("generates a fixed-width code including leading zeroes", () => {
  mock.method(crypto, "getRandomValues", (target) => {
    target[0] = 42;
    return target;
  });

  assert.equal(generateGuidePhoneCode(), "000042");
});

test("rejects the incomplete uint32 tail before applying modulo", () => {
  const samples = [4_294_000_000, 999_999];
  let calls = 0;
  mock.method(crypto, "getRandomValues", (target) => {
    target[0] = samples[calls];
    calls += 1;
    return target;
  });

  assert.equal(generateGuidePhoneCode(), "999999");
  assert.equal(calls, 2);
});

test("separates SMS-only plaintext from the persistable challenge record", async () => {
  process.env.GUIDE_PHONE_CODE_SECRET = secret;
  mock.method(crypto, "randomUUID", () => challengeId);
  mock.method(crypto, "getRandomValues", (target) => {
    target[0] = 4_271;
    return target;
  });

  const envelope = await createGuidePhoneChallengeEnvelope({ now: 1_000 });

  assert.deepEqual(envelope.delivery, { code: "004271" });
  assert.deepEqual(envelope.persisted.state, {
    createdAt: 1_000,
    expiresAt: 1_600,
    failedAttempts: 0,
    consumedAt: null,
  });
  assert.equal(envelope.persisted.challengeId, challengeId);
  assert.match(envelope.persisted.codeDigest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(envelope.persisted).includes("004271"), false);
  assert.equal(
    await verifyGuidePhoneCodeDigest({
      challengeId: envelope.persisted.challengeId,
      code: envelope.delivery.code,
      digest: envelope.persisted.codeDigest,
    }),
    true
  );
});
