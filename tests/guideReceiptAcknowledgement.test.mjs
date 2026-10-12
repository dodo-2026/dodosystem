import assert from "node:assert/strict";
import test from "node:test";

import { acknowledgeGuideReceipt } from "../lib/server/guideReceiptAcknowledgement.ts";

const guideA = "123e4567-e89b-42d3-a456-426614174000";
const guideB = "223e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const pending = {
  documentId,
  guideId: guideA,
  documentStatus: "final",
  acknowledgementStatus: "pending",
  receiptFingerprint: "a".repeat(64),
  acknowledgedAt: null,
};

test("atomically acknowledges one final receipt owned by the signed-in guide", async () => {
  let stored = pending;
  let commits = 0;
  const result = await acknowledgeGuideReceipt({
    sessionToken: "signed",
    documentId,
    now: 1_000,
    verifySession: async () => guideA,
    loadReceipt: async (id) => { assert.equal(id, documentId); return stored; },
    commitAcknowledgement: async (previous, next) => {
      commits += 1;
      assert.deepEqual(previous, pending);
      stored = next;
      return true;
    },
  });
  assert.deepEqual(result, { acknowledged: true, acknowledgedAt: 1_000 });
  assert.equal(commits, 1);
  assert.equal(stored.acknowledgementStatus, "acknowledged");
  assert.equal(stored.acknowledgedAt, 1_000);

  const replay = await acknowledgeGuideReceipt({
    sessionToken: "signed", documentId, now: 1_001,
    verifySession: async () => guideA,
    loadReceipt: async () => stored,
    commitAcknowledgement: async () => { commits += 1; return true; },
  });
  assert.deepEqual(replay, { acknowledged: false });
  assert.equal(commits, 1);
});

test("does not load without a valid session or malformed document ID", async () => {
  let loads = 0;
  for (const input of [
    { sessionToken: "bad", documentId, verifySession: async () => null },
    { sessionToken: "signed", documentId: "bad-id", verifySession: async () => guideA },
  ]) {
    const result = await acknowledgeGuideReceipt({
      ...input, now: 1_000,
      loadReceipt: async () => { loads += 1; return pending; },
      commitAcknowledgement: async () => true,
    });
    assert.deepEqual(result, { acknowledged: false });
  }
  assert.equal(loads, 0);
});

test("rejects foreign, draft, void, and already acknowledged receipts uniformly", async () => {
  let commits = 0;
  for (const record of [
    { ...pending, guideId: guideB },
    { ...pending, documentStatus: "draft" },
    { ...pending, documentStatus: "void", acknowledgementStatus: "void" },
    { ...pending, acknowledgementStatus: "acknowledged", acknowledgedAt: 900 },
  ]) {
    const result = await acknowledgeGuideReceipt({
      sessionToken: "signed", documentId, now: 1_000,
      verifySession: async () => guideA,
      loadReceipt: async () => record,
      commitAcknowledgement: async () => { commits += 1; return true; },
    });
    assert.deepEqual(result, { acknowledged: false });
  }
  assert.equal(commits, 0);
});

test("reports no acknowledgement when the atomic commit loses a race", async () => {
  const result = await acknowledgeGuideReceipt({
    sessionToken: "signed", documentId, now: 1_000,
    verifySession: async () => guideA,
    loadReceipt: async () => pending,
    commitAcknowledgement: async () => false,
  });
  assert.deepEqual(result, { acknowledged: false });
});

test("fails closed on malformed loaded records", async () => {
  await assert.rejects(acknowledgeGuideReceipt({
    sessionToken: "signed", documentId, now: 1_000,
    verifySession: async () => guideA,
    loadReceipt: async () => ({ ...pending, receiptFingerprint: "not-a-digest" }),
    commitAcknowledgement: async () => true,
  }), /malformed/);
});
