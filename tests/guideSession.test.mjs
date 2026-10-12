import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  GUIDE_SESSION_COOKIE,
  createGuideSession,
  verifyGuideSession,
} from "../lib/server/guideSession.ts";
import { GUIDE_PORTAL_SESSION_TTL_SECONDS } from "../lib/dodo/guidePortal.ts";

const originalDateNow = Date.now;
const originalGuideSecret = process.env.GUIDE_SESSION_SECRET;
const originalOfficeSecret = process.env.OFFICE_SESSION_SECRET;
const primarySecret = "guide-primary-secret-32-characters-long";
const guideId = "123e4567-e89b-42d3-a456-426614174000";

afterEach(() => {
  Date.now = originalDateNow;

  for (const [key, value] of [
    ["GUIDE_SESSION_SECRET", originalGuideSecret],
    ["OFFICE_SESSION_SECRET", originalOfficeSecret],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("uses a dedicated guide cookie and verifies a signed guide UUID", async () => {
  process.env.GUIDE_SESSION_SECRET = primarySecret;
  assert.equal(GUIDE_SESSION_COOKIE, "dodo_guide_session");

  const token = await createGuideSession(guideId.toUpperCase());
  assert.equal(await verifyGuideSession(token), guideId);
});

test("rejects malformed IDs, kind changes and signature tampering", async () => {
  process.env.GUIDE_SESSION_SECRET = primarySecret;
  await assert.rejects(() => createGuideSession("guide-1"), /valid UUID/);

  const token = await createGuideSession(guideId);
  assert.equal(await verifyGuideSession(token.replace(".guide.", ".office.")), null);
  assert.equal(
    await verifyGuideSession(token.replace(guideId, "223e4567-e89b-42d3-a456-426614174000")),
    null
  );

  const parts = token.split(".");
  parts[4] = `${parts[4].slice(0, -1)}${parts[4].endsWith("0") ? "1" : "0"}`;
  assert.equal(await verifyGuideSession(parts.join(".")), null);
});

test("rejects guide sessions at their expiry boundary", async () => {
  process.env.GUIDE_SESSION_SECRET = primarySecret;
  const issuedAtMilliseconds = 1_800_000_000_000;
  Date.now = () => issuedAtMilliseconds;
  const token = await createGuideSession(guideId);

  Date.now = () =>
    issuedAtMilliseconds + (GUIDE_PORTAL_SESSION_TTL_SECONDS - 1) * 1_000;
  assert.equal(await verifyGuideSession(token), guideId);

  Date.now = () =>
    issuedAtMilliseconds + GUIDE_PORTAL_SESSION_TTL_SECONDS * 1_000;
  assert.equal(await verifyGuideSession(token), null);
});

test("does not fall back to the office secret", async () => {
  process.env.OFFICE_SESSION_SECRET = primarySecret;
  delete process.env.GUIDE_SESSION_SECRET;

  await assert.rejects(
    () => createGuideSession(guideId),
    /GUIDE_SESSION_SECRET must be at least 32 characters/
  );
  assert.equal(await verifyGuideSession("v1.guide.invalid.0.deadbeef"), null);
});
