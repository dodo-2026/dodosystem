import assert from "node:assert/strict";
import test from "node:test";

import {
  beginGuideDocumentNotificationAttempt,
  completeGuideDocumentNotificationAttempt,
  createGuideDocumentNotificationOutboxRecord,
  recoverExpiredGuideDocumentNotificationLease,
} from "../lib/server/guideDocumentReadyNotificationOutbox.ts";

const decision = {
  allowed: true,
  idempotencyKey: `guide-document-ready:${"a".repeat(64)}`,
  payload: {
    schemaVersion: 1,
    event: "guide.document-ready",
    title: "書類の準備ができました",
    body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
    actionLabel: "DODOで確認する",
  },
};

test("creates a frozen pending record containing only the allowlisted public payload", () => {
  const record = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  assert.equal(record.status, "pending");
  assert.equal(record.attemptCount, 0);
  assert.equal(record.availableAt, 1_000);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.payload), true);
  assert.doesNotMatch(JSON.stringify(record.payload), /token|cookie|session|https?:|pdf|uuid/i);
});

test("starts a bounded lease only when the record is available", () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const started = beginGuideDocumentNotificationAttempt({ record: pending, now: 1_000 });
  assert.equal(started.applied, true);
  assert.equal(started.record.status, "delivering");
  assert.equal(started.record.attemptCount, 1);
  assert.equal(started.record.leaseExpiresAt, 1_060);

  const duplicate = beginGuideDocumentNotificationAttempt({ record: started.record, now: 1_001 });
  assert.equal(duplicate.applied, false);
  assert.deepEqual(duplicate.record, started.record);
});

test("marks one delivery final and does not reopen it", () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const started = beginGuideDocumentNotificationAttempt({ record: pending, now: 1_000 });
  const completed = completeGuideDocumentNotificationAttempt({
    record: started.record,
    outcome: "delivered",
    now: 1_010,
  });
  assert.equal(completed.record.status, "delivered");
  assert.equal(completed.record.deliveredAt, 1_010);
  assert.equal(
    beginGuideDocumentNotificationAttempt({ record: completed.record, now: 2_000 }).applied,
    false
  );
});

test("waits until retryAt and stops after the third temporary failure", () => {
  let record = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = beginGuideDocumentNotificationAttempt({ record, now: 1_000 + attempt * 100 });
    assert.equal(started.applied, true);
    const failed = completeGuideDocumentNotificationAttempt({
      record: started.record,
      outcome: "temporary_failure",
      now: 1_010 + attempt * 100,
      ...(attempt < 3 ? { retryAt: 1_100 + attempt * 100 } : {}),
    });
    record = failed.record;
    assert.equal(record.attemptCount, attempt);
    assert.equal(record.status, attempt < 3 ? "retryable_failed" : "terminal_failed");
    if (attempt < 3) {
      assert.equal(
        beginGuideDocumentNotificationAttempt({ record, now: record.availableAt - 1 }).applied,
        false
      );
    }
  }
  assert.equal(record.failureCode, "attempt_limit");
});

test("marks a permanent provider rejection terminal without storing provider details", () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const started = beginGuideDocumentNotificationAttempt({ record: pending, now: 1_000 });
  const failed = completeGuideDocumentNotificationAttempt({
    record: started.record,
    outcome: "permanent_failure",
    now: 1_005,
  });
  assert.equal(failed.record.status, "terminal_failed");
  assert.equal(failed.record.failureCode, "permanent");
  assert.equal("error" in failed.record, false);
  assert.equal("providerResponse" in failed.record, false);
});

test("recovers an expired worker lease but not an active one", () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  const started = beginGuideDocumentNotificationAttempt({ record: pending, now: 1_000 });
  assert.equal(
    recoverExpiredGuideDocumentNotificationLease({
      record: started.record,
      now: 1_059,
      retryAt: 1_100,
    }).applied,
    false
  );
  const recovered = recoverExpiredGuideDocumentNotificationLease({
    record: started.record,
    now: 1_060,
    retryAt: 1_100,
  });
  assert.equal(recovered.applied, true);
  assert.equal(recovered.record.status, "retryable_failed");
  assert.equal(recovered.record.availableAt, 1_100);
});

test("rejects payload expansion, inconsistent persisted state, and unsafe lease durations", () => {
  assert.throws(
    () => createGuideDocumentNotificationOutboxRecord({
      ...decision,
      payload: { ...decision.payload, url: "https://example.invalid/private" },
    }, 1_000),
    /allowlist/
  );
  const pending = createGuideDocumentNotificationOutboxRecord(decision, 1_000);
  assert.throws(
    () => beginGuideDocumentNotificationAttempt({
      record: { ...pending, status: "delivered", deliveredAt: null },
      now: 1_000,
    }),
    /inconsistent/
  );
  assert.throws(
    () => beginGuideDocumentNotificationAttempt({ record: pending, now: 1_000, leaseSeconds: 301 }),
    /1 to 300/
  );
});
