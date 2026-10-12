export type DodoImportIssueCode =
  | "required"
  | "invalid_format"
  | "invalid_amount"
  | "invalid_row_number"
  | "duplicate"
  | "empty_rows";

export type DodoImportIssue = {
  code: DodoImportIssueCode;
  field: string;
  message: string;
  sourceRowNumber?: number;
};

export type DodoImportRowInput = {
  sourceRowNumber: unknown;
  externalReference?: unknown;
  guideCode: unknown;
  workDate: unknown;
  grossComYen: unknown;
  dodoFeeYen: unknown;
  guidePaymentYen: unknown;
};

export type DodoImportBatchInput = {
  sourcePartner: unknown;
  statementMonth: unknown;
  rows: readonly DodoImportRowInput[];
};

export type NormalizedDodoImportRow = {
  sourceRowNumber: number;
  externalReference: string | null;
  guideCode: string;
  workDate: string;
  grossComYen: number;
  dodoFeeYen: number;
  guidePaymentYen: number;
};

export type DodoImportBatchValidation = {
  sourcePartner: string | null;
  statementMonth: string | null;
  rows: NormalizedDodoImportRow[];
  issues: DodoImportIssue[];
  canConfirm: boolean;
};

export type DodoImportTotals = {
  rowCount: number;
  grossComYen: bigint;
  dodoFeeYen: bigint;
  guidePaymentYen: bigint;
};

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATEMENT_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;

function normalizeRequiredText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeRequiredText(value);
}

function normalizeStatementMonth(value: unknown): string | null {
  const normalized = normalizeRequiredText(value);
  const match = normalized?.match(STATEMENT_MONTH_PATTERN);

  if (!match) {
    return null;
  }

  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? normalized : null;
}

function normalizeIsoDate(value: unknown): string | null {
  const normalized = normalizeRequiredText(value);
  const match = normalized?.match(ISO_DATE_PATTERN);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return normalized;
}

function normalizeSourceRowNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return null;
  }

  return value;
}

function normalizeYen(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replaceAll(",", "");

  if (!NON_NEGATIVE_INTEGER_PATTERN.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

function addIssue(
  issues: DodoImportIssue[],
  issue: DodoImportIssue
): void {
  issues.push(issue);
}

function validateRow(
  input: DodoImportRowInput,
  issues: DodoImportIssue[]
): NormalizedDodoImportRow | null {
  const sourceRowNumber = normalizeSourceRowNumber(input.sourceRowNumber);
  const guideCode = normalizeRequiredText(input.guideCode);
  const workDate = normalizeIsoDate(input.workDate);
  const grossComYen = normalizeYen(input.grossComYen);
  const dodoFeeYen = normalizeYen(input.dodoFeeYen);
  const guidePaymentYen = normalizeYen(input.guidePaymentYen);
  const externalReference = normalizeOptionalText(input.externalReference);
  const rowLabel = sourceRowNumber ?? undefined;

  if (sourceRowNumber === null) {
    addIssue(issues, {
      code: "invalid_row_number",
      field: "sourceRowNumber",
      message: "取込元の行番号は1以上の整数で指定してください。",
    });
  }

  if (guideCode === null) {
    addIssue(issues, {
      code: "required",
      field: "guideCode",
      message: "ガイドコードは必須です。",
      sourceRowNumber: rowLabel,
    });
  }

  if (workDate === null) {
    addIssue(issues, {
      code: "invalid_format",
      field: "workDate",
      message: "稼働日は実在する日付をYYYY-MM-DD形式で指定してください。",
      sourceRowNumber: rowLabel,
    });
  }

  const amountFields: Array<[string, number | null]> = [
    ["grossComYen", grossComYen],
    ["dodoFeeYen", dodoFeeYen],
    ["guidePaymentYen", guidePaymentYen],
  ];

  for (const [field, amount] of amountFields) {
    if (amount === null) {
      addIssue(issues, {
        code: "invalid_amount",
        field,
        message: "金額は0以上の整数（円）で指定してください。",
        sourceRowNumber: rowLabel,
      });
    }
  }

  if (
    sourceRowNumber === null ||
    guideCode === null ||
    workDate === null ||
    grossComYen === null ||
    dodoFeeYen === null ||
    guidePaymentYen === null
  ) {
    return null;
  }

  return {
    sourceRowNumber,
    externalReference,
    guideCode,
    workDate,
    grossComYen,
    dodoFeeYen,
    guidePaymentYen,
  };
}

function duplicateIdentity(row: NormalizedDodoImportRow): string {
  if (row.externalReference !== null) {
    return JSON.stringify(["reference", row.externalReference]);
  }

  return JSON.stringify([
    "content",
    row.guideCode,
    row.workDate,
    row.grossComYen,
    row.dodoFeeYen,
    row.guidePaymentYen,
  ]);
}

export function validateDodoImportBatch(
  input: DodoImportBatchInput
): DodoImportBatchValidation {
  const issues: DodoImportIssue[] = [];
  const sourcePartner = normalizeRequiredText(input.sourcePartner);
  const statementMonth = normalizeStatementMonth(input.statementMonth);

  if (sourcePartner === null) {
    addIssue(issues, {
      code: "required",
      field: "sourcePartner",
      message: "取込元は必須です。",
    });
  }

  if (statementMonth === null) {
    addIssue(issues, {
      code: "invalid_format",
      field: "statementMonth",
      message: "対象月はYYYY-MM形式で指定してください。",
    });
  }

  if (input.rows.length === 0) {
    addIssue(issues, {
      code: "empty_rows",
      field: "rows",
      message: "取込対象の明細が1件もありません。",
    });
  }

  const rows = input.rows.flatMap((row) => {
    const normalized = validateRow(row, issues);
    return normalized === null ? [] : [normalized];
  });
  const firstRowByIdentity = new Map<string, number>();

  for (const row of rows) {
    const identity = duplicateIdentity(row);
    const firstRow = firstRowByIdentity.get(identity);

    if (firstRow === undefined) {
      firstRowByIdentity.set(identity, row.sourceRowNumber);
      continue;
    }

    addIssue(issues, {
      code: "duplicate",
      field: "row",
      message: `取込行${firstRow}と同じ明細です。`,
      sourceRowNumber: row.sourceRowNumber,
    });
  }

  return {
    sourcePartner,
    statementMonth,
    rows,
    issues,
    canConfirm: issues.length === 0,
  };
}

export function summarizeDodoImportRows(
  rows: readonly NormalizedDodoImportRow[]
): DodoImportTotals {
  return rows.reduce<DodoImportTotals>(
    (totals, row) => ({
      rowCount: totals.rowCount + 1,
      grossComYen: totals.grossComYen + BigInt(row.grossComYen),
      dodoFeeYen: totals.dodoFeeYen + BigInt(row.dodoFeeYen),
      guidePaymentYen:
        totals.guidePaymentYen + BigInt(row.guidePaymentYen),
    }),
    {
      rowCount: 0,
      grossComYen: BigInt(0),
      dodoFeeYen: BigInt(0),
      guidePaymentYen: BigInt(0),
    }
  );
}
