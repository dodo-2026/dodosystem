import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMPORT_SOURCE_BYTES, MAX_IMPORT_WORKSPACE_BYTES, groupImportByGuide, parseImportWorkspace, serializeImportWorkspace } from "../lib/dodo/importWorkspace.ts";
import { parseDodoImportText } from "../lib/dodo/importText.ts";
import { validateDodoImportBatch, summarizeDodoImportRows } from "../lib/dodo/importValidation.ts";
import { createDodoImportConfirmationCsv } from "../lib/dodo/importExport.ts";

test("CSV work survives save/reopen and includes every guide row beyond screen preview", () => {
  const sourceText = ["外部参照番号,ガイドコード,稼働日,COM金額,DODO手数料,ガイド支払額",
    ...Array.from({ length: 60 }, (_, i) => `REF-${i},${i % 2 ? "GUIDE-A" : "GUIDE-B"},2026-10-01,12000,1500,9250`)].join("\r\n");
  const reopened = parseImportWorkspace(serializeImportWorkspace({ sourcePartner: "試用取引先", statementMonth: "2026-10", sourceText }));
  assert.equal(reopened.sourceText, sourceText);
  const parsed = parseDodoImportText(reopened.sourceText);
  assert.deepEqual(parsed.issues, []);
  const batch = validateDodoImportBatch({ ...reopened, rows: parsed.rows });
  assert.equal(batch.canConfirm, true);
  const groups = groupImportByGuide(batch);
  assert.equal(groups.length, 2);
  for (const group of groups) {
    assert.equal(group.rows.length, 30);
    assert.equal(summarizeDodoImportRows(group.rows).guidePaymentYen, 277500n);
    assert.ok(group.rows.every(row => row.guideCode === group.guideCode));
  }
});

test("unsupported work files and invalid restored amounts cannot produce statements", () => {
  for (const data of [null, [], { format: "other", version: 1 }, { format: "dodo-import-workspace", version: 2, sourcePartner: "x", statementMonth: "2026-10", sourceText: "x" }]) {
    assert.throws(() => parseImportWorkspace(JSON.stringify(data)));
  }
  const batch = validateDodoImportBatch({ sourcePartner: "取引先", statementMonth: "2026-10", rows: [{sourceRowNumber: 2, guideCode: "A", workDate: "2026-10-01", grossComYen: 100, dodoFeeYen: 10, guidePaymentYen: -1}] });
  assert.deepEqual(groupImportByGuide(batch), []);
});

test("an accepted CSV remains reopenable when JSON escaping exceeds the CSV file limit", () => {
  const sourceText = "外部参照番号,ガイドコード,稼働日,COM金額,DODO手数料,ガイド支払額\n" +
    Array.from({ length: 600 }, (_, index) =>
      `${"\\".repeat(7000)}REF-${index},GUIDE-A,2026-10-01,12000,1500,9250`).join("\n");
  assert.ok(Buffer.byteLength(sourceText) < MAX_IMPORT_SOURCE_BYTES);
  const saved = serializeImportWorkspace({ sourcePartner: "試用取引先", statementMonth: "2026-10", sourceText });
  assert.ok(Buffer.byteLength(saved) > MAX_IMPORT_SOURCE_BYTES);
  assert.ok(Buffer.byteLength(saved) < MAX_IMPORT_WORKSPACE_BYTES);
  const reopened = parseImportWorkspace(saved);
  assert.equal(reopened.sourceText, sourceText);
  const parsed = parseDodoImportText(reopened.sourceText);
  assert.deepEqual(parsed.issues, []);
  const batch = validateDodoImportBatch({ ...reopened, rows: parsed.rows });
  assert.equal(batch.canConfirm, true);
  assert.equal(batch.rows.length, 600);
  assert.equal(summarizeDodoImportRows(batch.rows).guidePaymentYen, 5550000n);
});

test("work files enforce the original source limit in UTF-8 bytes and a bounded JSON envelope", () => {
  const make = sourceText => serializeImportWorkspace({ sourcePartner: "取引先", statementMonth: "2026-10", sourceText });
  assert.equal(parseImportWorkspace(make("x".repeat(MAX_IMPORT_SOURCE_BYTES))).sourceText.length, MAX_IMPORT_SOURCE_BYTES);
  assert.throws(() => parseImportWorkspace(make("x".repeat(MAX_IMPORT_SOURCE_BYTES + 1))));
  const multibyteSource = "あ".repeat(Math.floor(MAX_IMPORT_SOURCE_BYTES / 3) + 1);
  assert.ok(multibyteSource.length < MAX_IMPORT_SOURCE_BYTES);
  assert.throws(() => parseImportWorkspace(make(multibyteSource)));
  assert.throws(() => parseImportWorkspace(" ".repeat(MAX_IMPORT_WORKSPACE_BYTES + 1)));
});

test("confirmation CSV exports every validated row and neutralizes spreadsheet formulas", () => {
  const batch = validateDodoImportBatch({
    sourcePartner: "=取込元",
    statementMonth: "2026-10",
    rows: Array.from({ length: 60 }, (_, index) => ({
      sourceRowNumber: index + 2,
      externalReference: index === 0 ? "=1+1" : `REF-${index}`,
      guideCode: index === 0 ? 'GUIDE,"A"' : "GUIDE-A",
      workDate: "2026-10-01",
      grossComYen: 12000,
      dodoFeeYen: 1500,
      guidePaymentYen: 9250,
    })),
  });
  assert.equal(batch.canConfirm, true);

  const csv = createDodoImportConfirmationCsv(batch);
  assert.ok(csv.startsWith("\uFEFF取込元,対象月,"));
  assert.equal(csv.trimEnd().split("\r\n").length, 61);
  assert.match(csv, /"'=取込元"/);
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"GUIDE,""A"""/);
  assert.match(csv, /REF-59/);
  assert.match(csv, /"REF-59","GUIDE-A","2026-10-01",12000,1500,9250/);
});

test("confirmation CSV rejects an invalid batch", () => {
  const invalid = validateDodoImportBatch({
    sourcePartner: "",
    statementMonth: "2026-10",
    rows: [],
  });
  assert.throws(() => createDodoImportConfirmationCsv(invalid));
});
