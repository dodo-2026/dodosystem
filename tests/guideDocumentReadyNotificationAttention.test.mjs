import assert from "node:assert/strict";
import test from "node:test";

import { classifyGuideDocumentReadyNotificationAttention } from "../lib/server/guideDocumentReadyNotificationAttention.ts";

function counts(overrides = {}) {
  return {
    candidates: 0,
    attempted: 0,
    delivered: 0,
    temporaryFailures: 0,
    permanentFailures: 0,
    leasesRecovered: 0,
    skipped: 0,
    persistenceUncertain: 0,
    privateFailures: 0,
    ...overrides,
  };
}

function processed(overrides = {}) {
  return {
    schemaVersion: 1,
    admission: "executed",
    release: "confirmed",
    batch: "processed",
    counts: counts(),
    ...overrides,
  };
}

test("marks a clean processed cycle as requiring no attention", () => {
  const attention = classifyGuideDocumentReadyNotificationAttention(processed());
  assert.deepEqual(attention, { schemaVersion: 1, level: "none", reason: "healthy" });
  assert.equal(Object.isFrozen(attention), true);
  assert.deepEqual(Object.keys(attention).sort(), ["level", "reason", "schemaVersion"]);
});

test("marks busy and contended admission for generic review", () => {
  for (const admission of ["busy", "contended"]) {
    assert.deepEqual(classifyGuideDocumentReadyNotificationAttention({
      schemaVersion: 1,
      admission,
      release: "not_applicable",
      batch: "not_run",
      counts: counts(),
    }), {
      schemaVersion: 1,
      level: "review",
      reason: "admission_delayed",
    });
  }
});

test("requires action for a failed cycle or uncertain release", () => {
  assert.equal(classifyGuideDocumentReadyNotificationAttention({
    schemaVersion: 1,
    admission: "failed",
    release: "confirmed",
    batch: "not_run",
    counts: counts(),
  }).reason, "cycle_failed");
  assert.equal(classifyGuideDocumentReadyNotificationAttention(processed({
    release: "uncertain",
  })).reason, "release_uncertain");
});

test("requires action when loading candidates failed", () => {
  assert.deepEqual(classifyGuideDocumentReadyNotificationAttention(processed({
    batch: "load_failed",
  })), {
    schemaVersion: 1,
    level: "action_required",
    reason: "load_failed",
  });
});

test("prioritizes persistence, permanent, and private failures", () => {
  const cases = [
    [counts({ candidates: 1, attempted: 1, delivered: 1, persistenceUncertain: 1 }), "persistence_uncertain"],
    [counts({ candidates: 1, attempted: 1, permanentFailures: 1 }), "permanent_failures"],
    [counts({ candidates: 1, skipped: 1, privateFailures: 1 }), "private_failures"],
  ];
  for (const [cycleCounts, reason] of cases) {
    const attention = classifyGuideDocumentReadyNotificationAttention(processed({ counts: cycleCounts }));
    assert.equal(attention.level, "action_required");
    assert.equal(attention.reason, reason);
  }
});

test("uses bounded review reasons for retry, recovery, and skipped work", () => {
  const cases = [
    [counts({ candidates: 1, attempted: 1, temporaryFailures: 1 }), "retry_pending"],
    [counts({ candidates: 1, leasesRecovered: 1 }), "lease_recovery"],
    [counts({ candidates: 1, skipped: 1 }), "candidates_skipped"],
  ];
  for (const [cycleCounts, reason] of cases) {
    const attention = classifyGuideDocumentReadyNotificationAttention(processed({ counts: cycleCounts }));
    assert.equal(attention.level, "review");
    assert.equal(attention.reason, reason);
  }
});

test("fails closed on expanded, oversized, and inconsistent summaries", () => {
  for (const invalid of [
    processed({ recipient: "private-recipient" }),
    processed({ counts: counts({ candidates: 26, skipped: 26 }) }),
    processed({ counts: counts({ candidates: 1, delivered: 1 }) }),
    processed({ batch: "not_run" }),
    processed({ schemaVersion: 2 }),
  ]) {
    assert.deepEqual(classifyGuideDocumentReadyNotificationAttention(invalid), {
      schemaVersion: 1,
      level: "action_required",
      reason: "invalid_summary",
    });
  }
});

test("contains hostile accessors without exposing their details", () => {
  const hostile = Object.create(null, {
    admission: {
      enumerable: true,
      get() { throw new Error("private storage detail"); },
    },
  });
  const attention = classifyGuideDocumentReadyNotificationAttention(hostile);
  assert.deepEqual(attention, {
    schemaVersion: 1,
    level: "action_required",
    reason: "invalid_summary",
  });
  assert.doesNotMatch(JSON.stringify(attention), /private|storage|detail/);
});
