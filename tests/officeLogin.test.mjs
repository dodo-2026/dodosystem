import assert from "node:assert/strict";
import test from "node:test";
import { authenticateOfficeLogin } from "../lib/server/officeLogin.ts";
const config = { OFFICE_LOGIN_ID: "office", OFFICE_LOGIN_PASSWORD: "test-only-password" };
test("internal login requires no owner credentials", () => {
  assert.equal(authenticateOfficeLogin("office", "test-only-password", config).ok, true);
});
test("missing configuration and wrong credentials fail closed", () => {
  assert.equal(authenticateOfficeLogin("office", "test-only-password", {}).status, 500);
  assert.equal(authenticateOfficeLogin("", "", config).status, 400);
  assert.equal(authenticateOfficeLogin("office", "wrong", config).status, 401);
  assert.equal(authenticateOfficeLogin("contractor", "test-only-password", config).status, 401);
});
test("obsolete owner credentials cannot grant access", () => {
  const legacy = { ...config, OWNER_LOGIN_ID: "old-owner", OWNER_LOGIN_PASSWORD: "old-password" };
  assert.equal(authenticateOfficeLogin("old-owner", "old-password", legacy).status, 401);
});
