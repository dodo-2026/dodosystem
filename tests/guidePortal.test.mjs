import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDE_PHONE_CODE_LENGTH,
  GUIDE_PHONE_CODE_MAX_ATTEMPTS,
  GUIDE_PHONE_CODE_TTL_SECONDS,
  GUIDE_PORTAL_SESSION_TTL_SECONDS,
  canViewGuideDocument,
  normalizeJapaneseMobilePhone,
} from "../lib/dodo/guidePortal.ts";

test("normalizes Japanese mobile numbers without accepting landlines", () => {
  assert.equal(normalizeJapaneseMobilePhone("090-1234-5678"), "+819012345678");
  assert.equal(normalizeJapaneseMobilePhone("+81 80 1234 5678"), "+818012345678");
  assert.equal(normalizeJapaneseMobilePhone("07012345678"), "+817012345678");
  assert.equal(normalizeJapaneseMobilePhone("092-123-4567"), null);
  assert.equal(normalizeJapaneseMobilePhone("0901234567"), null);
});

test("uses a bounded phone verification and portal session policy", () => {
  assert.equal(GUIDE_PHONE_CODE_LENGTH, 6);
  assert.equal(GUIDE_PHONE_CODE_MAX_ATTEMPTS, 5);
  assert.equal(GUIDE_PHONE_CODE_TTL_SECONDS, 600);
  assert.equal(GUIDE_PORTAL_SESSION_TTL_SECONDS, 2_592_000);
});

test("allows only the signed-in guide to view a finalized own document", () => {
  const input = {
    sessionGuideId: "guide-a",
    documentGuideId: "guide-a",
    documentStatus: "final",
    sessionExpiresAt: 2_000,
    now: 1_000,
  };

  assert.deepEqual(canViewGuideDocument(input), { allowed: true });
  assert.deepEqual(
    canViewGuideDocument({ ...input, documentGuideId: "guide-b" }),
    { allowed: false, reason: "different_guide" }
  );
  assert.deepEqual(
    canViewGuideDocument({ ...input, documentStatus: "draft" }),
    { allowed: false, reason: "document_not_available" }
  );
  assert.deepEqual(
    canViewGuideDocument({ ...input, sessionGuideId: null }),
    { allowed: false, reason: "not_signed_in" }
  );
  assert.deepEqual(
    canViewGuideDocument({ ...input, sessionExpiresAt: 1_000 }),
    { allowed: false, reason: "session_expired" }
  );
});
