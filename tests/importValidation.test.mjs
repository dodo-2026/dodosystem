import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeDodoImportRows,
  validateDodoImportBatch,
} from "../lib/dodo/importValidation.ts";

const validRow = {
  sourceRowNumber: 2,
  externalReference: "WX-2026-10-001",
  guideCode: "GUIDE-001",
  workDate: "2026-10-01",
  grossComYen: "12,000",
  dodoFeeYen: 2_000,
  guidePaymentYen: 10_000,
};

test("normalizes a valid DODO import batch without inferring settlement formulas", () => {
  const result = validateDodoImportBatch({
    sourcePartner: " WeChat ",
    statementMonth: "2026-10",
    rows: [validRow],
  });

  assert.equal(result.canConfirm, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.sourcePartner, "WeChat");
  assert.equal(result.rows[0].grossComYen, 12_000);

  const formulaUnknown = validateDodoImportBatch({
    sourcePartner: "WeChat",
    statementMonth: "2026-10",
    rows: [{ ...validRow, dodoFeeYen: 11_000, guidePaymentYen: 9_000 }],
  });
  assert.equal(formulaUnknown.canConfirm, true);
});

test("rejects invalid month, date, row number, and yen amounts", () => {
  const result = validateDodoImportBatch({
    sourcePartner: "",
    statementMonth: "2026-13",
    rows: [
      {
        ...validRow,
        sourceRowNumber: 0,
        guideCode: " ",
        workDate: "2026-02-30",
        grossComYen: "12.5",
        dodoFeeYen: -1,
        guidePaymentYen: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
  });

  assert.equal(result.canConfirm, false);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      "required",
      "invalid_format",
      "invalid_row_number",
      "invalid_amount",
    ])
  );
});

test("detects duplicates by external reference", () => {
  const result = validateDodoImportBatch({
    sourcePartner: "WeChat",
    statementMonth: "2026-10",
    rows: [validRow, { ...validRow, sourceRowNumber: 3 }],
  });

  assert.equal(result.canConfirm, false);
  assert.deepEqual(
    result.issues.filter((issue) => issue.code === "duplicate"),
    [
      {
        code: "duplicate",
        field: "row",
        message: "取込行2と同じ明細です。",
        sourceRowNumber: 3,
      },
    ]
  );
});

test("detects duplicate content when the source has no external reference", () => {
  const result = validateDodoImportBatch({
    sourcePartner: "WeChat",
    statementMonth: "2026-10",
    rows: [
      { ...validRow, externalReference: undefined },
      { ...validRow, sourceRowNumber: 7, externalReference: "" },
    ],
  });

  assert.equal(result.canConfirm, false);
  assert.equal(result.issues.at(-1)?.code, "duplicate");
  assert.equal(result.issues.at(-1)?.sourceRowNumber, 7);
});

test("does not confirm a batch with no detail rows", () => {
  const result = validateDodoImportBatch({
    sourcePartner: "WeChat",
    statementMonth: "2026-10",
    rows: [],
  });

  assert.equal(result.canConfirm, false);
  assert.deepEqual(result.issues, [
    {
      code: "empty_rows",
      field: "rows",
      message: "取込対象の明細が1件もありません。",
    },
  ]);
});

test("summarizes each amount column independently without inferring a formula", () => {
  const result = validateDodoImportBatch({
    sourcePartner: "WeChat",
    statementMonth: "2026-10",
    rows: [
      validRow,
      {
        ...validRow,
        sourceRowNumber: 3,
        externalReference: "WX-2026-10-002",
        grossComYen: 8_001,
        dodoFeeYen: 999,
        guidePaymentYen: 1,
      },
    ],
  });

  assert.equal(result.canConfirm, true);
  assert.deepEqual(summarizeDodoImportRows(result.rows), {
    rowCount: 2,
    grossComYen: 20_001n,
    dodoFeeYen: 2_999n,
    guidePaymentYen: 10_001n,
  });
});

test("returns zero totals for an empty normalized row list", () => {
  assert.deepEqual(summarizeDodoImportRows([]), {
    rowCount: 0,
    grossComYen: 0n,
    dodoFeeYen: 0n,
    guidePaymentYen: 0n,
  });
});
