import assert from "node:assert/strict";
import test from "node:test";

import { createGuidePhoneWalkthroughPreviews } from "../lib/dodo/guidePhoneWalkthroughPreview.ts";

test("builds the six immutable phone walkthrough states", () => {
  const previews = createGuidePhoneWalkthroughPreviews();
  assert.deepEqual(previews.map((preview) => preview.key), [
    "phone_entry",
    "code_entry",
    "invalid_code",
    "verified",
    "expired",
    "locked",
  ]);
  assert.deepEqual(previews.map((preview) => preview.phase), [
    "not_started",
    "pending",
    "invalid_code",
    "consumed",
    "expired",
    "locked",
  ]);
  assert.deepEqual(previews.map((preview) => preview.requestEnabled), [
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  assert.equal(Object.isFrozen(previews), true);
  for (const preview of previews) assert.equal(Object.isFrozen(preview), true);
});

test("shows retry guidance and a consumed, replay-safe completion state", () => {
  const previews = createGuidePhoneWalkthroughPreviews();
  const invalidCode = previews.find((preview) => preview.key === "invalid_code");
  const verified = previews.find((preview) => preview.key === "verified");
  assert.equal(invalidCode?.phase, "invalid_code");
  assert.match(invalidCode?.description ?? "", /やり直せます/);
  assert.equal(verified?.phase, "consumed");
  assert.match(verified?.description ?? "", /再利用できません/);
});

test("contains no real phone, code, credential, or request identifier", () => {
  const serialized = JSON.stringify(createGuidePhoneWalkthroughPreviews());
  assert.doesNotMatch(serialized, /0[789]0\d{8}/);
  assert.doesNotMatch(serialized, /challengeId|cookie|sessionId|token|secret|digest/i);
  assert.doesNotMatch(serialized, /\b\d{6}\b/);
  assert.match(serialized, /架空|認証|入力停止/);
});
