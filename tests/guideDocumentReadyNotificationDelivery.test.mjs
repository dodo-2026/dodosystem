import assert from "node:assert/strict";
import test from "node:test";

import { deliverGuideDocumentReadyNotification } from "../lib/server/guideDocumentReadyNotificationDelivery.ts";
import { createGuideDocumentNotificationOutboxRecord } from "../lib/server/guideDocumentReadyNotificationOutbox.ts";
import { processGuideDocumentNotificationOutboxRecord } from "../lib/server/guideDocumentReadyNotificationWorker.ts";

const idempotencyKey = `guide-document-ready:${"a".repeat(64)}`;
const guideId = "123e4567-e89b-42d3-a456-426614174000";
const otherGuideId = "223e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const recipient = Object.freeze({ kind: "provider-user-v1", handle: "guide_user_123" });
const payload = Object.freeze({
  schemaVersion: 1,
  event: "guide.document-ready",
  title: "書類の準備ができました",
  body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
  actionLabel: "DODOで確認する",
});
const request = Object.freeze({ idempotencyKey, payload });
const capabilities = Object.freeze({
  idempotencyMode: "provider-key-v1",
  requestSchemaVersion: 1,
});

function inputs(overrides = {}) {
  return {
    request,
    loadBinding: async () => ({ idempotencyKey, documentId, guideId, documentVersion: 3 }),
    loadDocument: async () => ({ documentId, guideId, version: 3, status: "final" }),
    loadRecipient: async () => ({ guideId, status: "active", recipient }),
    adapter: {
      getCapabilities: async () => capabilities,
      send: async () => ({ outcome: "delivered" }),
    },
    ...overrides,
  };
}

test("validates, resolves ownership, checks capabilities, then sends", async () => {
  const calls = [];
  const result = await deliverGuideDocumentReadyNotification(inputs({
    loadBinding: async (key) => {
      calls.push(["binding", key]);
      return { idempotencyKey, documentId, guideId, documentVersion: 3 };
    },
    loadDocument: async (id) => {
      calls.push(["document", id]);
      return { documentId, guideId, version: 3, status: "final" };
    },
    loadRecipient: async (id) => {
      calls.push(["recipient", id]);
      return { guideId, status: "active", recipient };
    },
    adapter: {
      getCapabilities: async () => {
        calls.push(["capabilities"]);
        return capabilities;
      },
      send: async (providerRequest) => {
        calls.push(["send"]);
        assert.deepEqual(providerRequest, { idempotencyKey, recipient, payload });
        return { outcome: "delivered" };
      },
    },
  }));
  assert.deepEqual(calls, [
    ["binding", idempotencyKey],
    ["document", documentId],
    ["recipient", guideId],
    ["capabilities"],
    ["send"],
  ]);
  assert.deepEqual(result, { outcome: "delivered" });
});

test("rejects malformed worker input before private reads or adapter use", async () => {
  for (const invalidRequest of [
    { ...request, idempotencyKey: "bad-key" },
    { ...request, extra: "private" },
    { ...request, payload: { ...payload, url: "https://example.invalid/private" } },
  ]) {
    let calls = 0;
    const result = await deliverGuideDocumentReadyNotification(inputs({
      request: invalidRequest,
      loadBinding: async () => { calls += 1; return null; },
      loadDocument: async () => { calls += 1; return null; },
      loadRecipient: async () => { calls += 1; return null; },
      adapter: {
        getCapabilities: async () => { calls += 1; return capabilities; },
        send: async () => { calls += 1; return { outcome: "delivered" }; },
      },
    }));
    assert.deepEqual(result, { outcome: "permanent_failure" });
    assert.equal(calls, 0);
  }
});

test("maps missing private bindings to retry without adapter use", async () => {
  let adapterCalls = 0;
  const result = await deliverGuideDocumentReadyNotification(inputs({
    loadBinding: async () => null,
    adapter: {
      getCapabilities: async () => { adapterCalls += 1; return capabilities; },
      send: async () => { adapterCalls += 1; return { outcome: "delivered" }; },
    },
  }));
  assert.deepEqual(result, { outcome: "temporary_failure" });
  assert.equal(adapterCalls, 0);
});

test("maps ownership mismatch to retry and stops before recipient or adapter", async () => {
  let laterCalls = 0;
  const result = await deliverGuideDocumentReadyNotification(inputs({
    loadDocument: async () => ({ documentId, guideId: otherGuideId, version: 3, status: "final" }),
    loadRecipient: async () => { laterCalls += 1; return null; },
    adapter: {
      getCapabilities: async () => { laterCalls += 1; return capabilities; },
      send: async () => { laterCalls += 1; return { outcome: "delivered" }; },
    },
  }));
  assert.deepEqual(result, { outcome: "temporary_failure" });
  assert.equal(laterCalls, 0);
});

test("requires adapter idempotency proof after recipient resolution", async () => {
  let sends = 0;
  const result = await deliverGuideDocumentReadyNotification(inputs({
    adapter: {
      getCapabilities: async () => ({ idempotencyMode: "none", requestSchemaVersion: 1 }),
      send: async () => { sends += 1; return { outcome: "delivered" }; },
    },
  }));
  assert.deepEqual(result, { outcome: "temporary_failure" });
  assert.equal(sends, 0);
});

test("preserves a strict permanent provider rejection", async () => {
  const result = await deliverGuideDocumentReadyNotification(inputs({
    adapter: {
      getCapabilities: async () => capabilities,
      send: async () => ({ outcome: "permanent_failure" }),
    },
  }));
  assert.deepEqual(result, { outcome: "permanent_failure" });
});

test("contains private reader and observer failures without adapter use", async () => {
  let adapterCalls = 0;
  let observed = 0;
  const result = await deliverGuideDocumentReadyNotification(inputs({
    loadRecipient: async () => { throw new Error("private recipient"); },
    adapter: {
      getCapabilities: async () => { adapterCalls += 1; return capabilities; },
      send: async () => { adapterCalls += 1; return { outcome: "delivered" }; },
    },
    onPrivateError: () => {
      observed += 1;
      throw new Error("observer unavailable");
    },
  }));
  assert.deepEqual(result, { outcome: "temporary_failure" });
  assert.equal(adapterCalls, 0);
  assert.equal(observed, 1);
  assert.doesNotMatch(JSON.stringify(result), /private|recipient|observer/);
});

test("worker persists a retry after lease claim when recipient is unresolved", async () => {
  const initial = createGuideDocumentNotificationOutboxRecord({
    allowed: true,
    idempotencyKey,
    payload,
  }, 1_000);
  let current = initial;
  let adapterCalls = 0;
  const result = await processGuideDocumentNotificationOutboxRecord({
    record: initial,
    now: 1_000,
    compareAndSet: async (expected, next) => {
      if (current !== expected) return false;
      current = next;
      return true;
    },
    sendIdempotently: (workerRequest) => deliverGuideDocumentReadyNotification(inputs({
      request: workerRequest,
      loadBinding: async () => null,
      adapter: {
        getCapabilities: async () => { adapterCalls += 1; return capabilities; },
        send: async () => { adapterCalls += 1; return { outcome: "delivered" }; },
      },
    })),
  });
  assert.deepEqual(result, {
    action: "delivery_attempted",
    outcome: "temporary_failure",
    persisted: true,
  });
  assert.equal(current.status, "retryable_failed");
  assert.equal(current.attemptCount, 1);
  assert.equal(adapterCalls, 0);
});
