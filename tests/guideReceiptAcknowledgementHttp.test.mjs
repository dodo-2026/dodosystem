import assert from "node:assert/strict";
import test from "node:test";

import { handleGuideReceiptAcknowledgementRequest } from "../lib/server/guideReceiptAcknowledgementHttp.ts";

const documentId = "323E4567-E89B-42D3-A456-426614174000";
const headers = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

test("normalizes one valid document ID and returns a successful acknowledgement", async () => {
  let received;
  const result = await handleGuideReceiptAcknowledgementRequest({
    sessionToken: "signed-session",
    body: { documentId },
    acknowledge: async (input) => {
      received = input;
      return { acknowledged: true, acknowledgedAt: 1_000 };
    },
  });
  assert.deepEqual(received, {
    sessionToken: "signed-session",
    documentId: documentId.toLowerCase(),
  });
  assert.deepEqual(result, {
    status: 200,
    headers,
    body: { ok: true, acknowledgedAt: 1_000 },
  });
});

test("rejects malformed or extra JSON fields before the domain operation", async () => {
  let calls = 0;
  for (const body of [
    null,
    [],
    {},
    { documentId: "bad-id" },
    { documentId, extra: true },
    { documentId: `${documentId}\n` },
  ]) {
    const result = await handleGuideReceiptAcknowledgementRequest({
      sessionToken: "signed-session",
      body,
      acknowledge: async () => { calls += 1; return { acknowledged: true, acknowledgedAt: 1 }; },
    });
    assert.deepEqual(result, {
      status: 400,
      headers,
      body: { ok: false, error: "invalid_request" },
    });
  }
  assert.equal(calls, 0);
});

test("maps every domain denial to the same non-enumerating response", async () => {
  const result = await handleGuideReceiptAcknowledgementRequest({
    sessionToken: undefined,
    body: { documentId },
    acknowledge: async () => ({ acknowledged: false }),
  });
  assert.deepEqual(result, {
    status: 200,
    headers,
    body: { ok: false, error: "unavailable" },
  });
});

test("returns a fixed private failure without leaking thrown details", async () => {
  const events = [];
  const result = await handleGuideReceiptAcknowledgementRequest({
    sessionToken: "secret-session",
    body: { documentId },
    acknowledge: async () => { throw new Error("database-secret-value"); },
    onPrivateError: (event) => events.push(event),
  });
  assert.deepEqual(events, ["guide_receipt_acknowledgement_failed"]);
  assert.deepEqual(result, {
    status: 503,
    headers,
    body: { ok: false, error: "temporarily_unavailable" },
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-session|database-secret-value/i);
});

test("fails closed when the injected domain operation returns malformed data", async () => {
  const result = await handleGuideReceiptAcknowledgementRequest({
    sessionToken: "signed-session",
    body: { documentId },
    acknowledge: async () => ({ acknowledged: true, acknowledgedAt: -1 }),
  });
  assert.deepEqual(result, {
    status: 503,
    headers,
    body: { ok: false, error: "temporarily_unavailable" },
  });
});
