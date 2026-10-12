import assert from "node:assert/strict";
import test from "node:test";

import {
  createReceiptDocumentSnapshot,
  createSettlementDocumentSnapshot,
  fingerprintGuideFinancialDocument,
  verifyGuideFinancialDocumentFingerprint,
} from "../lib/server/guideFinancialDocuments.ts";

const settlementInput = {
  documentId: "123e4567-e89b-42d3-a456-426614174000",
  version: 1,
  settlementId: "223e4567-e89b-42d3-a456-426614174000",
  guideId: "323e4567-e89b-42d3-a456-426614174000",
  statementMonth: "2026-10",
  settlementStatus: "confirmed",
  confirmedAt: "2026-10-03T00:00:00.000Z",
  totals: { grossComYen: 30_000, dodoFeeYen: 3_000, adjustmentYen: -500, guidePaymentYen: 27_000 },
  lines: [
    { importRowId: "423e4567-e89b-42d3-a456-426614174000", workDate: "2026-10-01", grossComYen: 10_000, dodoFeeYen: 1_000, guidePaymentYen: 9_000 },
    { importRowId: "523e4567-e89b-42d3-a456-426614174000", workDate: "2026-10-02", grossComYen: 20_000, dodoFeeYen: 2_000, guidePaymentYen: 18_000 },
  ],
};

test("creates an immutable confirmed settlement snapshot without inventing a business formula", () => {
  const snapshot = createSettlementDocumentSnapshot(settlementInput);
  assert.equal(snapshot.documentKind, "settlement");
  assert.equal(snapshot.totals.adjustmentYen, -500);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.totals), true);
  assert.equal(Object.isFrozen(snapshot.lines), true);
  assert.equal(Object.isFrozen(snapshot.lines[0]), true);
  assert.throws(() => { snapshot.lines[0].grossComYen = 1; }, TypeError);
});

test("rejects draft, empty, duplicate, and mismatched settlement data", () => {
  assert.throws(() => createSettlementDocumentSnapshot({ ...settlementInput, settlementStatus: "draft" }), /confirmed/);
  assert.throws(() => createSettlementDocumentSnapshot({ ...settlementInput, lines: [] }), /at least one/);
  assert.throws(() => createSettlementDocumentSnapshot({
    ...settlementInput,
    lines: [settlementInput.lines[0], settlementInput.lines[0]],
  }), /unique/);
  assert.throws(() => createSettlementDocumentSnapshot({
    ...settlementInput,
    totals: { ...settlementInput.totals, guidePaymentYen: 26_999 },
  }), /guidePaymentYen total/);
  assert.throws(() => createSettlementDocumentSnapshot({
    ...settlementInput,
    lines: [{ ...settlementInput.lines[0], workDate: "2026-02-30" }],
    totals: { ...settlementInput.totals, grossComYen: 10_000, dodoFeeYen: 1_000, guidePaymentYen: 9_000 },
  }), /ISO date/);
});

test("fingerprint is deterministic and detects changed settlement content", async () => {
  const snapshot = createSettlementDocumentSnapshot(settlementInput);
  const first = await fingerprintGuideFinancialDocument(snapshot);
  const second = await fingerprintGuideFinancialDocument(createSettlementDocumentSnapshot(settlementInput));
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(await verifyGuideFinancialDocumentFingerprint(snapshot, first), true);

  const changed = createSettlementDocumentSnapshot({
    ...settlementInput,
    totals: { ...settlementInput.totals, adjustmentYen: -499 },
  });
  assert.equal(await verifyGuideFinancialDocumentFingerprint(changed, first), false);
});

test("creates a receipt only for the paid amount tied to the exact settlement snapshot", async () => {
  const settlement = createSettlementDocumentSnapshot(settlementInput);
  const settlementFingerprint = await fingerprintGuideFinancialDocument(settlement);
  const receipt = await createReceiptDocumentSnapshot({
    documentId: "623e4567-e89b-42d3-a456-426614174000",
    version: 1,
    settlement,
    settlementFingerprint,
    paymentId: "723e4567-e89b-42d3-a456-426614174000",
    paymentStatus: "paid",
    amountYen: 27_000,
    paidAt: "2026-10-03T01:00:00.000Z",
  });
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    documentKind: "receipt",
    documentId: "623e4567-e89b-42d3-a456-426614174000",
    version: 1,
    supersedesDocumentId: null,
    settlementDocumentId: settlement.documentId,
    settlementFingerprint,
    settlementId: settlement.settlementId,
    guideId: settlement.guideId,
    statementMonth: "2026-10",
    paymentId: "723e4567-e89b-42d3-a456-426614174000",
    amountYen: 27_000,
    paidAt: "2026-10-03T01:00:00.000Z",
  });
  assert.equal(Object.isFrozen(receipt), true);
});

test("rejects unpaid, amount-mismatched, and settlement-mismatched receipts", async () => {
  const settlement = createSettlementDocumentSnapshot(settlementInput);
  const fingerprint = await fingerprintGuideFinancialDocument(settlement);
  const base = {
    documentId: "623e4567-e89b-42d3-a456-426614174000",
    version: 1,
    settlement,
    settlementFingerprint: fingerprint,
    paymentId: "723e4567-e89b-42d3-a456-426614174000",
    paymentStatus: "paid",
    amountYen: 27_000,
    paidAt: "2026-10-03T01:00:00.000Z",
  };
  await assert.rejects(createReceiptDocumentSnapshot({ ...base, paymentStatus: "pending" }), /only be created/);
  await assert.rejects(createReceiptDocumentSnapshot({ ...base, amountYen: 26_999 }), /does not match/);
  await assert.rejects(createReceiptDocumentSnapshot({ ...base, settlementFingerprint: "0".repeat(64) }), /does not match/);
});

test("requires an explicit superseded document for reissues", () => {
  assert.throws(() => createSettlementDocumentSnapshot({ ...settlementInput, version: 2 }), /must identify/);
  const snapshot = createSettlementDocumentSnapshot({
    ...settlementInput,
    documentId: "823e4567-e89b-42d3-a456-426614174000",
    version: 2,
    supersedesDocumentId: settlementInput.documentId,
  });
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.supersedesDocumentId, settlementInput.documentId);
});
