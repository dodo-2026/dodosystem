import type { GuideDocumentNotificationOutboxRecord } from "./guideDocumentReadyNotificationOutbox.ts";
import {
  processGuideDocumentNotificationOutboxRecord,
  type GuideDocumentNotificationProviderRequest,
} from "./guideDocumentReadyNotificationWorker.ts";

const MAX_BATCH_SIZE = 25;
const IDEMPOTENCY_KEY_PATTERN = /^guide-document-ready:[0-9a-f]{64}$/;

type ProviderOutcome = "delivered" | "temporary_failure" | "permanent_failure";

export type GuideDocumentNotificationBatchResult = Readonly<{
  status: "processed" | "load_failed";
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

type CompareAndSet = (
  expected: GuideDocumentNotificationOutboxRecord,
  next: GuideDocumentNotificationOutboxRecord
) => Promise<boolean>;

function emptyResult(status: "processed" | "load_failed"): GuideDocumentNotificationBatchResult {
  return Object.freeze({
    status,
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
}

function reportPrivateFailure(onPrivateError: (() => void) | undefined): void {
  try {
    onPrivateError?.();
  } catch {
    // Observability must not change the fixed batch result.
  }
}

function candidatesAreBoundedAndUnique(
  records: unknown,
  maximum: number
): records is GuideDocumentNotificationOutboxRecord[] {
  if (!Array.isArray(records) || records.length > maximum) return false;
  const keys = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== "object") return false;
    const key = (record as { idempotencyKey?: unknown }).idempotencyKey;
    if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key) || keys.has(key)) {
      return false;
    }
    keys.add(key);
  }
  return true;
}

/**
 * Loads and processes a bounded notification batch in reader order.
 *
 * Records are processed serially to avoid an uncontrolled provider burst. A
 * failure for one candidate is contained by the worker and does not prevent
 * later candidates from progressing. All persistence and provider behavior is
 * injected; this module adds no scheduler, route, live store, or live send.
 */
export async function runGuideDocumentNotificationBatch({
  now,
  loadCandidates,
  compareAndSet,
  sendIdempotently,
  maximum = 10,
  leaseSeconds = 60,
  retryDelaySeconds = 60,
  onPrivateError,
}: {
  now: number;
  loadCandidates: (input: Readonly<{ now: number; limit: number }>) => Promise<unknown>;
  compareAndSet: CompareAndSet;
  sendIdempotently: (
    request: GuideDocumentNotificationProviderRequest
  ) => Promise<Readonly<{ outcome: ProviderOutcome }>>;
  maximum?: number;
  leaseSeconds?: number;
  retryDelaySeconds?: number;
  onPrivateError?: () => void;
}): Promise<GuideDocumentNotificationBatchResult> {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer timestamp.");
  }
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_BATCH_SIZE) {
    throw new Error(`maximum must be an integer from 1 to ${MAX_BATCH_SIZE}.`);
  }

  let candidates: unknown;
  try {
    candidates = await loadCandidates(Object.freeze({ now, limit: maximum }));
  } catch {
    reportPrivateFailure(onPrivateError);
    return emptyResult("load_failed");
  }
  let validatedCandidates: GuideDocumentNotificationOutboxRecord[] | null = null;
  try {
    if (candidatesAreBoundedAndUnique(candidates, maximum)) {
      validatedCandidates = candidates;
    }
  } catch {
    validatedCandidates = null;
  }
  if (!validatedCandidates) {
    reportPrivateFailure(onPrivateError);
    return emptyResult("load_failed");
  }

  const counts = {
    attempted: 0,
    delivered: 0,
    temporaryFailures: 0,
    permanentFailures: 0,
    leasesRecovered: 0,
    skipped: 0,
    persistenceUncertain: 0,
    privateFailures: 0,
  };

  for (const record of validatedCandidates) {
    const result = await processGuideDocumentNotificationOutboxRecord({
      record,
      now,
      compareAndSet,
      sendIdempotently,
      leaseSeconds,
      retryDelaySeconds,
      onPrivateError,
    });
    if (result.action === "delivery_attempted") {
      counts.attempted += 1;
      if (result.outcome === "delivered") counts.delivered += 1;
      if (result.outcome === "temporary_failure") counts.temporaryFailures += 1;
      if (result.outcome === "permanent_failure") counts.permanentFailures += 1;
      if (!result.persisted) counts.persistenceUncertain += 1;
      continue;
    }
    if (result.action === "lease_recovered") {
      counts.leasesRecovered += 1;
      if (!result.persisted) counts.persistenceUncertain += 1;
      continue;
    }
    counts.skipped += 1;
    if (result.reason === "private_failure") counts.privateFailures += 1;
  }

  return Object.freeze({
    status: "processed",
    candidates: validatedCandidates.length,
    ...counts,
  });
}
