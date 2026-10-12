import assert from "node:assert/strict";
import test from "node:test";

import { decideGuidePhoneMatch } from "../lib/server/guidePhoneGuideMatch.ts";

const guideId = "123E4567-E89B-42D3-A456-426614174000";
const phoneE164 = "+819012345678";

test("matches exactly one active guide and normalizes its UUID", () => {
  const candidates = Object.freeze([
    Object.freeze({ guideId, phoneE164, isActive: true }),
  ]);

  assert.deepEqual(decideGuidePhoneMatch({ phoneE164, candidates }), {
    matched: true,
    guideId: guideId.toLowerCase(),
  });
  assert.equal(candidates[0].guideId, guideId);
});

test("uses one outward denial for missing, inactive and ambiguous matches", () => {
  const denial = { matched: false, reason: "guide_not_available" };
  assert.deepEqual(
    decideGuidePhoneMatch({ phoneE164, candidates: [] }),
    denial
  );
  assert.deepEqual(
    decideGuidePhoneMatch({
      phoneE164,
      candidates: [{ guideId, phoneE164, isActive: false }],
    }),
    denial
  );
  assert.deepEqual(
    decideGuidePhoneMatch({
      phoneE164,
      candidates: [
        { guideId, phoneE164, isActive: true },
        {
          guideId: "223e4567-e89b-42d3-a456-426614174000",
          phoneE164,
          isActive: true,
        },
      ],
    }),
    denial
  );
});

test("rejects malformed normalized input or trusted guide records", () => {
  assert.throws(
    () => decideGuidePhoneMatch({ phoneE164: "09012345678", candidates: [] }),
    /normalized Japanese mobile/
  );
  assert.throws(
    () =>
      decideGuidePhoneMatch({
        phoneE164,
        candidates: [{ guideId: "not-a-uuid", phoneE164, isActive: true }],
      }),
    /valid UUID/
  );
  assert.throws(
    () =>
      decideGuidePhoneMatch({
        phoneE164,
        candidates: [{ guideId, phoneE164: "+819212345678", isActive: true }],
      }),
    /Japanese mobile E.164/
  );
});
