import assert from "node:assert/strict";
import test from "node:test";

import { summarizeGuideDocumentReadyNotificationCycle } from "../lib/server/guideDocumentReadyNotificationCycleSummary.ts";

function batch(overrides = {}) {
  return {
    status: "processed",
    candidates: 4,
    attempted: 2,
    delivered: 1,
    temporaryFailures: 1,
    permanentFailures: 0,
    leasesRecovered: 1,
    skipped: 1,
    persistenceUncertain: 1,
    privateFailures: 1,
    ...overrides,
  };
}

test("builds an immutable counter-only summary for an executed cycle", () => {
  const summary = summarizeGuideDocumentReadyNotificationCycle({
    status: "executed",
    batch: batch(),
    releasePersisted: true,
  });
  assert.deepEqual(summary, {
    schemaVersion: 1,
    admission: "executed",
    release: "confirmed",
    batch: "processed",
    counts: {
      candidates: 4,
      attempted: 2,
      delivered: 1,
      temporaryFailures: 1,
      permanentFailures: 0,
      leasesRecovered: 1,
      skipped: 1,
      persistenceUncertain: 1,
      privateFailures: 1,
    },
  });
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.counts), true);
});

test("marks an uncertain release without exposing internal lease identity", () => {
  const summary = summarizeGuideDocumentReadyNotificationCycle({
    status: "executed",
    batch: batch(),
    releasePersisted: false,
  });
  assert.equal(summary.release, "uncertain");
  assert.doesNotMatch(JSON.stringify(summary), /run|owner|leaseExpiresAt|idempotency|recipient/);
});

test("represents a candidate load failure with fixed zero counts", () => {
  const summary = summarizeGuideDocumentReadyNotificationCycle({
    status: "executed",
    batch: batch({
      status: "load_failed",
      candidates: 0,
      attempted: 0,
      delivered: 0,
      temporaryFailures: 0,
      permanentFailures: 0,
      leasesRecovered: 0,
      skipped: 0,
      persistenceUncertain: 0,
      privateFailures: 0,
    }),
    releasePersisted: true,
  });
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
});

test("maps busy and claim-conflict skips to generic non-running states", () => {
  assert.deepEqual(
    summarizeGuideDocumentReadyNotificationCycle({ status: "skipped", reason: "busy" }),
    {
      schemaVersion: 1,
      admission: "busy",
      release: "not_applicable",
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
    }
  );
  assert.equal(
    summarizeGuideDocumentReadyNotificationCycle({
      status: "skipped",
      reason: "claim_conflict",
    }).admission,
    "contended"
  );
});

test("keeps failed-cycle release state generic", () => {
  const released = summarizeGuideDocumentReadyNotificationCycle({
    status: "failed",
    releasePersisted: true,
  });
  const unknown = summarizeGuideDocumentReadyNotificationCycle({
    status: "failed",
    releasePersisted: false,
  });
  assert.equal(released.release, "confirmed");
  assert.equal(unknown.release, "unknown");
  assert.equal(released.batch, "not_run");
  assert.equal(unknown.batch, "not_run");
});

test("fails closed on inconsistent or oversized batch counters", () => {
  for (const invalidBatch of [
    batch({ candidates: 3 }),
    batch({ delivered: 2 }),
    batch({ candidates: 26, attempted: 25, delivered: 24, skipped: 0 }),
    batch({ persistenceUncertain: 4 }),
    batch({ privateFailures: 2 }),
  ]) {
    const summary = summarizeGuideDocumentReadyNotificationCycle({
      status: "executed",
      batch: invalidBatch,
      releasePersisted: true,
    });
    assert.equal(summary.admission, "failed");
    assert.equal(summary.batch, "not_run");
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
  }
});

test("rejects expanded admission and batch shapes", () => {
  const expandedAdmission = summarizeGuideDocumentReadyNotificationCycle({
    status: "skipped",
    reason: "busy",
    ownerRunId: "private-run-id",
  });
  const expandedBatch = summarizeGuideDocumentReadyNotificationCycle({
    status: "executed",
    batch: batch({ recipient: "private-recipient" }),
    releasePersisted: true,
  });
  assert.equal(expandedAdmission.admission, "failed");
  assert.equal(expandedBatch.admission, "failed");
  assert.doesNotMatch(
    JSON.stringify([expandedAdmission, expandedBatch]),
    /private-run-id|private-recipient/
  );
});

test("contains hostile accessors behind the same fixed failure summary", () => {
  const hostile = Object.create(null, {
    status: {
      enumerable: true,
      get() { throw new Error("private storage detail"); },
    },
  });
  const summary = summarizeGuideDocumentReadyNotificationCycle(hostile);
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
  assert.doesNotMatch(JSON.stringify(summary), /private storage detail/);
});
