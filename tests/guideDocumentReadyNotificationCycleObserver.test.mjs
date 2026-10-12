import assert from "node:assert/strict";
import test from "node:test";

import { observeGuideDocumentReadyNotificationCycle } from "../lib/server/guideDocumentReadyNotificationCycleObserver.ts";

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
    observeSummary: () => {},
    ...overrides,
  };
}

test("gives observers only an immutable fixed summary", async () => {
  let observed;
  const summary = await observeGuideDocumentReadyNotificationCycle(input({
    observeSummary: (value) => { observed = value; },
  }));
  assert.equal(observed, summary);
  assert.deepEqual(Object.keys(summary).sort(), [
    "admission", "batch", "counts", "release", "schemaVersion",
  ]);
  assert.equal(summary.admission, "executed");
  assert.equal(summary.release, "confirmed");
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.counts), true);
  assert.doesNotMatch(JSON.stringify(summary), /cycle_run|owner|recipient|payload|provider/);
});

test("reports busy without loading candidates or private data", async () => {
  let laterCalls = 0;
  const summary = await observeGuideDocumentReadyNotificationCycle(input({
    cycle: cycle({
      loadCandidates: async () => { laterCalls += 1; return []; },
      loadBinding: async () => { laterCalls += 1; return null; },
      loadDocument: async () => { laterCalls += 1; return null; },
      loadRecipient: async () => { laterCalls += 1; return null; },
    }),
    loadLease: async () => active(),
    compareAndSetLease: async () => { throw new Error("must not claim"); },
  }));
  assert.equal(summary.admission, "busy");
  assert.equal(summary.release, "not_applicable");
  assert.equal(laterCalls, 0);
});

test("converts admission validation exceptions to one fixed failed summary", async () => {
  let observations = 0;
  let privateFailures = 0;
  const summary = await observeGuideDocumentReadyNotificationCycle(input({
    runId: "private-invalid-run-id-with spaces",
    loadLease: async () => { throw new Error("must not load"); },
    observeSummary: () => { observations += 1; },
    onPrivateError: () => { privateFailures += 1; },
  }));
  assert.equal(observations, 1);
  assert.equal(privateFailures, 1);
  assert.deepEqual(summary, {
    schemaVersion: 1,
    admission: "failed",
    release: "unknown",
    batch: "not_run",
    counts: {
      candidates: 0,
      attempted: 0,
      delivered: 0,
      temporaryFailures: 0,
      permanentFailures: 0,
      leasesRecovered: 0,
      skipped: 0,
      persistenceUncertain: 0,
      privateFailures: 0,
    },
  });
  assert.doesNotMatch(JSON.stringify(summary), /private-invalid|spaces/);
});

test("contains an observer exception without changing the returned summary", async () => {
  let privateFailures = 0;
  const summary = await observeGuideDocumentReadyNotificationCycle(input({
    observeSummary: () => { throw new Error("private observer detail"); },
    onPrivateError: () => { privateFailures += 1; },
  }));
  assert.equal(summary.admission, "executed");
  assert.equal(summary.release, "confirmed");
  assert.equal(privateFailures, 1);
  assert.doesNotMatch(JSON.stringify(summary), /observer|detail/);
});

test("contains a rejected asynchronous observer", async () => {
  let privateFailures = 0;
  const summary = await observeGuideDocumentReadyNotificationCycle(input({
    observeSummary: async () => { throw new Error("private async detail"); },
    onPrivateError: () => { privateFailures += 1; },
  }));
  assert.equal(summary.admission, "executed");
  assert.equal(privateFailures, 1);
});

test("contains a failing private-error reporter", async () => {
  const summary = await observeGuideDocumentReadyNotificationCycle(input({
    observeSummary: () => { throw new Error("private observer detail"); },
    onPrivateError: () => { throw new Error("private reporter detail"); },
  }));
  assert.equal(summary.admission, "executed");
  assert.doesNotMatch(JSON.stringify(summary), /observer|reporter|detail/);
});

test("contains hostile monitoring accessors", async () => {
  const hostile = input();
  Object.defineProperties(hostile, {
    observeSummary: {
      enumerable: true,
      get() { throw new Error("private observer getter"); },
    },
    onPrivateError: {
      enumerable: true,
      get() { throw new Error("private reporter getter"); },
    },
  });
  const summary = await observeGuideDocumentReadyNotificationCycle(hostile);
  assert.equal(summary.admission, "failed");
  assert.equal(summary.release, "unknown");
  assert.doesNotMatch(JSON.stringify(summary), /observer|reporter|getter/);
});

test("keeps candidate-load failure details behind a generic summary", async () => {
  let observed;
  const summary = await observeGuideDocumentReadyNotificationCycle(input({
    cycle: cycle({
      loadCandidates: async () => { throw new Error("private database detail"); },
    }),
    observeSummary: (value) => { observed = value; },
  }));
  assert.equal(observed, summary);
  assert.equal(summary.admission, "executed");
  assert.equal(summary.batch, "load_failed");
  assert.deepEqual(summary.counts, {
    candidates: 0,
    attempted: 0,
    delivered: 0,
    temporaryFailures: 0,
    permanentFailures: 0,
    leasesRecovered: 0,
    skipped: 0,
    persistenceUncertain: 0,
    privateFailures: 0,
  });
  assert.doesNotMatch(JSON.stringify(summary), /database|detail/);
});
