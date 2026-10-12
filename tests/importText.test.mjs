import assert from "node:assert/strict";
import test from "node:test";

import {
  createDodoImportSampleCsv,
  DODO_IMPORT_MAX_CELL_CHARACTERS,
  DODO_IMPORT_MAX_COLUMNS,
  DODO_IMPORT_MAX_DATA_ROWS,
  parseDodoImportText,
} from "../lib/dodo/importText.ts";
import { validateDodoImportBatch } from "../lib/dodo/importValidation.ts";

const header =
  "外部参照番号,ガイド番号,稼働日,COM金額,DODO手数料,ガイド支払額";

test("parses UTF-8 CSV exported from Excel with quoted commas", () => {
  const result = parseDodoImportText(
    `\uFEFF${header}\r\n"WX,001",GUIDE-1,2026-10-01,"12,000","2,000","10,000"\r\n`
  );

  assert.deepEqual(result.issues, []);
  assert.equal(result.delimiter, ",");
  assert.deepEqual(result.rows, [
    {
      sourceRowNumber: 2,
      externalReference: "WX,001",
      guideCode: "GUIDE-1",
      workDate: "2026-10-01",
      grossComYen: "12,000",
      dodoFeeYen: "2,000",
      guidePaymentYen: "10,000",
    },
  ]);
});

test("detects TSV and skips blank records", () => {
  const result = parseDodoImportText(
    "ガイドコード\t日付\tCOM\tDODO手数料\t支払額\n\nG-2\t2026-10-02\t5000\t500\t4500\n"
  );

  assert.deepEqual(result.issues, []);
  assert.equal(result.delimiter, "\t");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sourceRowNumber, 3);
});

test("does not treat an unconfirmed monthly fee as the DODO handling fee", () => {
  const result = parseDodoImportText(
    "ガイドコード,稼働日,COM金額,DODO会費,ガイド支払額\nG-1,2026-10-01,1000,100,900"
  );

  assert.deepEqual(result.issues.map((issue) => issue.code), ["missing_column"]);
  assert.match(result.issues[0].message, /DODO手数料/);
});

test("reports missing and duplicate required columns", () => {
  const result = parseDodoImportText(
    "ガイド番号,ガイドコード,稼働日,COM金額,DODO手数料\nG-1,G-1,2026-10-01,1000,100"
  );

  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["duplicate_column", "missing_column"]
  );
  assert.match(result.issues[1].message, /ガイド支払額/);
});

test("reports empty files and unclosed quoted values", () => {
  assert.equal(parseDodoImportText("\n\r\n").issues[0].code, "empty_file");

  const result = parseDodoImportText(`${header}\n"WX-1,GUIDE-1`);
  assert.equal(result.issues[0].code, "unclosed_quote");
});

test("reports rows whose column counts differ from the header", () => {
  const result = parseDodoImportText(
    `${header}\nWX-1,G-1,2026-10-01,1000,100\nWX-2,G-2,2026-10-02,2000,200,1800,EXTRA`
  );

  assert.deepEqual(
    result.issues.map((issue) => ({
      code: issue.code,
      sourceRowNumber: issue.sourceRowNumber,
    })),
    [
      { code: "column_count_mismatch", sourceRowNumber: 2 },
      { code: "column_count_mismatch", sourceRowNumber: 3 },
    ]
  );
  assert.match(result.issues[0].message, /6列/);
  assert.match(result.issues[1].message, /7列/);
});

test("uses the physical header line in structural errors", () => {
  const result = parseDodoImportText(
    "\n\nガイド番号,稼働日,COM金額,DODO手数料\nG-1,2026-10-01,1000,100"
  );

  assert.equal(result.issues[0].code, "missing_column");
  assert.equal(result.issues[0].sourceRowNumber, 3);
});

test("rejects a file that contains only a header", () => {
  const result = parseDodoImportText(`${header}\n\n`);

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.issues, [
    {
      code: "empty_data",
      message: "見出しだけで、取込対象の明細行がありません。",
      sourceRowNumber: 1,
    },
  ]);
});

test("detects a repeated header inside the data", () => {
  const result = parseDodoImportText(
    `${header}\nWX-1,G-1,2026-10-01,1000,100,900\n${header}\nWX-2,G-2,2026-10-02,2000,200,1800`
  );

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "repeated_header");
  assert.equal(result.issues[0].sourceRowNumber, 3);
});

test("stops parsing when the column safety limit is exceeded", () => {
  const oversizedHeader = Array.from(
    { length: DODO_IMPORT_MAX_COLUMNS + 1 },
    (_, index) => `列${index + 1}`
  ).join(",");
  const result = parseDodoImportText(`${oversizedHeader}\n`);

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "too_many_columns",
  ]);
  assert.equal(result.issues[0].sourceRowNumber, 1);
  assert.match(result.issues[0].message, /50列/);
});

test("stops parsing when the data-row safety limit is exceeded", () => {
  const dataRows = Array.from(
    { length: DODO_IMPORT_MAX_DATA_ROWS + 1 },
    (_, index) => `WX-${index},G-1,2026-10-01,1000,100,900`
  );
  const result = parseDodoImportText([header, ...dataRows].join("\n"));

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["too_many_rows"]);
  assert.equal(result.issues[0].sourceRowNumber, DODO_IMPORT_MAX_DATA_ROWS + 2);
  assert.match(result.issues[0].message, /10,000件/);
});

test("stops parsing when one cell exceeds the text safety limit", () => {
  const oversizedReference = "A".repeat(DODO_IMPORT_MAX_CELL_CHARACTERS + 1);
  const result = parseDodoImportText(
    `${header}\n${oversizedReference},G-1,2026-10-01,1000,100,900`
  );

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["cell_too_long"]);
  assert.equal(result.issues[0].sourceRowNumber, 2);
  assert.match(result.issues[0].message, /1列目/);
  assert.match(result.issues[0].message, /10,000文字/);
});

test("allows a cell exactly at the text safety limit", () => {
  const boundaryReference = "A".repeat(DODO_IMPORT_MAX_CELL_CHARACTERS);
  const result = parseDodoImportText(
    `${header}\n${boundaryReference},G-1,2026-10-01,1000,100,900`
  );

  assert.deepEqual(result.issues, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].externalReference?.length, DODO_IMPORT_MAX_CELL_CHARACTERS);
});

test("creates a UTF-8 sample CSV that passes structural parsing", () => {
  const sample = createDodoImportSampleCsv();
  const result = parseDodoImportText(sample);

  assert.equal(sample.startsWith("\uFEFF"), true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows, [
    {
      sourceRowNumber: 2,
      externalReference: "SAMPLE-001",
      guideCode: "GUIDE-001",
      workDate: "2026-10-01",
      grossComYen: "12000",
      dodoFeeYen: "1500",
      guidePaymentYen: "9250",
    },
  ]);
  assert.equal(
    validateDodoImportBatch({
      sourcePartner: "見本",
      statementMonth: "2026-10",
      rows: result.rows,
    }).canConfirm,
    true
  );
});
