import assert from "node:assert/strict";
import test from "node:test";

import { runGuideDocumentReadyNotificationCycle } from "../lib/server/guideDocumentReadyNotificationCycle.ts";
import {
  beginGuideDocumentNotificationAttempt,
  createGuideDocumentNotificationOutboxRecord,
} from "../lib/server/guideDocumentReadyNotificationOutbox.ts";

const guideId = "123e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const payload = Object.freeze({
  schemaVersion: 1,
  event: "guide.document-ready",
  title: "書類の準備ができました",
  body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
  actionLabel: "DODOで確認する",
});
const capabilities = Object.freeze({
  idempotencyMode: "provider-key-v1",
  requestSchemaVersion: 1,
});

function record(character, now = 1_000) {
  return createGuideDocumentNotificationOutboxRecord({
    allowed: true,
    idempotencyKey: `guide-document-ready:${character.repeat(64)}`,
    payload,
  }, now);
}

function createStore(records, calls = []) {
  const current = new Map(records.map((item) => [item.idempotencyKey, item]));
  return {
    current,
    compareAndSet: async (expected, next) => {
      calls.push(["cas", expected.idempotencyKey, expected.status, next.status]);
      if (current.get(expected.idempotencyKey) !== expected) return false;
      current.set(expected.idempotencyKey, next);
      return true;
    },
  };
}

function cycleInputs(records, overrides = {}) {
  const store = createStore(records);
  return {
    store,
    input: {
      now: 1_000,
      loadCandidates: async () => records,
      compareAndSet: store.compareAndSet,
      loadBinding: async (idempotencyKey) => ({
        idempotencyKey,
        documentId,
        guideId,
        documentVersion: 3,
      }),
      loadDocument: async () => ({ documentId, guideId, version: 3, status: "final" }),
      loadRecipient: async () => ({
        guideId,
        status: "active",
        recipient: { kind: "provider-user-v1", handle: "guide_user_123" },
      }),
      adapter: {
        getCapabilities: async () => capabilities,
        send: async () => ({ outcome: "delivered" }),
      },
      ...overrides,
    },
  };
}

test("claims before private reads and completes candidates serially", async () => {
  const records = [record("a"), record("b")];
  const calls = [];
  const store = createStore(records, calls);
  let active = 0;
  let maximumActive = 0;
  const result = await runGuideDocumentReadyNotificationCycle({
    ...cycleInputs(records).input,
    compareAndSet: store.compareAndSet,
    loadBinding: async (idempotencyKey) => {
      calls.push(["binding", idempotencyKey]);
      return { idempotencyKey, documentId, guideId, documentVersion: 3 };
    },
    loadDocument: async () => {
      calls.push(["document"]);
      return { documentId, guideId, version: 3, status: "final" };
    },
    loadRecipient: async () => {
      calls.push(["recipient"]);
      return {
        guideId,
        status: "active",
        recipient: { kind: "provider-user-v1", handle: "guide_user_123" },
      };
    },
    adapter: {
      getCapabilities: async () => {
        calls.push(["capabilities"]);
        return capabilities;
      },
      send: async (request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        calls.push(["send", request.idempotencyKey]);
        await Promise.resolve();
        active -= 1;
        return { outcome: "delivered" };
      },
    },
  });

  assert.equal(maximumActive, 1);
  assert.deepEqual(result, {
    status: "processed",
    candidates: 2,
    attempted: 2,
    delivered: 2,
    temporaryFailures: 0,
    permanentFailures: 0,
    leasesRecovered: 0,
    skipped: 0,
    persistenceUncertain: 0,
    privateFailures: 0,
  });
  const firstSend = calls.findIndex((call) => call[0] === "send");
  const secondClaim = calls.findIndex((call) =>
    call[0] === "cas" && call[1] === records[1].idempotencyKey && call[3] === "delivering"
  );
  assert.deepEqual(calls.slice(0, 5).map((call) => call[0]), [
    "cas", "binding", "document", "recipient", "capabilities",
  ]);
  assert.ok(firstSend > 0);
  assert.ok(secondClaim > firstSend);
  assert.equal(store.current.get(records[0].idempotencyKey).status, "delivered");
  assert.equal(store.current.get(records[1].idempotencyKey).status, "delivered");
});

test("does not read private data when an outbox lease claim conflicts", async () => {
  const initial = record("c");
  let privateReads = 0;
  let adapterCalls = 0;
  const result = await runGuideDocumentReadyNotificationCycle({
    ...cycleInputs([initial]).input,
    compareAndSet: async () => false,
    loadBinding: async () => { privateReads += 1; return null; },
    loadDocument: async () => { privateReads += 1; return null; },
    loadRecipient: async () => { privateReads += 1; return null; },
    adapter: {
      getCapabilities: async () => { adapterCalls += 1; return capabilities; },
      send: async () => { adapterCalls += 1; return { outcome: "delivered" }; },
    },
  });
  assert.equal(result.skipped, 1);
  assert.equal(privateReads, 0);
  assert.equal(adapterCalls, 0);
});

test("turns an unresolved recipient into a persisted retry and continues", async () => {
  const records = [record("d"), record("e")];
  const { store, input } = cycleInputs(records);
  const sends = [];
  const result = await runGuideDocumentReadyNotificationCycle({
    ...input,
    loadBinding: async (idempotencyKey) => idempotencyKey === records[0].idempotencyKey
      ? null
      : { idempotencyKey, documentId, guideId, documentVersion: 3 },
    adapter: {
      getCapabilities: async () => capabilities,
      send: async (request) => {
        sends.push(request.idempotencyKey);
        return { outcome: "delivered" };
      },
    },
  });
  assert.equal(result.temporaryFailures, 1);
  assert.equal(result.delivered, 1);
  assert.deepEqual(sends, [records[1].idempotencyKey]);
  assert.equal(store.current.get(records[0].idempotencyKey).status, "retryable_failed");
  assert.equal(store.current.get(records[1].idempotencyKey).status, "delivered");
});

test("recovers an expired lease without private reads or adapter calls", async () => {
  const initial = record("f");
  const delivering = beginGuideDocumentNotificationAttempt({ record: initial, now: 1_000 }).record;
  const store = createStore([delivering]);
  let laterCalls = 0;
  const result = await runGuideDocumentReadyNotificationCycle({
    ...cycleInputs([delivering]).input,
    now: 1_060,
    compareAndSet: store.compareAndSet,
    loadBinding: async () => { laterCalls += 1; return null; },
    loadDocument: async () => { laterCalls += 1; return null; },
    loadRecipient: async () => { laterCalls += 1; return null; },
    adapter: {
      getCapabilities: async () => { laterCalls += 1; return capabilities; },
      send: async () => { laterCalls += 1; return { outcome: "delivered" }; },
    },
  });
  assert.equal(result.leasesRecovered, 1);
  assert.equal(laterCalls, 0);
  assert.equal(store.current.get(delivering.idempotencyKey).status, "retryable_failed");
});

test("forwards cycle bounds and contains a candidate-loader failure", async () => {
  let requested;
  let observed = 0;
  const { input } = cycleInputs([]);
  const processed = await runGuideDocumentReadyNotificationCycle({
    ...input,
    maximum: 4,
    leaseSeconds: 45,
    retryDelaySeconds: 120,
    loadCandidates: async (value) => {
      requested = value;
      return [];
    },
  });
  assert.deepEqual(requested, { now: 1_000, limit: 4 });
  assert.equal(Object.isFrozen(requested), true);
  assert.equal(processed.status, "processed");

  const failed = await runGuideDocumentReadyNotificationCycle({
    ...input,
    loadCandidates: async () => { throw new Error("private store detail"); },
    onPrivateError: () => { observed += 1; },
  });
  assert.equal(failed.status, "load_failed");
  assert.equal(observed, 1);
  assert.doesNotMatch(JSON.stringify(failed), /store|detail/);
});

test("contains adapter exceptions and records a generic retry", async () => {
  const initial = record("1");
  const { store, input } = cycleInputs([initial]);
  let observed = 0;
  const result = await runGuideDocumentReadyNotificationCycle({
    ...input,
    adapter: {
      getCapabilities: async () => capabilities,
      send: async () => { throw new Error("private provider detail"); },
    },
    onPrivateError: () => { observed += 1; },
  });
  assert.equal(result.temporaryFailures, 1);
  assert.equal(store.current.get(initial.idempotencyKey).status, "retryable_failed");
  assert.equal(observed, 1);
  assert.doesNotMatch(JSON.stringify(result), /provider|detail/);
});
