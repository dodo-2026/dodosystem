import assert from "node:assert/strict";
import test from "node:test";

import { observeGuideDocumentReadyNotificationOperationalState } from "../lib/server/guideDocumentReadyNotificationOperationalObserver.ts";

const runId = "cycle_run_0000000000000001";

function cycle(overrides = {}) {
  return {
    now: 1_000,
    loadCandidates: async () => [],
    compareAndSet: async () => true,
    loadBinding: async () => null,
    loadDocument: async () => null,
    loadRecipient: async () => null,
    adapter: {
      getCapabilities: async () => ({
        idempotencyMode: "provider-key-v1",
        requestSchemaVersion: 1,
      }),
      send: async () => ({ outcome: "delivered" }),
    },
    ...overrides,
  };
}

function idle() {
  return Object.freeze({
    key: "guide-document-ready-cycle-v1",
    status: "idle",
    ownerRunId: null,
    updatedAt: 900,
    leaseExpiresAt: null,
  });
}

function active() {
  return Object.freeze({
    key: "guide-document-ready-cycle-v1",
    status: "running",
    ownerRunId: "cycle_run_0000000000000002",
    updatedAt: 900,
    leaseExpiresAt: 1_100,
  });
}

function createLeaseStore(initial = idle()) {
  let current = initial;
  return {
    loadLease: async () => current,
    compareAndSetLease: async (expected, next) => {
      if (current !== expected) return false;
      current = next;
      return true;
    },
  };
}

function input(overrides = {}) {
  const store = createLeaseStore();
  return {
    runId,
    cycle: cycle(),
    loadLease: store.loadLease,
    compareAndSetLease: store.compareAndSetLease,
    observeAttention: () => {},
    ...overrides,
  };
}

test("observes only the immutable fixed attention state", async () => {
  let observed;
  const source = input({
    observeAttention: (value) => { observed = value; },
  });
  Object.defineProperty(source, "observeSummary", {
    enumerable: true,
    get() { throw new Error("counter-bearing summary must stay private"); },
  });
  const attention = await observeGuideDocumentReadyNotificationOperationalState(source);
  assert.equal(observed, attention);
  assert.deepEqual(attention, {
    schemaVersion: 1,
    level: "none",
    reason: "healthy",
  });
  assert.equal(Object.isFrozen(attention), true);
  assert.deepEqual(Object.keys(attention).sort(), ["level", "reason", "schemaVersion"]);
  assert.doesNotMatch(JSON.stringify(attention), /counts|candidates|summary|private/);
});

test("maps active admission to review before candidate reads", async () => {
  let candidateReads = 0;
  const attention = await observeGuideDocumentReadyNotificationOperationalState(input({
    cycle: cycle({
      loadCandidates: async () => { candidateReads += 1; return []; },
    }),
    loadLease: async () => active(),
    compareAndSetLease: async () => { throw new Error("must not claim"); },
  }));
  assert.deepEqual(attention, {
    schemaVersion: 1,
    level: "review",
    reason: "admission_delayed",
  });
  assert.equal(candidateReads, 0);
});

test("maps a contained candidate-load failure to fixed action", async () => {
  const attention = await observeGuideDocumentReadyNotificationOperationalState(input({
    cycle: cycle({
      loadCandidates: async () => { throw new Error("private database detail"); },
    }),
  }));
  assert.deepEqual(attention, {
    schemaVersion: 1,
    level: "action_required",
    reason: "load_failed",
  });
  assert.doesNotMatch(JSON.stringify(attention), /database|detail/);
});

test("maps invalid admission input to one fixed cycle failure", async () => {
  let observations = 0;
  const attention = await observeGuideDocumentReadyNotificationOperationalState(input({
    runId: "private invalid run id",
    loadLease: async () => { throw new Error("must not load"); },
    observeAttention: () => { observations += 1; },
  }));
  assert.equal(observations, 1);
  assert.deepEqual(attention, {
    schemaVersion: 1,
    level: "action_required",
    reason: "cycle_failed",
  });
  assert.doesNotMatch(JSON.stringify(attention), /private|run|id/);
});

test("contains a synchronous attention observer exception", async () => {
  let privateFailures = 0;
  const attention = await observeGuideDocumentReadyNotificationOperationalState(input({
    observeAttention: () => { throw new Error("private observer detail"); },
    onPrivateError: () => { privateFailures += 1; },
  }));
  assert.equal(attention.reason, "healthy");
  assert.equal(privateFailures, 1);
});

test("contains a rejected asynchronous attention observer", async () => {
  let privateFailures = 0;
  const attention = await observeGuideDocumentReadyNotificationOperationalState(input({
    observeAttention: async () => { throw new Error("private async detail"); },
    onPrivateError: () => { privateFailures += 1; },
  }));
  assert.equal(attention.reason, "healthy");
  assert.equal(privateFailures, 1);
});

test("contains a hostile attention observer accessor", async () => {
  let privateFailures = 0;
  const hostile = input({
    onPrivateError: () => { privateFailures += 1; },
  });
  Object.defineProperty(hostile, "observeAttention", {
    enumerable: true,
    get() { throw new Error("private observer getter"); },
  });
  const attention = await observeGuideDocumentReadyNotificationOperationalState(hostile);
  assert.equal(attention.reason, "healthy");
  assert.equal(privateFailures, 1);
  assert.doesNotMatch(JSON.stringify(attention), /private|observer|getter/);
});

test("contains a failing private-error reporter", async () => {
  const attention = await observeGuideDocumentReadyNotificationOperationalState(input({
    observeAttention: () => { throw new Error("private observer detail"); },
    onPrivateError: () => { throw new Error("private reporter detail"); },
  }));
  assert.equal(attention.reason, "healthy");
  assert.doesNotMatch(JSON.stringify(attention), /private|observer|reporter|detail/);
});
