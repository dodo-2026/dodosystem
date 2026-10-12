import type { GuideDocumentReadyNotificationAdmissionResult } from "./guideDocumentReadyNotificationCycleAdmission.ts";
import type { GuideDocumentNotificationBatchResult } from "./guideDocumentReadyNotificationBatch.ts";

const MAX_BATCH_SIZE = 25;

type Counts = Readonly<{
  candidates: number;
  attempted: number;
  delivered: number;
  temporaryFailures: number;
  permanentFailures: number;
  leasesRecovered: number;
  skipped: number;
  persistenceUncertain: number;
  privateFailures: number;
}>;

export type GuideDocumentReadyNotificationCycleSummary = Readonly<{
  schemaVersion: 1;
  admission: "executed" | "busy" | "contended" | "failed";
  release: "confirmed" | "uncertain" | "not_applicable" | "unknown";
  batch: "processed" | "load_failed" | "not_run";
  counts: Counts;
}>;

const ZERO_COUNTS: Counts = Object.freeze({
  candidates: 0,
  attempted: 0,
  delivered: 0,
  temporaryFailures: 0,
  permanentFailures: 0,
  leasesRecovered: 0,
  skipped: 0,
  persistenceUncertain: 0,
  privateFailures: 0,
});

function fixedSummary({
  admission,
  release,
  batch,
  counts = ZERO_COUNTS,
}: Readonly<{
  admission: GuideDocumentReadyNotificationCycleSummary["admission"];
  release: GuideDocumentReadyNotificationCycleSummary["release"];
  batch: GuideDocumentReadyNotificationCycleSummary["batch"];
  counts?: Counts;
}>) {
  return Object.freeze({
    schemaVersion: 1 as const,
    admission,
    release,
    batch,
    counts,
  });
}

function exactKeys(value: object, expected: string): boolean {
  return Object.keys(value).sort().join(",") === expected;
}

function boundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_BATCH_SIZE;
}

function normalizeBatch(value: unknown): GuideDocumentNotificationBatchResult | null {
  if (!value || typeof value !== "object" || !exactKeys(
    value,
    "attempted,candidates,delivered,leasesRecovered,permanentFailures,persistenceUncertain,privateFailures,skipped,status,temporaryFailures"
  )) {
    return null;
  }
  const batch = value as Record<string, unknown>;
  if (batch.status !== "processed" && batch.status !== "load_failed") return null;
  const countFields = [
    "candidates",
    "attempted",
    "delivered",
    "temporaryFailures",
    "permanentFailures",
    "leasesRecovered",
    "skipped",
    "persistenceUncertain",
    "privateFailures",
  ] as const;
  if (!countFields.every((field) => boundedCount(batch[field]))) return null;

  const candidates = batch.candidates as number;
  const attempted = batch.attempted as number;
  const delivered = batch.delivered as number;
  const temporaryFailures = batch.temporaryFailures as number;
  const permanentFailures = batch.permanentFailures as number;
  const leasesRecovered = batch.leasesRecovered as number;
  const skipped = batch.skipped as number;
  const persistenceUncertain = batch.persistenceUncertain as number;
  const privateFailures = batch.privateFailures as number;
  const loadFailedValid =
    batch.status === "load_failed" && countFields.every((field) => batch[field] === 0);
  const processedValid =
    batch.status === "processed" &&
    attempted + leasesRecovered + skipped === candidates &&
    delivered + temporaryFailures + permanentFailures === attempted &&
    persistenceUncertain <= attempted + leasesRecovered &&
    privateFailures <= skipped;
  if (!loadFailedValid && !processedValid) return null;

  return Object.freeze({
    status: batch.status,
    candidates,
    attempted,
    delivered,
    temporaryFailures,
    permanentFailures,
    leasesRecovered,
    skipped,
    persistenceUncertain,
    privateFailures,
  });
}

function failedSummary() {
  return fixedSummary({
    admission: "failed",
    release: "unknown",
    batch: "not_run",
  });
}

/**
 * Converts one internal admission result into a fixed read-only operational
 * summary. The output contains only bounded counters and generic states. Run
 * identifiers, document and recipient data, payloads, provider responses, and
 * persistence errors are never copied into the model.
 */
export function summarizeGuideDocumentReadyNotificationCycle(
  input: GuideDocumentReadyNotificationAdmissionResult
): GuideDocumentReadyNotificationCycleSummary {
  try {
    if (!input || typeof input !== "object") return failedSummary();
    if (input.status === "skipped") {
      if (!exactKeys(input, "reason,status")) return failedSummary();
      if (input.reason !== "busy" && input.reason !== "claim_conflict") {
        return failedSummary();
      }
      return fixedSummary({
        admission: input.reason === "busy" ? "busy" : "contended",
        release: "not_applicable",
        batch: "not_run",
      });
    }

    if (input.status === "failed") {
      if (!exactKeys(input, "releasePersisted,status") || typeof input.releasePersisted !== "boolean") {
        return failedSummary();
      }
      return fixedSummary({
        admission: "failed",
        release: input.releasePersisted ? "confirmed" : "unknown",
        batch: "not_run",
      });
    }

    if (input.status !== "executed" || !exactKeys(input, "batch,releasePersisted,status")) {
      return failedSummary();
    }
    if (typeof input.releasePersisted !== "boolean") return failedSummary();
    const normalizedBatch = normalizeBatch(input.batch);
    if (!normalizedBatch) return failedSummary();
    const counts = Object.freeze({
      candidates: normalizedBatch.candidates,
      attempted: normalizedBatch.attempted,
      delivered: normalizedBatch.delivered,
      temporaryFailures: normalizedBatch.temporaryFailures,
      permanentFailures: normalizedBatch.permanentFailures,
      leasesRecovered: normalizedBatch.leasesRecovered,
      skipped: normalizedBatch.skipped,
      persistenceUncertain: normalizedBatch.persistenceUncertain,
      privateFailures: normalizedBatch.privateFailures,
    });
    return fixedSummary({
      admission: "executed",
      release: input.releasePersisted ? "confirmed" : "uncertain",
      batch: normalizedBatch.status,
      counts,
    });
  } catch {
    return failedSummary();
  }
}
