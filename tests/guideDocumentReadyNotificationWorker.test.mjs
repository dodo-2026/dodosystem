import assert from "node:assert/strict";
import test from "node:test";

import { createGuideDocumentNotificationOutboxRecord } from "../lib/server/guideDocumentReadyNotificationOutbox.ts";
import { processGuideDocumentNotificationOutboxRecord } from "../lib/server/guideDocumentReadyNotificationWorker.ts";

const decision = {
  allowed: true,
  idempotencyKey: `guide-document-ready:${"b".repeat(64)}`,
  payload: {
    schemaVersion: 1,
    event: "guide.document-ready",
    title: "書類の準備ができました",
    body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
    actionLabel: "DODOで確認する",
  },
};

function createStore(initial) {
  let current = initial;
  return {
    get current() {
      return current;
    },
    compareAndSet: async (expected, next) => {
      if (current !== expected) return false;
      current = next;
      return true;
    },
  };
}

test("claims atomically before sending the exact public payload and idempotency key", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const store = createStore(pending);
  const requests = [];
  const result = await processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    compareAndSet: store.compareAndSet,
    sendIdempotently: async (request) => {
      requests.push(request);
      return { outcome: "delivered" };
    },
  });

  assert.deepEqual(result, {
    action: "delivery_attempted",
    outcome: "delivered",
    persisted: true,
  });
  assert.deepEqual(requests, [{ idempotencyKey: decision.idempotencyKey, payload: decision.payload }]);
  assert.equal(Object.isFrozen(requests[0]), true);
  assert.equal(store.current.status, "delivered");
});

test("does not send when another worker wins the lease claim", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  let sends = 0;
  const result = await processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    compareAndSet: async () => false,
    sendIdempotently: async () => {
      sends += 1;
      return { outcome: "delivered" };
    },
  });
  assert.deepEqual(result, { action: "none", reason: "claim_conflict" });
  assert.equal(sends, 0);
});

test("only one concurrent worker sends from the same candidate", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const store = createStore(pending);
  let sends = 0;
  const run = () => processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    compareAndSet: store.compareAndSet,
    sendIdempotently: async () => {
      sends += 1;
      return { outcome: "delivered" };
    },
  });
  const results = await Promise.all([run(), run()]);
  assert.equal(sends, 1);
  assert.equal(results.filter((result) => result.action === "delivery_attempted").length, 1);
  assert.equal(results.filter((result) => result.reason === "claim_conflict").length, 1);
});

test("maps a thrown provider call to a generic retry without storing its error", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const store = createStore(pending);
  let privateFailures = 0;
  const result = await processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    retryDelaySeconds: 90,
    compareAndSet: store.compareAndSet,
    sendIdempotently: async () => {
      throw new Error("provider secret response");
    },
    onPrivateError: () => {
      privateFailures += 1;
    },
  });
  assert.deepEqual(result, {
    action: "delivery_attempted",
    outcome: "temporary_failure",
    persisted: true,
  });
  assert.equal(privateFailures, 1);
  assert.equal(store.current.status, "retryable_failed");
  assert.equal(store.current.availableAt, 1_090);
  assert.doesNotMatch(JSON.stringify(store.current), /provider secret response/);
});

test("fails a malformed provider response closed as a retryable outcome", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const store = createStore(pending);
  const result = await processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    compareAndSet: store.compareAndSet,
    sendIdempotently: async () => ({ outcome: "delivered", receipt: "unsafe-detail" }),
  });
  assert.equal(result.outcome, "temporary_failure");
  assert.equal(store.current.status, "retryable_failed");
  assert.equal("receipt" in store.current, false);
});

test("persists a permanent provider denial without retaining provider details", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const store = createStore(pending);
  const result = await processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    compareAndSet: store.compareAndSet,
    sendIdempotently: async () => ({ outcome: "permanent_failure" }),
  });
  assert.deepEqual(result, {
    action: "delivery_attempted",
    outcome: "permanent_failure",
    persisted: true,
  });
  assert.equal(store.current.status, "terminal_failed");
  assert.equal(store.current.failureCode, "permanent");
  assert.deepEqual(Object.keys(store.current).sort(), [
    "attemptCount",
    "availableAt",
    "createdAt",
    "deliveredAt",
    "failureCode",
    "idempotencyKey",
    "leaseExpiresAt",
    "payload",
    "status",
    "updatedAt",
  ]);
});

test("keeps an uncertain successful completion leased for idempotent recovery", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  let writes = 0;
  const result = await processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    compareAndSet: async () => {
      writes += 1;
      return writes === 1;
    },
    sendIdempotently: async () => ({ outcome: "delivered" }),
  });
  assert.deepEqual(result, {
    action: "delivery_attempted",
    outcome: "delivered",
    persisted: false,
  });
});

test("recovers an expired lease without sending in the same worker pass", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const firstStore = createStore(pending);
  await processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    compareAndSet: async (expected, next) => {
      if (firstStore.current !== expected) return false;
      await firstStore.compareAndSet(expected, next);
      return false;
    },
    sendIdempotently: async () => ({ outcome: "delivered" }),
  });
  assert.equal(firstStore.current.status, "delivering");

  const recoveryStore = createStore(firstStore.current);
  let sends = 0;
  const recovered = await processGuideDocumentNotificationOutboxRecord({
    record: firstStore.current,
    now: 1_060,
    compareAndSet: recoveryStore.compareAndSet,
    sendIdempotently: async () => {
      sends += 1;
      return { outcome: "delivered" };
    },
  });
  assert.deepEqual(recovered, { action: "lease_recovered", persisted: true });
  assert.equal(recoveryStore.current.status, "retryable_failed");
  assert.equal(sends, 0);
});

test("does not send and contains compare-and-set failures", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  let sends = 0;
  const privateEvents = [];
  const result = await processGuideDocumentNotificationOutboxRecord({
    record: pending,
    now: 1_000,
    compareAndSet: async () => {
      throw new Error("database detail");
    },
    sendIdempotently: async () => {
      sends += 1;
      return { outcome: "delivered" };
    },
    onPrivateError: () => privateEvents.push("failed"),
  });
  assert.deepEqual(result, { action: "none", reason: "private_failure" });
  assert.equal(sends, 0);
  assert.deepEqual(privateEvents, ["failed"]);
});
