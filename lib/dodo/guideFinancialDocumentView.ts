import type {
  GuideFinancialDocumentSnapshot,
  ReceiptDocumentSnapshot,
  SettlementDocumentSnapshot,
} from "../server/guideFinancialDocuments.ts";

export type FinancialDocumentViewContext = Readonly<{
  guideDisplayName: string;
  issuerDisplayName: string;
  issuedOn: string;
}>;

type DisplayAmount = Readonly<{ label: string; value: string }>;

export type SettlementDocumentView = Readonly<{
  kind: "settlement";
  title: "月次精算書";
  recipient: string;
  issuer: string;
  issuedOnLabel: string;
  periodLabel: string;
  reference: string;
  revisionLabel: string;
  statusLabel: string;
  details: readonly Readonly<{
    workDateLabel: string;
    grossComYen: string;
    dodoFeeYen: string;
    guidePaymentYen: string;
  }>[];
  totals: readonly DisplayAmount[];
}>;

export type ReceiptDocumentView = Readonly<{
  kind: "receipt";
  title: "受取書";
  recipient: string;
  issuer: string;
  issuedOnLabel: string;
  periodLabel: string;
  reference: string;
  revisionLabel: string;
  statusLabel: "支払済";
  amountLabel: string;
  paidOnLabel: string;
  settlementReference: string;
}>;

export type GuideFinancialDocumentView = SettlementDocumentView | ReceiptDocumentView;

export type SettlementDocumentPage = Readonly<{
  pageNumber: number;
  totalPages: number;
  details: SettlementDocumentView["details"];
  showTotals: boolean;
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function requireDisplayText(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 80 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  ) {
    throw new Error(`${field} must be plain display text of 1 to 80 characters.`);
  }
  return value.trim();
}

function parseIsoDate(value: string, field: string): readonly [number, number, number] {
  const match = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) throw new Error(`${field} must be an ISO date.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${field} must be an ISO date.`);
  }
  return [year, month, day];
}

function formatDate(value: string, field: string): string {
  const [year, month, day] = parseIsoDate(value, field);
  return `${year}年${month}月${day}日`;
}

function formatTimestampDate(value: string, field: string): string {
  if (typeof value !== "string" || !value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a UTC ISO timestamp.`);
  }
  return formatDate(value.slice(0, 10), field);
}

export function formatYen(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error("Yen value must be a safe integer.");
  return `${value < 0 ? "−" : ""}¥${Math.abs(value).toLocaleString("ja-JP")}`;
}

function formatPeriod(period: string): string {
  const match = period.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) throw new Error("statementMonth must use YYYY-MM.");
  return `${Number(match[1])}年${Number(match[2])}月分`;
}

function reference(kind: "S" | "R", documentId: string, period: string): string {
  return `DODO-${period.replace("-", "")}-${kind}-${documentId.slice(0, 8).toUpperCase()}`;
}

function common(snapshot: GuideFinancialDocumentSnapshot, context: FinancialDocumentViewContext) {
  return {
    recipient: `${requireDisplayText(context.guideDisplayName, "guideDisplayName")} 様`,
    issuer: requireDisplayText(context.issuerDisplayName, "issuerDisplayName"),
    issuedOnLabel: formatDate(context.issuedOn, "issuedOn"),
    periodLabel: formatPeriod(snapshot.statementMonth),
    revisionLabel: snapshot.version === 1 ? "初版" : `第${snapshot.version}版（訂正版）`,
  };
}

function settlementView(
  snapshot: SettlementDocumentSnapshot,
  context: FinancialDocumentViewContext
): SettlementDocumentView {
  const statusLabel = snapshot.settlementStatus === "paid" ? "支払済" : "確定済";
  return deepFreeze({
    kind: "settlement",
    title: "月次精算書",
    ...common(snapshot, context),
    reference: reference("S", snapshot.documentId, snapshot.statementMonth),
    statusLabel,
    details: snapshot.lines.map((line) => ({
      workDateLabel: formatDate(line.workDate, "workDate"),
      grossComYen: formatYen(line.grossComYen),
      dodoFeeYen: formatYen(line.dodoFeeYen),
      guidePaymentYen: formatYen(line.guidePaymentYen),
    })),
    totals: [
      { label: "COM合計", value: formatYen(snapshot.totals.grossComYen) },
      { label: "DODO手数料合計", value: formatYen(snapshot.totals.dodoFeeYen) },
      { label: "調整額", value: formatYen(snapshot.totals.adjustmentYen) },
      { label: "ガイド支払額", value: formatYen(snapshot.totals.guidePaymentYen) },
    ],
  });
}

function receiptView(
  snapshot: ReceiptDocumentSnapshot,
  context: FinancialDocumentViewContext
): ReceiptDocumentView {
  return deepFreeze({
    kind: "receipt",
    title: "受取書",
    ...common(snapshot, context),
    reference: reference("R", snapshot.documentId, snapshot.statementMonth),
    statusLabel: "支払済",
    amountLabel: formatYen(snapshot.amountYen),
    paidOnLabel: formatTimestampDate(snapshot.paidAt, "paidAt"),
    settlementReference: reference("S", snapshot.settlementDocumentId, snapshot.statementMonth),
  });
}

/**
 * Converts a validated immutable snapshot to plain display strings. It cannot
 * read a database, Storage key, bank account, phone number or WeChat token.
 */
export function createGuideFinancialDocumentView(
  snapshot: SettlementDocumentSnapshot,
  context: FinancialDocumentViewContext
): SettlementDocumentView;
export function createGuideFinancialDocumentView(
  snapshot: ReceiptDocumentSnapshot,
  context: FinancialDocumentViewContext
): ReceiptDocumentView;
export function createGuideFinancialDocumentView(
  snapshot: GuideFinancialDocumentSnapshot,
  context: FinancialDocumentViewContext
): GuideFinancialDocumentView {
  return snapshot.documentKind === "settlement"
    ? settlementView(snapshot, context)
    : receiptView(snapshot, context);
}

/** Splits immutable detail rows into predictable A4-sized page groups. */
export function paginateSettlementDocumentView(
  view: SettlementDocumentView,
  rowsPerPage = 12
): readonly SettlementDocumentPage[] {
  if (!Number.isSafeInteger(rowsPerPage) || rowsPerPage < 1 || rowsPerPage > 50) {
    throw new Error("rowsPerPage must be an integer from 1 to 50.");
  }
  if (view.details.length === 0) {
    throw new Error("A settlement view must contain at least one detail row.");
  }
  const totalPages = Math.ceil(view.details.length / rowsPerPage);
  const pages = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    return {
      pageNumber,
      totalPages,
      details: Object.freeze(view.details.slice(index * rowsPerPage, pageNumber * rowsPerPage)),
      showTotals: pageNumber === totalPages,
    };
  });
  return deepFreeze(pages);
}
