import assert from "node:assert/strict";
import test from "node:test";
import { createGuideReceiptAcknowledgementController } from "../lib/dodo/guideReceiptAcknowledgementController.ts";
import { runGuideReceiptAcknowledgementMutation } from "../lib/server/guideReceiptAcknowledgementMutation.ts";

const documentId = "323e4567-e89b-42d3-a456-426614174000";
const guideId = "123e4567-e89b-42d3-a456-426614174000";
const submissionId = "223e4567-e89b-42d3-a456-426614174000";
const receipt = { status: "pending", acknowledgedAt: null };

function create(overrides = {}) {
  return createGuideReceiptAcknowledgementController({
    documentId: documentId.toUpperCase(), receipt,
    createSubmissionId: () => submissionId,
    mutate: async () => ({ ok: true, acknowledgedAt: 1_000 }),
    ...overrides,
  });
}

test("blocks duplicate submission until the first mutation completes", async () => {
  let resolve;
  let calls = 0;
  const states = [];
  const controller = create({
    onStateChange: (state) => states.push(state.phase),
    mutate: (body) => {
      calls += 1;
      assert.deepEqual(body, { documentId });
      assert.equal(Object.isFrozen(body), true);
      return new Promise((done) => { resolve = done; });
    },
  });
  const first = controller.submit();
  assert.equal(controller.getState().phase, "submitting");
  assert.equal((await controller.submit()).phase, "submitting");
  assert.equal(calls, 1);
  resolve({ ok: true, acknowledgedAt: 1_000 });
  assert.equal((await first).phase, "acknowledged");
  assert.deepEqual(states, ["submitting", "acknowledged"]);
  await controller.submit();
  assert.equal(calls, 1);
});

test("never mutates initially acknowledged or void receipts", async () => {
  for (const receipt of [
    { status: "acknowledged", acknowledgedAt: 1_000 },
    { status: "void", acknowledgedAt: null },
  ]) {
    let calls = 0;
    const controller = create({ receipt, mutate: async () => { calls += 1; } });
    const initial = controller.getState();
    assert.equal(await controller.submit(), initial);
    assert.equal(calls, 0);
  }
});

test("contains thrown private details and permits retry with a new submission ID", async () => {
  let attempts = 0;
  let identifiers = 0;
  const states = [];
  const controller = create({
    createSubmissionId: () => `${++identifiers}23e4567-e89b-42d3-a456-426614174000`,
    onStateChange: (state) => states.push(state),
    mutate: async () => {
      if (++attempts === 1) throw new Error("private-cookie-or-database-detail");
      return { ok: true, acknowledgedAt: 1_000 };
    },
  });
  assert.equal((await controller.submit()).phase, "retryable_error");
  assert.equal((await controller.submit()).phase, "acknowledged");
  assert.notEqual(states[0].submissionId, states[2].submissionId);
  assert.equal(attempts, 2);
  assert.doesNotMatch(JSON.stringify(states), /private-cookie-or-database-detail/);
});

test("invalid and unavailable responses prevent a second mutation", async () => {
  for (const error of ["invalid_request", "unavailable"]) {
    let calls = 0;
    const controller = create({
      mutate: async () => { calls += 1; return { ok: false, error }; },
    });
    assert.equal((await controller.submit()).phase, "unavailable");
    await controller.submit();
    assert.equal(calls, 1);
  }
});

test("malformed responses and unsupported timestamps never display success", async () => {
  for (const result of [
    undefined, [], { ok: "true", acknowledgedAt: 1_000 },
    { ok: true, acknowledgedAt: -1 },
    { ok: true, acknowledgedAt: Number.MAX_SAFE_INTEGER },
    { ok: true, acknowledgedAt: 1_000, sessionToken: "must-not-be-shown" },
    { ok: false, error: "private-detail" },
    Object.assign(Object.create({ ok: true }), { acknowledgedAt: 1_000 }),
  ]) {
    const controller = create({ mutate: async () => result });
    const state = await controller.submit();
    assert.equal(state.phase, "retryable_error");
    assert.equal(Object.isFrozen(state), true);
    assert.doesNotMatch(JSON.stringify(state), /sessionToken|private-detail|must-not-be-shown/);
  }
});

test("an observer exception cannot interrupt a successful mutation", async () => {
  let calls = 0;
  const controller = create({
    onStateChange: () => { throw new Error("render failure"); },
    mutate: async () => { calls += 1; return { ok: true, acknowledgedAt: 1_000 }; },
  });
  assert.equal((await controller.submit()).phase, "acknowledged");
  await controller.submit();
  assert.equal(calls, 1);
});

test("rejects malformed document or submission identifiers before a mutation", async () => {
  assert.throws(() => create({ documentId: "bad" }), /documentId/);
  let calls = 0;
  const controller = create({
    createSubmissionId: () => "bad",
    mutate: async () => { calls += 1; },
  });
  await assert.rejects(controller.submit(), /submissionId/);
  assert.equal(calls, 0);
  assert.equal(controller.getState().phase, "ready");
});

test("composes form state with one atomic receipt and audit mutation in memory", async () => {
  let persisted = Object.freeze({
    documentId, guideId, documentStatus: "final", acknowledgementStatus: "pending",
    acknowledgedAt: null, receiptFingerprint: "a".repeat(64),
  });
  const audits = [];
  const controller = create({
    mutate: (body) => runGuideReceiptAcknowledgementMutation({
      body, cookieStore: { get: () => ({ value: "fixture-guide-session" }) },
      verifySession: async () => guideId,
      loadReceipt: async () => persisted,
      createEventId: () => "423e4567-e89b-42d3-a456-426614174000",
      now: 1_000,
      commitTransaction: async (transaction) => {
        if (persisted.acknowledgementStatus !== "pending") return false;
        assert.deepEqual(persisted, transaction.previous);
        persisted = transaction.next;
        audits.push(transaction.audit);
        return true;
      },
    }),
  });
  assert.equal((await controller.submit()).phase, "acknowledged");
  await controller.submit();
  assert.equal(persisted.acknowledgementStatus, "acknowledged");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].documentId, documentId);
});
