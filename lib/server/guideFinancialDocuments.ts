const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type YenTotals = Readonly<{
  grossComYen: number;
  dodoFeeYen: number;
  adjustmentYen: number;
  guidePaymentYen: number;
}>;

export type SettlementDocumentLineInput = Readonly<{
  importRowId: string;
  workDate: string;
  grossComYen: number;
  dodoFeeYen: number;
  guidePaymentYen: number;
}>;

type DocumentRevisionInput = Readonly<{
  documentId: string;
  version: number;
  supersedesDocumentId?: string | null;
}>;

export type SettlementDocumentInput = Readonly<{
  settlementId: string;
  guideId: string;
  statementMonth: string;
  settlementStatus: "confirmed" | "payable" | "paid";
  confirmedAt: string;
  totals: YenTotals;
  lines: readonly SettlementDocumentLineInput[];
}> & DocumentRevisionInput;

export type SettlementDocumentSnapshot = Readonly<{
  schemaVersion: 1;
  documentKind: "settlement";
  documentId: string;
  version: number;
  supersedesDocumentId: string | null;
  settlementId: string;
  guideId: string;
  statementMonth: string;
  settlementStatus: "confirmed" | "payable" | "paid";
  confirmedAt: string;
  totals: YenTotals;
  lines: readonly SettlementDocumentLineInput[];
}>;

export type ReceiptDocumentInput = Readonly<{
  settlement: SettlementDocumentSnapshot;
  settlementFingerprint: string;
  paymentId: string;
  paymentStatus: "paid";
  amountYen: number;
  paidAt: string;
}> & DocumentRevisionInput;

export type ReceiptDocumentSnapshot = Readonly<{
  schemaVersion: 1;
  documentKind: "receipt";
  documentId: string;
  version: number;
  supersedesDocumentId: string | null;
  settlementDocumentId: string;
  settlementFingerprint: string;
  settlementId: string;
  guideId: string;
  statementMonth: string;
  paymentId: string;
  amountYen: number;
  paidAt: string;
}>;

export type GuideFinancialDocumentSnapshot =
  | SettlementDocumentSnapshot
  | ReceiptDocumentSnapshot;

function requireUuid(value: string, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function requireIsoTimestamp(value: string, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(`${field} must be an ISO timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} must be a normalized ISO timestamp.`);
  }
  return value;
}

function requireIsoDate(value: string, field: string): string {
  const match = typeof value === "string"
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    : null;
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
  return value;
}

function requireYen(value: number, field: string, allowNegative = false): number {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new Error(`${field} must be ${allowNegative ? "a" : "a non-negative"} safe integer yen amount.`);
  }
  return value;
}

function requireRevision(input: DocumentRevisionInput) {
  const documentId = requireUuid(input.documentId, "documentId");
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error("version must be an integer of at least 1.");
  }
  const supersedesDocumentId = input.supersedesDocumentId == null
    ? null
    : requireUuid(input.supersedesDocumentId, "supersedesDocumentId");
  if (input.version === 1 && supersedesDocumentId !== null) {
    throw new Error("The first version cannot supersede another document.");
  }
  if (input.version > 1 && supersedesDocumentId === null) {
    throw new Error("A reissued document must identify the document it supersedes.");
  }
  if (documentId === supersedesDocumentId) {
    throw new Error("A document cannot supersede itself.");
  }
  return { documentId, version: input.version, supersedesDocumentId };
}

function addYen(left: number, right: number, field: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`${field} total exceeds the safe integer range.`);
  }
  return sum;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Creates the immutable data payload used to render a confirmed settlement.
 * The three imported amount columns are checked independently. DODO's business
 * formula is deliberately not inferred here because it has not been approved.
 */
export function createSettlementDocumentSnapshot(
  input: SettlementDocumentInput
): SettlementDocumentSnapshot {
  const revision = requireRevision(input);
  const settlementId = requireUuid(input.settlementId, "settlementId");
  const guideId = requireUuid(input.guideId, "guideId");
  if (!PERIOD_PATTERN.test(input.statementMonth)) {
    throw new Error("statementMonth must use YYYY-MM.");
  }
  if (!["confirmed", "payable", "paid"].includes(input.settlementStatus)) {
    throw new Error("Only a confirmed settlement can produce a document snapshot.");
  }
  const confirmedAt = requireIsoTimestamp(input.confirmedAt, "confirmedAt");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("A settlement document requires at least one source line.");
  }

  const seen = new Set<string>();
  const sums = { grossComYen: 0, dodoFeeYen: 0, guidePaymentYen: 0 };
  const lines = input.lines.map((line, index) => {
    const importRowId = requireUuid(line.importRowId, `lines[${index}].importRowId`);
    if (seen.has(importRowId)) throw new Error("Settlement source lines must be unique.");
    seen.add(importRowId);
    const normalized = {
      importRowId,
      workDate: requireIsoDate(line.workDate, `lines[${index}].workDate`),
      grossComYen: requireYen(line.grossComYen, `lines[${index}].grossComYen`),
      dodoFeeYen: requireYen(line.dodoFeeYen, `lines[${index}].dodoFeeYen`),
      guidePaymentYen: requireYen(line.guidePaymentYen, `lines[${index}].guidePaymentYen`),
    };
    sums.grossComYen = addYen(sums.grossComYen, normalized.grossComYen, "grossComYen");
    sums.dodoFeeYen = addYen(sums.dodoFeeYen, normalized.dodoFeeYen, "dodoFeeYen");
    sums.guidePaymentYen = addYen(sums.guidePaymentYen, normalized.guidePaymentYen, "guidePaymentYen");
    return normalized;
  });

  const totals = {
    grossComYen: requireYen(input.totals.grossComYen, "totals.grossComYen"),
    dodoFeeYen: requireYen(input.totals.dodoFeeYen, "totals.dodoFeeYen"),
    adjustmentYen: requireYen(input.totals.adjustmentYen, "totals.adjustmentYen", true),
    guidePaymentYen: requireYen(input.totals.guidePaymentYen, "totals.guidePaymentYen"),
  };
  for (const field of ["grossComYen", "dodoFeeYen", "guidePaymentYen"] as const) {
    if (totals[field] !== sums[field]) {
      throw new Error(`${field} total does not match the source lines.`);
    }
  }

  return deepFreeze({
    schemaVersion: 1,
    documentKind: "settlement",
    ...revision,
    settlementId,
    guideId,
    statementMonth: input.statementMonth,
    settlementStatus: input.settlementStatus,
    confirmedAt,
    totals,
    lines,
  });
}

/** Creates receipt data only after a matching payment has been marked paid. */
export async function createReceiptDocumentSnapshot(
  input: ReceiptDocumentInput
): Promise<ReceiptDocumentSnapshot> {
  const revision = requireRevision(input);
  if (input.paymentStatus !== "paid") {
    throw new Error("A receipt can only be created for a paid payment.");
  }
  if (!SHA256_PATTERN.test(input.settlementFingerprint)) {
    throw new Error("settlementFingerprint must be a SHA-256 digest.");
  }
  if (!(await verifyGuideFinancialDocumentFingerprint(input.settlement, input.settlementFingerprint))) {
    throw new Error("Settlement fingerprint does not match the supplied snapshot.");
  }
  const amountYen = requireYen(input.amountYen, "amountYen");
  if (amountYen !== input.settlement.totals.guidePaymentYen) {
    throw new Error("Receipt amount does not match the guide payment total.");
  }

  return deepFreeze({
    schemaVersion: 1,
    documentKind: "receipt",
    ...revision,
    settlementDocumentId: input.settlement.documentId,
    settlementFingerprint: input.settlementFingerprint,
    settlementId: input.settlement.settlementId,
    guideId: input.settlement.guideId,
    statementMonth: input.settlement.statementMonth,
    paymentId: requireUuid(input.paymentId, "paymentId"),
    amountYen,
    paidAt: requireIsoTimestamp(input.paidAt, "paidAt"),
  });
}

/** Hashes the exact immutable payload that will be given to a renderer. */
export async function fingerprintGuideFinancialDocument(
  snapshot: GuideFinancialDocumentSnapshot
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyGuideFinancialDocumentFingerprint(
  snapshot: GuideFinancialDocumentSnapshot,
  expected: string
): Promise<boolean> {
  if (!SHA256_PATTERN.test(expected)) return false;
  const actual = await fingerprintGuideFinancialDocument(snapshot);
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
