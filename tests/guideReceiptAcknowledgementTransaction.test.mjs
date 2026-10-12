import assert from "node:assert/strict";
import test from "node:test";

import { acknowledgeGuideReceiptWithAudit } from "../lib/server/guideReceiptAcknowledgementTransaction.ts";
import { verifyGuideReceiptAcknowledgementAuditFingerprint } from "../lib/server/guideReceiptAcknowledgementAudit.ts";

const guideId = "123e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const eventId = "423e4567-e89b-42d3-a456-426614174000";
const pending = Object.freeze({
  documentId,
  guideId,
  documentStatus: "final",
  acknowledgementStatus: "pending",
  receiptFingerprint: "a".repeat(64),
  acknowledgedAt: null,
});

function createAtomicMemoryAdapter(initial = pending) {
  let stored = initial;
  const audits = new Map();
  let attempts = 0;
  const sameRecord = (left, right) =>
    left !== null &&
    left.documentId === right.documentId &&
    left.guideId === right.guideId &&
    left.documentStatus === right.documentStatus &&
    left.acknowledgementStatus === right.acknowledgementStatus &&
    left.receiptFingerprint === right.receiptFingerprint &&
    left.acknowledgedAt === right.acknowledgedAt;
  return {
    loadReceipt: async (id) => stored?.documentId === id ? stored : null,
    commitTransaction: async (transaction) => {
      attempts += 1;
      if (
        !sameRecord(stored, transaction.previous) ||
        audits.has(transaction.audit.eventId)
      ) {
        return false;
      }
      stored = transaction.next;
      audits.set(transaction.audit.eventId, Object.freeze({
        record: transaction.audit,
        fingerprint: transaction.auditFingerprint,
      }));
      return true;
    },
    inspect: () => ({ stored, audits: [...audits.values()], attempts }),
  };
}

function acknowledge(adapter, overrides = {}) {
  return acknowledgeGuideReceiptWithAudit({
    sessionToken: "guide-session",
    documentId,
    loadReceipt: adapter.loadReceipt,
    commitTransaction: adapter.commitTransaction,
    verifySession: async () => guideId,
    createEventId: () => eventId,
    now: 1_000,
    ...overrides,
  });
}

test("commits the receipt transition and matching audit as one unit", async () => {
  const adapter = createAtomicMemoryAdapter();
  let captured;
  const result = await acknowledge(adapter, {
    commitTransaction: async (transaction) => {
      captured = transaction;
      return adapter.commitTransaction(transaction);
    },
  });
  assert.deepEqual(result, { acknowledged: true, acknowledgedAt: 1_000 });
  assert.equal(Object.isFrozen(captured), true);
  assert.deepEqual(captured.next, {
    ...pending,
    acknowledgementStatus: "acknowledged",
    acknowledgedAt: 1_000,
  });
  assert.equal(captured.audit.documentId, captured.next.documentId);
  assert.equal(captured.audit.guideId, captured.next.guideId);
  assert.equal(captured.audit.receiptFingerprint, captured.next.receiptFingerprint);
  assert.equal(captured.audit.acknowledgedAt, captured.next.acknowledgedAt);
  assert.equal(
    await verifyGuideReceiptAcknowledgementAuditFingerprint(
      captured.audit,
      captured.auditFingerprint
    ),
    true
  );
});

test("does not create another audit event for a replay", async () => {
  const adapter = createAtomicMemoryAdapter();
  assert.equal((await acknowledge(adapter)).acknowledged, true);
  const replay = await acknowledge(adapter, {
    createEventId: () => "523e4567-e89b-42d3-a456-426614174000",
    now: 1_001,
  });
  assert.deepEqual(replay, { acknowledged: false });
  assert.equal(adapter.inspect().audits.length, 1);
  assert.equal(adapter.inspect().attempts, 1);
});

test("treats an atomic conflict as no acknowledgement and no audit", async () => {
  const adapter = createAtomicMemoryAdapter();
  const result = await acknowledge(adapter, { commitTransaction: async () => false });
  assert.deepEqual(result, { acknowledged: false });
  assert.deepEqual(adapter.inspect(), { stored: pending, audits: [], attempts: 0 });
});

test("fails closed before persistence when the event ID is invalid", async () => {
  const adapter = createAtomicMemoryAdapter();
  await assert.rejects(
    acknowledge(adapter, { createEventId: () => "invalid-event-id" }),
    /eventId/
  );
  assert.deepEqual(adapter.inspect(), { stored: pending, audits: [], attempts: 0 });
});

test("allows only one atomic transition and one audit when requests race", async () => {
  const adapter = createAtomicMemoryAdapter();
  let releaseLoads;
  const bothLoaded = new Promise((resolve) => { releaseLoads = resolve; });
  let loads = 0;
  const loadReceipt = async (id) => {
    const record = await adapter.loadReceipt(id);
    loads += 1;
    if (loads === 2) releaseLoads();
    await bothLoaded;
    return record;
  };
  const [first, second] = await Promise.all([
    acknowledge(adapter, { loadReceipt }),
    acknowledge(adapter, {
      loadReceipt,
      createEventId: () => "523e4567-e89b-42d3-a456-426614174000",
    }),
  ]);
  assert.equal([first, second].filter((result) => result.acknowledged).length, 1);
  assert.equal(adapter.inspect().audits.length, 1);
  assert.equal(adapter.inspect().attempts, 2);
  assert.equal(adapter.inspect().stored.acknowledgementStatus, "acknowledged");
});
