import type { DodoImportRowInput } from "./importValidation";

export type DodoImportColumn =
  | "externalReference"
  | "guideCode"
  | "workDate"
  | "grossComYen"
  | "dodoFeeYen"
  | "guidePaymentYen";

export type DodoImportTextIssue = {
  code:
    | "empty_file"
    | "unclosed_quote"
    | "too_many_rows"
    | "too_many_columns"
    | "cell_too_long"
    | "missing_column"
    | "duplicate_column"
    | "empty_header"
    | "column_count_mismatch"
    | "empty_data"
    | "repeated_header";
  message: string;
  sourceRowNumber?: number;
};

export type DodoImportTextResult = {
  delimiter: "," | "\t";
  headers: string[];
  columnIndexes: Partial<Record<DodoImportColumn, number>>;
  rows: DodoImportRowInput[];
  issues: DodoImportTextIssue[];
};

type DelimitedRecord = {
  cells: string[];
  sourceRowNumber: number;
};

export const DODO_IMPORT_MAX_DATA_ROWS = 10_000;
export const DODO_IMPORT_MAX_COLUMNS = 50;
export const DODO_IMPORT_MAX_CELL_CHARACTERS = 10_000;

const REQUIRED_COLUMNS: readonly DodoImportColumn[] = [
  "guideCode",
  "workDate",
  "grossComYen",
  "dodoFeeYen",
  "guidePaymentYen",
];

const COLUMN_LABELS: Record<DodoImportColumn, string> = {
  externalReference: "外部参照番号",
  guideCode: "ガイドコード",
  workDate: "稼働日",
  grossComYen: "COM金額",
  dodoFeeYen: "DODO手数料",
  guidePaymentYen: "ガイド支払額",
};

const COLUMN_ALIASES: Record<DodoImportColumn, readonly string[]> = {
  externalReference: [
    "外部参照番号",
    "取引番号",
    "明細番号",
    "externalreference",
  ],
  guideCode: ["ガイドコード", "ガイド番号", "guidecode"],
  workDate: ["稼働日", "日付", "workdate"],
  grossComYen: ["com", "com金額", "売上com", "grosscomyen"],
  dodoFeeYen: ["dodo手数料", "dodofeeyen"],
  guidePaymentYen: ["ガイド支払額", "支払額", "guidepaymentyen"],
};

export function createDodoImportSampleCsv(): string {
  return [
    "\uFEFF外部参照番号,ガイドコード,稼働日,COM金額,DODO手数料,ガイド支払額",
    "SAMPLE-001,GUIDE-001,2026-10-01,12000,1500,9250",
    "",
  ].join("\r\n");
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-ー]/g, "");
}

function detectDelimiter(text: string): "," | "\t" {
  let commaCount = 0;
  let tabCount = 0;
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      break;
    }

    if (!inQuotes && character === ",") {
      commaCount += 1;
    } else if (!inQuotes && character === "\t") {
      tabCount += 1;
    }
  }

  return tabCount > commaCount ? "\t" : ",";
}

function parseRecords(
  source: string,
  delimiter: "," | "\t"
): {
  records: DelimitedRecord[];
  hasUnclosedQuote: boolean;
  limitIssue?: DodoImportTextIssue;
} {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const records: DelimitedRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let currentLine = 1;
  let recordStartLine = 1;
  let limitIssue: DodoImportTextIssue | undefined;

  const checkCellLength = () => {
    if (cell.length > DODO_IMPORT_MAX_CELL_CHARACTERS) {
      limitIssue = {
        code: "cell_too_long",
        message: `${cells.length + 1}列目の値が${DODO_IMPORT_MAX_CELL_CHARACTERS.toLocaleString("ja-JP")}文字を超えています。元データを確認してください。`,
        sourceRowNumber: recordStartLine,
      };
    }
  };

  const finishRecord = () => {
    cells.push(cell);
    const isBlank = cells.every((value) => value.trim().length === 0);

    if (!isBlank) {
      if (cells.length > DODO_IMPORT_MAX_COLUMNS) {
        limitIssue = {
          code: "too_many_columns",
          message: `列数が${DODO_IMPORT_MAX_COLUMNS}列を超えています。必要な列だけに整理してください。`,
          sourceRowNumber: recordStartLine,
        };
        return;
      }

      if (records.length >= DODO_IMPORT_MAX_DATA_ROWS + 1) {
        limitIssue = {
          code: "too_many_rows",
          message: `明細行が${DODO_IMPORT_MAX_DATA_ROWS.toLocaleString("ja-JP")}件を超えています。月ごとなどにファイルを分けてください。`,
          sourceRowNumber: recordStartLine,
        };
        return;
      }

      records.push({ cells, sourceRowNumber: recordStartLine });
    }

    cells = [];
    cell = "";
    recordStartLine = currentLine;
  };

  for (
    let index = 0;
    index < text.length && limitIssue === undefined;
    index += 1
  ) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
          checkCellLength();
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
        checkCellLength();

        if (character === "\n") {
          currentLine += 1;
        } else if (character === "\r" && text[index + 1] !== "\n") {
          currentLine += 1;
        }
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (character === delimiter) {
      cells.push(cell);
      cell = "";

      if (cells.length >= DODO_IMPORT_MAX_COLUMNS) {
        limitIssue = {
          code: "too_many_columns",
          message: `列数が${DODO_IMPORT_MAX_COLUMNS}列を超えています。必要な列だけに整理してください。`,
          sourceRowNumber: recordStartLine,
        };
      }
    } else if (character === "\n") {
      currentLine += 1;
      finishRecord();
    } else if (character === "\r") {
      if (text[index + 1] === "\n") {
        index += 1;
      }
      currentLine += 1;
      finishRecord();
    } else {
      cell += character;
      checkCellLength();
    }
  }

  if (
    limitIssue === undefined &&
    (cell.length > 0 || cells.length > 0)
  ) {
    finishRecord();
  }

  return { records, hasUnclosedQuote: inQuotes, limitIssue };
}

function resolveColumnIndexes(
  headers: readonly string[],
  headerSourceRowNumber: number,
  issues: DodoImportTextIssue[]
): Partial<Record<DodoImportColumn, number>> {
  const indexes: Partial<Record<DodoImportColumn, number>> = {};

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);

    if (normalized.length === 0) {
      issues.push({
        code: "empty_header",
        message: `${index + 1}列目の見出しが空です。`,
        sourceRowNumber: headerSourceRowNumber,
      });
      return;
    }

    const matchedColumn = (Object.keys(COLUMN_ALIASES) as DodoImportColumn[])
      .find((column) =>
        COLUMN_ALIASES[column].some(
          (alias) => normalizeHeader(alias) === normalized
        )
      );

    if (matchedColumn === undefined) {
      return;
    }

    if (indexes[matchedColumn] !== undefined) {
      issues.push({
        code: "duplicate_column",
        message: `${COLUMN_LABELS[matchedColumn]}に該当する列が複数あります。`,
        sourceRowNumber: headerSourceRowNumber,
      });
      return;
    }

    indexes[matchedColumn] = index;
  });

  for (const requiredColumn of REQUIRED_COLUMNS) {
    if (indexes[requiredColumn] === undefined) {
      issues.push({
        code: "missing_column",
        message: `必須列「${COLUMN_LABELS[requiredColumn]}」がありません。`,
        sourceRowNumber: headerSourceRowNumber,
      });
    }
  }

  return indexes;
}

function valueAt(
  cells: readonly string[],
  index: number | undefined
): string | undefined {
  return index === undefined ? undefined : cells[index];
}

export function parseDodoImportText(text: string): DodoImportTextResult {
  const delimiter = detectDelimiter(text);
  const { records, hasUnclosedQuote, limitIssue } = parseRecords(
    text,
    delimiter
  );
  const issues: DodoImportTextIssue[] = [];

  if (limitIssue !== undefined) {
    return {
      delimiter,
      headers: records[0]?.cells.map((header) => header.trim()) ?? [],
      columnIndexes: {},
      rows: [],
      issues: [limitIssue],
    };
  }

  if (records.length === 0) {
    return {
      delimiter,
      headers: [],
      columnIndexes: {},
      rows: [],
      issues: [{ code: "empty_file", message: "ファイルが空です。" }],
    };
  }

  if (hasUnclosedQuote) {
    issues.push({
      code: "unclosed_quote",
      message: "引用符（\"）が閉じていません。ファイル内容を確認してください。",
    });
  }

  const headerRecord = records[0];
  const headers = headerRecord.cells.map((header) => header.trim());
  const columnIndexes = resolveColumnIndexes(
    headers,
    headerRecord.sourceRowNumber,
    issues
  );

  if (records.length === 1) {
    issues.push({
      code: "empty_data",
      message: "見出しだけで、取込対象の明細行がありません。",
      sourceRowNumber: headerRecord.sourceRowNumber,
    });
  }

  for (const record of records.slice(1)) {
    if (record.cells.length !== headers.length) {
      issues.push({
        code: "column_count_mismatch",
        message: `見出しは${headers.length}列ですが、この行は${record.cells.length}列です。区切り位置を確認してください。`,
        sourceRowNumber: record.sourceRowNumber,
      });
      continue;
    }

    const isRepeatedHeader = record.cells.every(
      (cell, index) => normalizeHeader(cell) === normalizeHeader(headers[index])
    );

    if (isRepeatedHeader) {
      issues.push({
        code: "repeated_header",
        message: "ファイルの途中に見出し行が繰り返されています。削除してください。",
        sourceRowNumber: record.sourceRowNumber,
      });
    }
  }

  const rows = records.slice(1).map(({ cells, sourceRowNumber }) => ({
    sourceRowNumber,
    externalReference: valueAt(cells, columnIndexes.externalReference),
    guideCode: valueAt(cells, columnIndexes.guideCode),
    workDate: valueAt(cells, columnIndexes.workDate),
    grossComYen: valueAt(cells, columnIndexes.grossComYen),
    dodoFeeYen: valueAt(cells, columnIndexes.dodoFeeYen),
    guidePaymentYen: valueAt(cells, columnIndexes.guidePaymentYen),
  }));

  return { delimiter, headers, columnIndexes, rows, issues };
}
