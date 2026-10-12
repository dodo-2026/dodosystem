import assert from "node:assert/strict";
import test from "node:test";

import { runAdmittedGuideDocumentReadyNotificationCycle } from "../lib/server/guideDocumentReadyNotificationCycleAdmission.ts";

const runId = "cycle_run_0000000000000001";
const activeRunId = "cycle_run_0000000000000002";
const emptyBatch = Object.freeze({
  status: "processed",
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

function idle(updatedAt = 900) {
  return Object.freeze({
    key: "guide-document-ready-cycle-v1",
    status: "idle",
    ownerRunId: null,
    updatedAt,
    leaseExpiresAt: null,
  });
}

function running(ownerRunId = activeRunId, updatedAt = 900, leaseExpiresAt = 1_100) {
  return Object.freeze({
    key: "guide-document-ready-cycle-v1",
    status: "running",
    ownerRunId,
    updatedAt,
    leaseExpiresAt,
  });
}

function createLeaseStore(initial) {
  let current = initial;
  return {
    get current() { return current; },
    loadLease: async () => current,
    compareAndSetLease: async (expected, next) => {
      if (current !== expected) return false;
      current = next;
      return true;
    },
  };
}

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

test("claims before loading candidates and releases after one cycle", async () => {
  const calls = [];
  const store = createLeaseStore(idle());
  const result = await runAdmittedGuideDocumentReadyNotificationCycle({
    runId,
    cycle: cycle({
      loadCandidates: async () => {
        calls.push(["load-candidates", store.current.status, store.current.ownerRunId]);
        return [];
      },
    }),
    loadLease: async () => {
      calls.push(["load-lease"]);
      return store.current;
    },
    compareAndSetLease: async (expected, next) => {
      calls.push(["lease-cas", expected?.status ?? null, next.status]);
      return store.compareAndSetLease(expected, next);
    },
  });
  assert.deepEqual(calls, [
    ["load-lease"],
    ["lease-cas", "idle", "running"],
    ["load-candidates", "running", runId],
    ["lease-cas", "running", "idle"],
  ]);
  assert.deepEqual(result, { status: "executed", batch: emptyBatch, releasePersisted: true });
  assert.equal(store.current.status, "idle");
});

test("an active lease stops before candidate and private-data reads", async () => {
  let laterCalls = 0;
  const store = createLeaseStore(running());
  const result = await runAdmittedGuideDocumentReadyNotificationCycle({
    runId,
    cycle: cycle({
      loadCandidates: async () => { laterCalls += 1; return []; },
      loadBinding: async () => { laterCalls += 1; return null; },
      loadDocument: async () => { laterCalls += 1; return null; },
      loadRecipient: async () => { laterCalls += 1; return null; },
    }),
    loadLease: store.loadLease,
    compareAndSetLease: store.compareAndSetLease,
  });
  assert.deepEqual(result, { status: "skipped", reason: "busy" });
  assert.equal(laterCalls, 0);
  assert.equal(store.current.ownerRunId, activeRunId);
});

test("atomically replaces an expired lease and safely releases its own claim", async () => {
  const expired = running(activeRunId, 800, 900);
  const store = createLeaseStore(expired);
  const result = await runAdmittedGuideDocumentReadyNotificationCycle({
    runId,
    cycle: cycle(),
    loadLease: store.loadLease,
    compareAndSetLease: store.compareAndSetLease,
    admissionLeaseSeconds: 120,
  });
  assert.equal(result.status, "executed");
  assert.equal(result.releasePersisted, true);
  assert.equal(store.current.status, "idle");
  assert.equal(store.current.updatedAt, 1_000);
});

test("only one concurrent invocation wins admission", async () => {
  const store = createLeaseStore(null);
  let cycleLoads = 0;
  let releaseFirst;
  const firstLoaded = new Promise((resolve) => { releaseFirst = resolve; });
  const guardedCycle = cycle({
    loadCandidates: async () => {
      cycleLoads += 1;
      await firstLoaded;
      return [];
    },
  });
  const first = runAdmittedGuideDocumentReadyNotificationCycle({
    runId,
    cycle: guardedCycle,
    loadLease: store.loadLease,
    compareAndSetLease: store.compareAndSetLease,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await runAdmittedGuideDocumentReadyNotificationCycle({
    runId: activeRunId,
    cycle: cycle(),
    loadLease: store.loadLease,
    compareAndSetLease: store.compareAndSetLease,
  });
  releaseFirst();
  const firstResult = await first;
  assert.equal(firstResult.status, "executed");
  assert.deepEqual(second, { status: "skipped", reason: "busy" });
  assert.equal(cycleLoads, 1);
});

test("contains malformed or failing lease loads before cycle work", async () => {
  for (const loadLease of [
    async () => ({ ...idle(), extra: "private" }),
    async () => { throw new Error("private database detail"); },
  ]) {
    let candidateLoads = 0;
    let observed = 0;
    const result = await runAdmittedGuideDocumentReadyNotificationCycle({
      runId,
      cycle: cycle({ loadCandidates: async () => { candidateLoads += 1; return []; } }),
      loadLease,
      compareAndSetLease: async () => true,
      onPrivateError: () => { observed += 1; },
    });
    assert.deepEqual(result, { status: "failed", releasePersisted: false });
    assert.equal(candidateLoads, 0);
    assert.equal(observed, 1);
    assert.doesNotMatch(JSON.stringify(result), /database|detail|private/);
  }
});

test("releases the lease after a cycle validation failure", async () => {
  const store = createLeaseStore(null);
  let observed = 0;
  const result = await runAdmittedGuideDocumentReadyNotificationCycle({
    runId,
    cycle: cycle({ maximum: 26 }),
    loadLease: store.loadLease,
    compareAndSetLease: store.compareAndSetLease,
    onPrivateError: () => { observed += 1; },
  });
  assert.deepEqual(result, { status: "failed", releasePersisted: true });
  assert.equal(store.current.status, "idle");
  assert.equal(observed, 1);
});

test("reports an uncertain release without exposing or overwriting a newer lease", async () => {
  const original = idle();
  let current = original;
  let writes = 0;
  const result = await runAdmittedGuideDocumentReadyNotificationCycle({
    runId,
    cycle: cycle(),
    loadLease: async () => current,
    compareAndSetLease: async (expected, next) => {
      writes += 1;
      if (writes === 1 && current === expected) {
        current = next;
        return true;
      }
      current = running(activeRunId, 1_000, 1_200);
      return false;
    },
  });
  assert.equal(result.status, "executed");
  assert.equal(result.releasePersisted, false);
  assert.equal(current.ownerRunId, activeRunId);
  assert.doesNotMatch(JSON.stringify(result), /cycle_run/);
});

test("validates run identity and lease bounds before persistence", async () => {
  let loads = 0;
  for (const options of [
    { runId: "short", admissionLeaseSeconds: 300 },
    { runId, admissionLeaseSeconds: 0 },
    { runId, admissionLeaseSeconds: 901 },
  ]) {
    await assert.rejects(
      () => runAdmittedGuideDocumentReadyNotificationCycle({
        ...options,
        cycle: cycle(),
        loadLease: async () => { loads += 1; return null; },
        compareAndSetLease: async () => true,
      }),
      /runId|admissionLeaseSeconds/
    );
  }
  assert.equal(loads, 0);
});
