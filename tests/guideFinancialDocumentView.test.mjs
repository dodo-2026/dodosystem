import assert from "node:assert/strict";
import test from "node:test";

import {
  createGuideFinancialDocumentView,
  formatYen,
  paginateSettlementDocumentView,
} from "../lib/dodo/guideFinancialDocumentView.ts";
import {
  createReceiptDocumentSnapshot,
  createSettlementDocumentSnapshot,
  fingerprintGuideFinancialDocument,
} from "../lib/server/guideFinancialDocuments.ts";

const context = {
  guideDisplayName: "テスト ガイド",
  issuerDisplayName: "DODO GUIDE OFFICE",
  issuedOn: "2026-10-03",
};

const settlement = createSettlementDocumentSnapshot({
  documentId: "123e4567-e89b-42d3-a456-426614174000",
  version: 1,
  settlementId: "223e4567-e89b-42d3-a456-426614174000",
  guideId: "323e4567-e89b-42d3-a456-426614174000",
  statementMonth: "2026-10",
  settlementStatus: "confirmed",
  confirmedAt: "2026-10-03T00:00:00.000Z",
  totals: { grossComYen: 12_000, dodoFeeYen: 2_000, adjustmentYen: -500, guidePaymentYen: 10_000 },
  lines: [{
    importRowId: "423e4567-e89b-42d3-a456-426614174000",
    workDate: "2026-10-01",
    grossComYen: 12_000,
    dodoFeeYen: 2_000,
    guidePaymentYen: 10_000,
  }],
});

test("builds an immutable Japanese settlement view from validated values", () => {
  const view = createGuideFinancialDocumentView(settlement, context);
  assert.equal(view.kind, "settlement");
  assert.equal(view.title, "月次精算書");
  assert.equal(view.recipient, "テスト ガイド 様");
  assert.equal(view.periodLabel, "2026年10月分");
  assert.equal(view.issuedOnLabel, "2026年10月3日");
  assert.equal(view.reference, "DODO-202610-S-123E4567");
  assert.deepEqual(view.totals, [
    { label: "COM合計", value: "¥12,000" },
    { label: "DODO手数料合計", value: "¥2,000" },
    { label: "調整額", value: "−¥500" },
    { label: "ガイド支払額", value: "¥10,000" },
  ]);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.details), true);
  assert.equal(Object.isFrozen(view.totals[0]), true);
});

test("builds a paid receipt linked to the settlement reference", async () => {
  const settlementFingerprint = await fingerprintGuideFinancialDocument(settlement);
  const receipt = await createReceiptDocumentSnapshot({
    documentId: "523e4567-e89b-42d3-a456-426614174000",
    version: 2,
    supersedesDocumentId: "623e4567-e89b-42d3-a456-426614174000",
    settlement,
    settlementFingerprint,
    paymentId: "723e4567-e89b-42d3-a456-426614174000",
    paymentStatus: "paid",
    amountYen: 10_000,
    paidAt: "2026-10-03T01:00:00.000Z",
  });
  const view = createGuideFinancialDocumentView(receipt, context);
  assert.equal(view.kind, "receipt");
  assert.equal(view.amountLabel, "¥10,000");
  assert.equal(view.statusLabel, "支払済");
  assert.equal(view.paidOnLabel, "2026年10月3日");
  assert.equal(view.revisionLabel, "第2版（訂正版）");
  assert.equal(view.settlementReference, "DODO-202610-S-123E4567");
});

test("rejects unsafe display text and invalid issue dates", () => {
  assert.throws(() => createGuideFinancialDocumentView(settlement, {
    ...context, guideDisplayName: "ガイド\n別名",
  }), /plain display text/);
  assert.throws(() => createGuideFinancialDocumentView(settlement, {
    ...context, issuedOn: "2026-02-30",
  }), /ISO date/);
});

test("formats only safe integer yen values", () => {
  assert.equal(formatYen(0), "¥0");
  assert.equal(formatYen(-1_234), "−¥1,234");
  assert.throws(() => formatYen(1.5), /safe integer/);
});

test("paginates long settlements without losing or reordering detail rows", () => {
  const view = createGuideFinancialDocumentView(settlement, context);
  const longView = Object.freeze({
    ...view,
    details: Object.freeze(Array.from({ length: 25 }, (_, index) =>
      Object.freeze({ ...view.details[0], workDateLabel: `row-${index + 1}` })
    )),
  });
  const pages = paginateSettlementDocumentView(longView, 10);
  assert.deepEqual(pages.map((page) => page.details.length), [10, 10, 5]);
  assert.deepEqual(pages.map((page) => page.pageNumber), [1, 2, 3]);
  assert.deepEqual(pages.map((page) => page.showTotals), [false, false, true]);
  assert.deepEqual(pages.flatMap((page) => page.details).map((row) => row.workDateLabel),
    Array.from({ length: 25 }, (_, index) => `row-${index + 1}`));
  assert.equal(Object.isFrozen(pages), true);
  assert.equal(Object.isFrozen(pages[0].details), true);
});

test("rejects unsafe pagination sizes", () => {
  const view = createGuideFinancialDocumentView(settlement, context);
  for (const size of [0, 1.5, 51]) {
    assert.throws(() => paginateSettlementDocumentView(view, size), /rowsPerPage/);
  }
});
