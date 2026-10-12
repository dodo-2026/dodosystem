import assert from "node:assert/strict";
import test from "node:test";

import {
  createGuidePhoneCodeDigest,
  verifyGuidePhoneCodeDigest,
} from "../lib/server/guidePhoneCode.ts";

const primarySecret = "guide-phone-primary-secret-32-characters-long";
const challengeId = "123e4567-e89b-42d3-a456-426614174000";

function configurePrimarySecret() {
  process.env.GUIDE_PHONE_CODE_SECRET = primarySecret;
  process.env.GUIDE_SESSION_SECRET = "guide-session-secret-32-characters-long";
  process.env.OFFICE_SESSION_SECRET = "office-session-secret-32-characters-long";
}

test("creates a challenge-bound digest and verifies the matching code", async () => {
  configurePrimarySecret();

  const digest = await createGuidePhoneCodeDigest(
    challengeId.toUpperCase(),
    "004271"
  );
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(
    await createGuidePhoneCodeDigest(challengeId, "004271"),
    digest
  );
  assert.equal(
    await verifyGuidePhoneCodeDigest({ challengeId, code: "004271", digest }),
    true
  );
});

test("rejects code, challenge ID and digest tampering", async () => {
  configurePrimarySecret();

  const digest = await createGuidePhoneCodeDigest(challengeId, "004271");
  assert.equal(
    await verifyGuidePhoneCodeDigest({ challengeId, code: "004272", digest }),
    false
  );
  assert.equal(
    await verifyGuidePhoneCodeDigest({
      challengeId: "223e4567-e89b-42d3-a456-426614174000",
      code: "004271",
      digest,
    }),
    false
  );
  assert.equal(
    await verifyGuidePhoneCodeDigest({
      challengeId,
      code: "004271",
      digest: `${digest.slice(0, -1)}${digest.endsWith("0") ? "1" : "0"}`,
    }),
    false
  );
});

test("rejects malformed IDs, codes and stored digests", async () => {
  configurePrimarySecret();

  await assert.rejects(
    () => createGuidePhoneCodeDigest("challenge-1", "004271"),
    /valid UUID/
  );
  await assert.rejects(
    () => createGuidePhoneCodeDigest(challengeId, "4271"),
    /exactly 6 ASCII digits/
  );
  await assert.rejects(
    () => createGuidePhoneCodeDigest(challengeId, "１２３４５６"),
    /exactly 6 ASCII digits/
  );
  assert.equal(
    await verifyGuidePhoneCodeDigest({
      challengeId,
      code: "004271",
      digest: "not-a-digest",
    }),
    false
  );
  assert.equal(
    await verifyGuidePhoneCodeDigest({
      challengeId,
      code: 4271,
      digest: "0".repeat(64),
    }),
    false
  );
});

test("does not fall back to office or guide session secrets", async () => {
  configurePrimarySecret();
  delete process.env.GUIDE_PHONE_CODE_SECRET;

  await assert.rejects(
    () => createGuidePhoneCodeDigest(challengeId, "004271"),
    /GUIDE_PHONE_CODE_SECRET/
  );
  assert.equal(
    await verifyGuidePhoneCodeDigest({
      challengeId,
      code: "004271",
      digest: "0".repeat(64),
    }),
    false
  );
});

test("invalidates stored digests when the phone-code secret rotates", async () => {
  configurePrimarySecret();
  const digest = await createGuidePhoneCodeDigest(challengeId, "004271");

  process.env.GUIDE_PHONE_CODE_SECRET =
    "guide-phone-rotated-secret-32-characters-long";
  assert.equal(
    await verifyGuidePhoneCodeDigest({ challengeId, code: "004271", digest }),
    false
  );
});
