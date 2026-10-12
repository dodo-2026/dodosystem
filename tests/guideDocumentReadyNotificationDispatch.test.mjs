import assert from "node:assert/strict";
import test from "node:test";

import { dispatchGuideDocumentReadyNotification } from "../lib/server/guideDocumentReadyNotificationDispatch.ts";
import { createGuideDocumentNotificationOutboxRecord } from "../lib/server/guideDocumentReadyNotificationOutbox.ts";
import { processGuideDocumentNotificationOutboxRecord } from "../lib/server/guideDocumentReadyNotificationWorker.ts";

const recipient = Object.freeze({ kind: "provider-user-v1", handle: "guide_user_123" });
const request = Object.freeze({
  idempotencyKey: `guide-document-ready:${"a".repeat(64)}`,
  payload: Object.freeze({
    schemaVersion: 1,
    event: "guide.document-ready",
    title: "書類の準備ができました",
    body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
    actionLabel: "DODOで確認する",
  }),
});

const capabilities = Object.freeze({
  idempotencyMode: "provider-key-v1",
  requestSchemaVersion: 1,
});

test("validates capabilities before sending a frozen separated recipient request", async () => {
  const calls = [];
  const result = await dispatchGuideDocumentReadyNotification({
    recipient,
    request,
    adapter: {
      getCapabilities: async () => {
        calls.push("capabilities");
        return capabilities;
      },
      send: async (providerRequest) => {
        calls.push("send");
        assert.equal(Object.isFrozen(providerRequest), true);
        assert.equal(Object.isFrozen(providerRequest.recipient), true);
        assert.equal(Object.isFrozen(providerRequest.payload), true);
        assert.deepEqual(providerRequest, {
          idempotencyKey: request.idempotencyKey,
          recipient,
          payload: request.payload,
        });
        assert.equal("recipient" in providerRequest.payload, false);
        assert.equal("handle" in providerRequest.payload, false);
        return { outcome: "delivered" };
      },
    },
  });
  assert.deepEqual(calls, ["capabilities", "send"]);
  assert.deepEqual(result, { outcome: "delivered" });
  assert.equal(JSON.stringify(result).includes(recipient.handle), false);
});

test("rejects a malformed recipient before inspecting adapter capabilities", async () => {
  for (const value of [
    { ...recipient, handle: "short" },
    { ...recipient, handle: "https://example.invalid/user" },
    { ...recipient, kind: "email" },
    { ...recipient, extra: "hidden" },
  ]) {
    let adapterCalls = 0;
    const result = await dispatchGuideDocumentReadyNotification({
      recipient: value,
      request,
      adapter: {
        getCapabilities: async () => {
          adapterCalls += 1;
          return capabilities;
        },
        send: async () => {
          adapterCalls += 1;
          return { outcome: "delivered" };
        },
      },
    });
    assert.deepEqual(result, { outcome: "permanent_failure" });
    assert.equal(adapterCalls, 0);
  }
});

test("requires an exact provider-key idempotency capability before send", async () => {
  for (const value of [
    null,
    {},
    { idempotencyMode: "none", requestSchemaVersion: 1 },
    { idempotencyMode: "provider-key-v1", requestSchemaVersion: 2 },
    { ...capabilities, extra: true },
  ]) {
    let sends = 0;
    const result = await dispatchGuideDocumentReadyNotification({
      recipient,
      request,
      adapter: {
        getCapabilities: async () => value,
        send: async () => {
          sends += 1;
          return { outcome: "delivered" };
        },
      },
    });
    assert.deepEqual(result, { outcome: "temporary_failure" });
    assert.equal(sends, 0);
  }
});

test("rejects expanded or malformed worker requests before adapter use", async () => {
  const invalidRequests = [
    { ...request, idempotencyKey: "bad-key" },
    { ...request, extra: true },
    { ...request, payload: { ...request.payload, url: "https://example.invalid/private" } },
  ];
  for (const invalidRequest of invalidRequests) {
    let adapterCalls = 0;
    const result = await dispatchGuideDocumentReadyNotification({
      recipient,
      request: invalidRequest,
      adapter: {
        getCapabilities: async () => {
          adapterCalls += 1;
          return capabilities;
        },
        send: async () => {
          adapterCalls += 1;
          return { outcome: "delivered" };
        },
      },
    });
    assert.deepEqual(result, { outcome: "permanent_failure" });
    assert.equal(adapterCalls, 0);
  }
});

test("preserves supported delivered and permanent outcomes", async () => {
  for (const outcome of ["delivered", "permanent_failure"]) {
    const result = await dispatchGuideDocumentReadyNotification({
      recipient,
      request,
      adapter: {
        getCapabilities: async () => capabilities,
        send: async () => ({ outcome }),
      },
    });
    assert.deepEqual(result, { outcome });
  }
});

test("maps provider exceptions and malformed results to one temporary outcome", async () => {
  const adapters = [
    {
      getCapabilities: async () => {
        throw new Error("private capability detail");
      },
      send: async () => ({ outcome: "delivered" }),
    },
    {
      getCapabilities: async () => capabilities,
      send: async () => {
        throw new Error("private send detail");
      },
    },
    {
      getCapabilities: async () => capabilities,
      send: async () => ({ outcome: "delivered", providerReceipt: "private" }),
    },
  ];
  for (const adapter of adapters) {
    const result = await dispatchGuideDocumentReadyNotification({ recipient, request, adapter });
    assert.deepEqual(result, { outcome: "temporary_failure" });
    assert.doesNotMatch(JSON.stringify(result), /private|receipt|guide_user/);
  }
});

test("contains observer failures and never exposes the private recipient", async () => {
  const result = await dispatchGuideDocumentReadyNotification({
    recipient: { ...recipient, handle: "bad handle" },
    request,
    adapter: {
      getCapabilities: async () => capabilities,
      send: async () => ({ outcome: "delivered" }),
    },
    onPrivateError: () => {
      throw new Error("observer detail");
    },
  });
  assert.deepEqual(result, { outcome: "permanent_failure" });
  assert.equal(JSON.stringify(result).includes("bad handle"), false);
});

test("plugs into the worker and retries without sending when capability proof is absent", async () => {
  const record = createGuideDocumentNotificationOutboxRecord({
    allowed: true,
    idempotencyKey: request.idempotencyKey,
    payload: request.payload,
  }, 1_000);
  let current = record;
  let sends = 0;
  const result = await processGuideDocumentNotificationOutboxRecord({
    record,
    now: 1_000,
    compareAndSet: async (expected, next) => {
      if (current !== expected) return false;
      current = next;
      return true;
    },
    sendIdempotently: (workerRequest) => dispatchGuideDocumentReadyNotification({
      recipient,
      request: workerRequest,
      adapter: {
        getCapabilities: async () => ({ idempotencyMode: "none", requestSchemaVersion: 1 }),
        send: async () => {
          sends += 1;
          return { outcome: "delivered" };
        },
      },
    }),
  });
  assert.deepEqual(result, {
    action: "delivery_attempted",
    outcome: "temporary_failure",
    persisted: true,
  });
  assert.equal(current.status, "retryable_failed");
  assert.equal(sends, 0);
});
