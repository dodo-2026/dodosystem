import assert from "node:assert/strict";
import test from "node:test";

import {
  beginGuideDocumentNotificationAttempt,
  createGuideDocumentNotificationOutboxRecord,
} from "../lib/server/guideDocumentReadyNotificationOutbox.ts";
import { runGuideDocumentNotificationBatch } from "../lib/server/guideDocumentReadyNotificationBatch.ts";

function decision(character) {
  return {
    allowed: true,
    idempotencyKey: `guide-document-ready:${character.repeat(64)}`,
    payload: {
      schemaVersion: 1,
      event: "guide.document-ready",
      title: "書類の準備ができました",
      body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
      actionLabel: "DODOで確認する",
    },
  };
}

function createStore(records) {
  const current = new Map(records.map((record) => [record.idempotencyKey, record]));
  return {
    current,
    compareAndSet: async (expected, next) => {
      if (current.get(expected.idempotencyKey) !== expected) return false;
      current.set(expected.idempotencyKey, next);
      return true;
    },
  };
}

test("requests a bounded candidate set and processes it serially in reader order", async () => {
  const records = ["a", "b", "c"].map((value) =>
    createGuideDocumentNotificationOutboxRecord(decision(value), 1_000)
  );
  const store = createStore(records);
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const result = await runGuideDocumentNotificationBatch({
    now: 1_000,
    maximum: 3,
    loadCandidates: async (input) => {
      calls.push(input);
      return records;
    },
    compareAndSet: store.compareAndSet,
    sendIdempotently: async (request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push(request.idempotencyKey);
      await Promise.resolve();
      active -= 1;
      return { outcome: "delivered" };
    },
  });
  assert.deepEqual(calls[0], { now: 1_000, limit: 3 });
  assert.equal(Object.isFrozen(calls[0]), true);
  assert.deepEqual(calls.slice(1), records.map((record) => record.idempotencyKey));
  assert.equal(maximumActive, 1);
  assert.deepEqual(result, {
    status: "processed",
    candidates: 3,
    attempted: 3,
    delivered: 3,
    temporaryFailures: 0,
    permanentFailures: 0,
    leasesRecovered: 0,
    skipped: 0,
    persistenceUncertain: 0,
    privateFailures: 0,
  });
});

test("rejects an oversized or duplicate candidate list before any send", async () => {
  const record = createGuideDocumentNotificationOutboxRecord(decision("d"), 1_000);
  for (const [maximum, candidates] of [[1, [record, { ...record }]], [2, [record, record]]]) {
    let sends = 0;
    const result = await runGuideDocumentNotificationBatch({
      now: 1_000,
      maximum,
      loadCandidates: async () => candidates,
      compareAndSet: async () => true,
      sendIdempotently: async () => {
        sends += 1;
        return { outcome: "delivered" };
      },
    });
    assert.equal(result.status, "load_failed");
    assert.equal(sends, 0);
  }
});

test("contains a hostile candidate accessor before any send", async () => {
  let sends = 0;
  let privateFailures = 0;
  const hostile = Object.create(null, {
    idempotencyKey: {
      get() {
        throw new Error("private accessor detail");
      },
    },
  });
  const result = await runGuideDocumentNotificationBatch({
    now: 1_000,
    loadCandidates: async () => [hostile],
    compareAndSet: async () => true,
    sendIdempotently: async () => {
      sends += 1;
      return { outcome: "delivered" };
    },
    onPrivateError: () => {
      privateFailures += 1;
    },
  });
  assert.equal(result.status, "load_failed");
  assert.equal(sends, 0);
  assert.equal(privateFailures, 1);
});

test("contains a loader exception behind a fixed empty result", async () => {
  let privateFailures = 0;
  const result = await runGuideDocumentNotificationBatch({
    now: 1_000,
    loadCandidates: async () => {
      throw new Error("private database connection detail");
    },
    compareAndSet: async () => true,
    sendIdempotently: async () => ({ outcome: "delivered" }),
    onPrivateError: () => {
      privateFailures += 1;
    },
  });
  assert.deepEqual(result, {
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
  });
  assert.equal(privateFailures, 1);
  assert.doesNotMatch(JSON.stringify(result), /database|connection|detail/);
});

test("isolates one provider failure and continues with the next candidate", async () => {
  const records = ["e", "f"].map((value) =>
    createGuideDocumentNotificationOutboxRecord(decision(value), 1_000)
  );
  const store = createStore(records);
  let sends = 0;
  const result = await runGuideDocumentNotificationBatch({
    now: 1_000,
    loadCandidates: async () => records,
    compareAndSet: store.compareAndSet,
    sendIdempotently: async () => {
      sends += 1;
      if (sends === 1) throw new Error("provider detail");
      return { outcome: "delivered" };
    },
  });
  assert.equal(sends, 2);
  assert.equal(result.attempted, 2);
  assert.equal(result.temporaryFailures, 1);
  assert.equal(result.delivered, 1);
  assert.equal(store.current.get(records[0].idempotencyKey).status, "retryable_failed");
  assert.equal(store.current.get(records[1].idempotencyKey).status, "delivered");
});

test("isolates a malformed record and continues with a valid candidate", async () => {
  const malformed = {
    ...createGuideDocumentNotificationOutboxRecord(decision("1"), 1_000),
    status: "delivered",
    deliveredAt: null,
  };
  const valid = createGuideDocumentNotificationOutboxRecord(decision("2"), 1_000);
  const store = createStore([malformed, valid]);
  let sends = 0;
  const result = await runGuideDocumentNotificationBatch({
    now: 1_000,
    loadCandidates: async () => [malformed, valid],
    compareAndSet: store.compareAndSet,
    sendIdempotently: async () => {
      sends += 1;
      return { outcome: "delivered" };
    },
  });
  assert.equal(sends, 1);
  assert.equal(result.privateFailures, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.delivered, 1);
});

test("summarizes claim conflicts and uncertain completion writes without identifiers", async () => {
  const records = ["3", "4"].map((value) =>
    createGuideDocumentNotificationOutboxRecord(decision(value), 1_000)
  );
  let writes = 0;
  const result = await runGuideDocumentNotificationBatch({
    now: 1_000,
    loadCandidates: async () => records,
    compareAndSet: async () => {
      writes += 1;
      if (writes === 1) return false;
      return writes === 2;
    },
    sendIdempotently: async () => ({ outcome: "delivered" }),
  });
  assert.equal(result.candidates, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.attempted, 1);
  assert.equal(result.persistenceUncertain, 1);
  assert.doesNotMatch(JSON.stringify(result), /guide-document-ready|[0-9a-f]{64}/);
});

test("recovers an expired lease without sending and validates batch bounds", async () => {
  const pending = createGuideDocumentNotificationOutboxRecord(decision("5"), 1_000);
  const delivering = beginGuideDocumentNotificationAttempt({ record: pending, now: 1_000 }).record;
  const store = createStore([delivering]);
  let sends = 0;
  const result = await runGuideDocumentNotificationBatch({
    now: 1_060,
    loadCandidates: async () => [delivering],
    compareAndSet: store.compareAndSet,
    sendIdempotently: async () => {
      sends += 1;
      return { outcome: "delivered" };
    },
  });
  assert.equal(result.leasesRecovered, 1);
  assert.equal(sends, 0);
  assert.equal(store.current.get(delivering.idempotencyKey).status, "retryable_failed");
  await assert.rejects(
    () => runGuideDocumentNotificationBatch({
      now: 1_000,
      maximum: 26,
      loadCandidates: async () => [],
      compareAndSet: async () => true,
      sendIdempotently: async () => ({ outcome: "delivered" }),
    }),
    /1 to 25/
  );
});
