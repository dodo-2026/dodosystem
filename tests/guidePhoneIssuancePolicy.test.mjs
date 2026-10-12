import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDE_PHONE_ISSUE_WINDOW_SECONDS,
  GUIDE_PHONE_MAX_ISSUES_PER_WINDOW,
  GUIDE_PHONE_RESEND_COOLDOWN_SECONDS,
  decideGuidePhoneCodeIssuance,
} from "../lib/server/guidePhoneIssuancePolicy.ts";

test("normalizes an eligible mobile number without mutating history", () => {
  const issuedAt = Object.freeze([100]);
  assert.deepEqual(
    decideGuidePhoneCodeIssuance({
      phone: "090-1234-5678",
      issuedAt,
      now: 1_000,
    }),
    { allowed: true, phoneE164: "+819012345678" }
  );
  assert.deepEqual(issuedAt, [100]);
});

test("rejects malformed mobile input without exposing a normalized value", () => {
  assert.deepEqual(
    decideGuidePhoneCodeIssuance({
      phone: "092-123-4567",
      issuedAt: [],
      now: 1_000,
    }),
    { allowed: false, reason: "invalid_phone", retryAt: null }
  );
  assert.deepEqual(
    decideGuidePhoneCodeIssuance({ phone: null, issuedAt: [], now: 1_000 }),
    { allowed: false, reason: "invalid_phone", retryAt: null }
  );
});

test("enforces the resend cooldown and allows its exact boundary", () => {
  const issuedAt = [1_000];
  assert.deepEqual(
    decideGuidePhoneCodeIssuance({
      phone: "09012345678",
      issuedAt,
      now: 1_000 + GUIDE_PHONE_RESEND_COOLDOWN_SECONDS - 1,
    }),
    {
      allowed: false,
      reason: "cooldown",
      retryAt: 1_000 + GUIDE_PHONE_RESEND_COOLDOWN_SECONDS,
    }
  );
  assert.equal(
    decideGuidePhoneCodeIssuance({
      phone: "09012345678",
      issuedAt,
      now: 1_000 + GUIDE_PHONE_RESEND_COOLDOWN_SECONDS,
    }).allowed,
    true
  );
});

test("limits a rolling hour and reports when its oldest event leaves", () => {
  const now = 10_000;
  const oldest = now - GUIDE_PHONE_ISSUE_WINDOW_SECONDS + 1;
  const issuedAt = Array.from(
    { length: GUIDE_PHONE_MAX_ISSUES_PER_WINDOW },
    (_, index) => oldest + index * GUIDE_PHONE_RESEND_COOLDOWN_SECONDS
  );

  assert.deepEqual(
    decideGuidePhoneCodeIssuance({
      phone: "+81 90 1234 5678",
      issuedAt,
      now,
    }),
    {
      allowed: false,
      reason: "rate_limited",
      retryAt: oldest + GUIDE_PHONE_ISSUE_WINDOW_SECONDS,
    }
  );
  assert.equal(
    decideGuidePhoneCodeIssuance({
      phone: "+81 90 1234 5678",
      issuedAt,
      now: oldest + GUIDE_PHONE_ISSUE_WINDOW_SECONDS,
    }).allowed,
    true
  );
});

test("rejects malformed or future server-side issuance history", () => {
  assert.throws(
    () =>
      decideGuidePhoneCodeIssuance({
        phone: "09012345678",
        issuedAt: [1_001],
        now: 1_000,
      }),
    /future timestamp/
  );
  assert.throws(
    () =>
      decideGuidePhoneCodeIssuance({
        phone: "09012345678",
        issuedAt: [-1],
        now: 1_000,
      }),
    /non-negative safe integer/
  );
});
