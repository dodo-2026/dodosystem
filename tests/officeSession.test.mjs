import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  OFFICE_SESSION_MAX_AGE_SECONDS,
  createOfficeSession,
  verifyOfficeSession,
} from "../lib/server/officeSession.ts";

const originalDateNow = Date.now;
const originalSecret = process.env.OFFICE_SESSION_SECRET;
const primarySecret = "test-primary-secret-32-characters-long";
const rotatedSecret = "test-rotated-secret-32-characters-long";

afterEach(() => {
  Date.now = originalDateNow;

  if (originalSecret === undefined) {
    delete process.env.OFFICE_SESSION_SECRET;
  } else {
    process.env.OFFICE_SESSION_SECRET = originalSecret;
  }
});

test("creates and verifies the single internal office session", async () => {
  process.env.OFFICE_SESSION_SECRET = primarySecret;

  const officeToken = await createOfficeSession("office");
  await assert.rejects(() => createOfficeSession("owner"), /Unsupported office session role/);

  assert.equal(await verifyOfficeSession(officeToken), "office");

});

test("rejects missing and malformed sessions", async () => {
  process.env.OFFICE_SESSION_SECRET = primarySecret;

  assert.equal(await verifyOfficeSession(undefined), null);

  for (const token of [
    "",
    "v2.office.2000000000.deadbeef",
    "v1.admin.2000000000.deadbeef",
    "v1.office.not-a-number.deadbeef",
    "v1.office.2000000000.not-hex",
    "v1.office.2000000000.abc",
    "v1.office.2000000000.deadbeef.extra",
  ]) {
    assert.equal(await verifyOfficeSession(token), null, token);
  }
});

test("rejects role and signature tampering", async () => {
  process.env.OFFICE_SESSION_SECRET = primarySecret;
  const token = await createOfficeSession("office");

  assert.equal(
    await verifyOfficeSession(token.replace(".office.", ".owner.")),
    null
  );

  const parts = token.split(".");
  parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("0") ? "1" : "0"}`;
  assert.equal(await verifyOfficeSession(parts.join(".")), null);
});

test("rejects a session at and after its expiry boundary", async () => {
  process.env.OFFICE_SESSION_SECRET = primarySecret;
  const issuedAtMilliseconds = 1_800_000_000_000;
  Date.now = () => issuedAtMilliseconds;
  const token = await createOfficeSession("office");

  Date.now = () =>
    issuedAtMilliseconds + (OFFICE_SESSION_MAX_AGE_SECONDS - 1) * 1_000;
  assert.equal(await verifyOfficeSession(token), "office");

  Date.now = () =>
    issuedAtMilliseconds + OFFICE_SESSION_MAX_AGE_SECONDS * 1_000;
  assert.equal(await verifyOfficeSession(token), null);
});

test("invalidates existing sessions when the secret is rotated", async () => {
  process.env.OFFICE_SESSION_SECRET = primarySecret;
  const token = await createOfficeSession("office");

  process.env.OFFICE_SESSION_SECRET = rotatedSecret;
  assert.equal(await verifyOfficeSession(token), null);
});

test("refuses to create sessions with a missing or short secret", async () => {
  delete process.env.OFFICE_SESSION_SECRET;
  await assert.rejects(
    () => createOfficeSession("office"),
    /OFFICE_SESSION_SECRET must be at least 32 characters/
  );

  process.env.OFFICE_SESSION_SECRET = "too-short";
  await assert.rejects(
    () => createOfficeSession("office"),
    /OFFICE_SESSION_SECRET must be at least 32 characters/
  );
});
