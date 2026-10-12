import assert from "node:assert/strict";
import test from "node:test";

import { handlePersistedGuideReceiptAcknowledgementRequest } from "../lib/server/guideReceiptAcknowledgementService.ts";

const guideA = "123e4567-e89b-42d3-a456-426614174000";
const guideB = "223e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const eventId = "423e4567-e89b-42d3-a456-426614174000";
const pending = Object.freeze({
  documentId,
  guideId: guideA,
  documentStatus: "final",
  acknowledgementStatus: "pending",
  receiptFingerprint: "a".repeat(64),
  acknowledgedAt: null,
});

function createMemoryAdapters(initial = pending) {
  let stored = initial;
  let loads = 0;
  let commits = 0;
  const audits = [];
  const sameRecord = (left, right) =>
    left !== null &&
    left.documentId === right.documentId &&
    left.guideId === right.guideId &&
    left.documentStatus === right.documentStatus &&
    left.acknowledgementStatus === right.acknowledgementStatus &&
    left.receiptFingerprint === right.receiptFingerprint &&
    left.acknowledgedAt === right.acknowledgedAt;
  return {
    loadReceipt: async (id) => {
      loads += 1;
      return stored?.documentId === id ? stored : null;
    },
    commitTransaction: async (transaction) => {
      commits += 1;
      if (!sameRecord(stored, transaction.previous)) return false;
      stored = transaction.next;
      audits.push(Object.freeze({
        record: transaction.audit,
        fingerprint: transaction.auditFingerprint,
      }));
      return true;
    },
    inspect: () => ({ stored, loads, commits, audits }),
  };
}

function request(adapters, overrides = {}) {
  return handlePersistedGuideReceiptAcknowledgementRequest({
    sessionToken: "signed-session",
    body: { documentId },
    verifySession: async () => guideA,
    createEventId: () => eventId,
    now: 1_000,
    ...adapters,
    ...overrides,
  });
}

test("connects strict input, signed guide ownership, and one atomic write", async () => {
  const adapters = createMemoryAdapters();
  const result = await request(adapters);
  assert.deepEqual(result, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    body: { ok: true, acknowledgedAt: 1_000 },
  });
  assert.deepEqual(adapters.inspect(), {
    stored: {
      ...pending,
      acknowledgementStatus: "acknowledged",
      acknowledgedAt: 1_000,
    },
    loads: 1,
    commits: 1,
    audits: [{
      record: {
        schemaVersion: 1,
        eventKind: "receipt_acknowledged",
        eventId,
        documentId,
        guideId: guideA,
        receiptFingerprint: "a".repeat(64),
        acknowledgedAt: 1_000,
      },
      fingerprint: adapters.inspect().audits[0].fingerprint,
    }],
  });
  assert.match(adapters.inspect().audits[0].fingerprint, /^[0-9a-f]{64}$/);
});

test("makes a replay indistinguishable from every unavailable receipt", async () => {
  const adapters = createMemoryAdapters();
  assert.equal((await request(adapters)).body.ok, true);
  const replay = await request(adapters, { now: 1_001 });
  assert.deepEqual(replay.body, { ok: false, error: "unavailable" });
  assert.equal(adapters.inspect().commits, 1);
  assert.equal(adapters.inspect().audits.length, 1);
});

test("rejects bad JSON before session verification or persistence", async () => {
  const adapters = createMemoryAdapters();
  let verifications = 0;
  const result = await request(adapters, {
    body: { documentId, extra: "not-allowed" },
    verifySession: async () => { verifications += 1; return guideA; },
  });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { ok: false, error: "invalid_request" });
  assert.equal(verifications, 0);
  assert.deepEqual(adapters.inspect(), { stored: pending, loads: 0, commits: 0, audits: [] });
});

test("does not commit a foreign guide receipt", async () => {
  const foreign = Object.freeze({ ...pending, guideId: guideB });
  const adapters = createMemoryAdapters(foreign);
  const result = await request(adapters);
  assert.deepEqual(result.body, { ok: false, error: "unavailable" });
  assert.deepEqual(adapters.inspect(), { stored: foreign, loads: 1, commits: 0, audits: [] });
});

test("allows only one winner when two confirmations race", async () => {
  const adapters = createMemoryAdapters();
  let releaseLoads;
  const bothLoaded = new Promise((resolve) => { releaseLoads = resolve; });
  let loadCount = 0;
  const loadReceipt = async (id) => {
    const record = await adapters.loadReceipt(id);
    loadCount += 1;
    if (loadCount === 2) releaseLoads();
    await bothLoaded;
    return record;
  };
  const [first, second] = await Promise.all([
    request(adapters, { loadReceipt }),
    request(adapters, { loadReceipt }),
  ]);
  const bodies = [first.body, second.body];
  assert.equal(bodies.filter((body) => body.ok).length, 1);
  assert.equal(bodies.filter((body) => !body.ok && body.error === "unavailable").length, 1);
  assert.equal(adapters.inspect().commits, 2);
  assert.equal(adapters.inspect().audits.length, 1);
  assert.equal(adapters.inspect().stored.acknowledgementStatus, "acknowledged");
});

test("contains persistence failures behind the fixed private error contract", async () => {
  const events = [];
  const result = await request(createMemoryAdapters(), {
    loadReceipt: async () => { throw new Error("private database detail"); },
    onPrivateError: (event) => events.push(event),
  });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, error: "temporarily_unavailable" });
  assert.deepEqual(events, ["guide_receipt_acknowledgement_failed"]);
  assert.doesNotMatch(JSON.stringify(result), /database|signed-session/i);
});

test("contains audit preparation failures behind the same private error contract", async () => {
  const events = [];
  const adapters = createMemoryAdapters();
  const result = await request(adapters, {
    createEventId: () => "malformed-event-id",
    onPrivateError: (event) => events.push(event),
  });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, error: "temporarily_unavailable" });
  assert.deepEqual(events, ["guide_receipt_acknowledgement_failed"]);
  assert.deepEqual(adapters.inspect(), {
    stored: pending,
    loads: 1,
    commits: 0,
    audits: [],
  });
  assert.doesNotMatch(JSON.stringify(result), /event|uuid|receipt|fingerprint/i);
});
