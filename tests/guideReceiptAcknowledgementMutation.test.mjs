import assert from "node:assert/strict";
import test from "node:test";

import {
  readDedicatedGuideSessionToken,
  runGuideReceiptAcknowledgementMutation,
} from "../lib/server/guideReceiptAcknowledgementMutation.ts";

const guideId = "123e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const eventId = "423e4567-e89b-42d3-a456-426614174000";
const pending = Object.freeze({
  documentId,
  guideId,
  documentStatus: "final",
  acknowledgementStatus: "pending",
  receiptFingerprint: "a".repeat(64),
  acknowledgedAt: null,
});

function base(overrides = {}) {
  return {
    cookieStore: { get: () => ({ value: "guide-token" }) },
    body: { documentId },
    verifySession: async (token) => token === "guide-token" ? guideId : null,
    loadReceipt: async () => pending,
    commitTransaction: async () => true,
    createEventId: () => eventId,
    now: 1_000,
    ...overrides,
  };
}

test("reads only the dedicated guide cookie and completes the mutation", async () => {
  const requestedNames = [];
  let committed;
  const cookieStore = {
    get: (name) => {
      requestedNames.push(name);
      const values = {
        dodo_guide_session: "guide-token",
        office_session: "office-token-must-not-be-read",
      };
      return values[name] ? { value: values[name] } : undefined;
    },
  };
  const result = await runGuideReceiptAcknowledgementMutation(base({
    cookieStore,
    commitTransaction: async (transaction) => {
      committed = transaction;
      return true;
    },
  }));
  assert.deepEqual(requestedNames, ["dodo_guide_session"]);
  assert.deepEqual(result, { ok: true, acknowledgedAt: 1_000 });
  assert.equal(committed.audit.eventId, eventId);
  assert.equal(committed.audit.documentId, documentId);
  assert.equal(committed.audit.receiptFingerprint, pending.receiptFingerprint);
  assert.match(committed.auditFingerprint, /^[0-9a-f]{64}$/);
});

test("never falls back to a office session when the guide cookie is absent", async () => {
  let loads = 0;
  let verifiedToken = "not-called";
  const result = await runGuideReceiptAcknowledgementMutation(base({
    cookieStore: {
      get: (name) => name === "office_session" ? { value: "office-token" } : undefined,
    },
    verifySession: async (token) => { verifiedToken = token; return null; },
    loadReceipt: async () => { loads += 1; return pending; },
  }));
  assert.equal(verifiedToken, undefined);
  assert.equal(loads, 0);
  assert.deepEqual(result, { ok: false, error: "unavailable" });
});

test("treats malformed or oversized guide cookies as unauthenticated", () => {
  for (const value of ["", "token\nvalue", "x".repeat(1_025), 123, null]) {
    assert.equal(readDedicatedGuideSessionToken({ get: () => ({ value }) }), undefined);
  }
});

test("keeps strict body validation in front of session verification", async () => {
  let verifications = 0;
  const result = await runGuideReceiptAcknowledgementMutation(base({
    body: { documentId, extra: true },
    verifySession: async () => { verifications += 1; return guideId; },
  }));
  assert.equal(verifications, 0);
  assert.deepEqual(result, { ok: false, error: "invalid_request" });
});

test("maps persistence failure to a serializable private-error result", async () => {
  const events = [];
  const result = await runGuideReceiptAcknowledgementMutation(base({
    loadReceipt: async () => { throw new Error("private persistence detail"); },
    onPrivateError: (event) => events.push(event),
  }));
  assert.deepEqual(events, ["guide_receipt_acknowledgement_failed"]);
  assert.deepEqual(result, { ok: false, error: "temporarily_unavailable" });
  assert.doesNotMatch(JSON.stringify(result), /persistence|guide-token/i);
});

test("contains cookie-store failure before calling authentication or persistence", async () => {
  let verifications = 0;
  let loads = 0;
  const events = [];
  const result = await runGuideReceiptAcknowledgementMutation(base({
    cookieStore: { get: () => { throw new Error("cookie detail"); } },
    verifySession: async () => { verifications += 1; return guideId; },
    loadReceipt: async () => { loads += 1; return pending; },
    onPrivateError: (event) => events.push(event),
  }));
  assert.equal(verifications, 0);
  assert.equal(loads, 0);
  assert.deepEqual(events, ["guide_receipt_acknowledgement_failed"]);
  assert.deepEqual(result, { ok: false, error: "temporarily_unavailable" });
});
