import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { prepareGuidePhoneCodeIssuance } from "../lib/server/guidePhoneIssuancePreparation.ts";
import { verifyGuidePhoneCodeDigest } from "../lib/server/guidePhoneCode.ts";

const challengeId = "123e4567-e89b-42d3-a456-426614174000";
const secret = "guide-phone-primary-secret-32-characters-long";
const phoneE164 = "+819012345678";
const activeGuide = { guideId: challengeId, phoneE164, isActive: true };

afterEach(() => {
  mock.restoreAll();
  delete process.env.GUIDE_PHONE_CODE_SECRET;
});

test("returns an invalid-phone denial before any random or digest work", async () => {
  let uuidCalls = 0;
  let randomCalls = 0;
  let digestKeyCalls = 0;
  mock.method(crypto, "randomUUID", () => {
    uuidCalls += 1;
    return challengeId;
  });
  mock.method(crypto, "getRandomValues", (target) => {
    randomCalls += 1;
    target[0] = 42;
    return target;
  });
  mock.method(crypto.subtle, "importKey", async () => {
    digestKeyCalls += 1;
    throw new Error("digest work must not start for a denied issuance");
  });

  const result = await prepareGuidePhoneCodeIssuance({
    phone: "092-123-4567",
    guideCandidates: [],
    issuedAt: [],
    now: 1_000,
  });

  assert.deepEqual(result, {
    prepared: false,
    decision: { allowed: false, reason: "invalid_phone", retryAt: null },
  });
  assert.equal(uuidCalls, 0);
  assert.equal(randomCalls, 0);
  assert.equal(digestKeyCalls, 0);
});

test("returns a cooldown denial without requiring the digest secret", async () => {
  const result = await prepareGuidePhoneCodeIssuance({
    phone: "09012345678",
    guideCandidates: [activeGuide],
    issuedAt: [980],
    now: 1_000,
  });

  assert.deepEqual(result, {
    prepared: false,
    decision: { allowed: false, reason: "cooldown", retryAt: 1_040 },
  });
});

test("uses the same no-match denial and performs no challenge work", async () => {
  let uuidCalls = 0;
  mock.method(crypto, "randomUUID", () => {
    uuidCalls += 1;
    return challengeId;
  });

  const missing = await prepareGuidePhoneCodeIssuance({
    phone: "09012345678",
    guideCandidates: [],
    issuedAt: [],
    now: 1_000,
  });
  const ambiguous = await prepareGuidePhoneCodeIssuance({
    phone: "09012345678",
    guideCandidates: [activeGuide, { ...activeGuide }],
    issuedAt: [],
    now: 1_000,
  });

  const denial = {
    prepared: false,
    decision: {
      allowed: false,
      reason: "guide_not_available",
      retryAt: null,
    },
  };
  assert.deepEqual(missing, denial);
  assert.deepEqual(ambiguous, denial);
  assert.equal(uuidCalls, 0);
});

test("creates the separated challenge envelope only after policy acceptance", async () => {
  process.env.GUIDE_PHONE_CODE_SECRET = secret;
  mock.method(crypto, "randomUUID", () => challengeId);
  mock.method(crypto, "getRandomValues", (target) => {
    target[0] = 73;
    return target;
  });

  const result = await prepareGuidePhoneCodeIssuance({
    phone: "090-1234-5678",
    guideCandidates: [activeGuide],
    issuedAt: [],
    now: 1_000,
  });

  assert.equal(result.prepared, true);
  if (!result.prepared) return;

  assert.deepEqual(result.delivery, { phoneE164, code: "000073" });
  assert.equal(result.persisted.guideId, challengeId);
  assert.equal(result.persisted.phoneE164, phoneE164);
  assert.equal(
    JSON.stringify(result.persisted).includes("000073"),
    false
  );
  assert.equal(
    await verifyGuidePhoneCodeDigest({
      challengeId: result.persisted.challengeId,
      code: result.delivery.code,
      digest: result.persisted.codeDigest,
    }),
    true
  );
});
