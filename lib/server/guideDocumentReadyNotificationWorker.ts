import type { GuideDocumentReadyNotificationPayload } from "./guideDocumentReadyNotificationPolicy.ts";
import {
  GUIDE_DOCUMENT_NOTIFICATION_MAX_ATTEMPTS,
  beginGuideDocumentNotificationAttempt,
  completeGuideDocumentNotificationAttempt,
  recoverExpiredGuideDocumentNotificationLease,
  type GuideDocumentNotificationOutboxRecord,
} from "./guideDocumentReadyNotificationOutbox.ts";

const PROVIDER_OUTCOMES = [
  "delivered",
  "temporary_failure",
  "permanent_failure",
] as const;

type ProviderOutcome = (typeof PROVIDER_OUTCOMES)[number];

export type GuideDocumentNotificationProviderRequest = Readonly<{
  idempotencyKey: string;
  payload: GuideDocumentReadyNotificationPayload;
}>;

export type GuideDocumentNotificationWorkerResult = Readonly<
  | { action: "none"; reason: "not_available" | "claim_conflict" | "private_failure" }
  | { action: "lease_recovered"; persisted: boolean }
  | { action: "delivery_attempted"; outcome: ProviderOutcome; persisted: boolean }
>;

type CompareAndSet = (
  expected: GuideDocumentNotificationOutboxRecord,
  next: GuideDocumentNotificationOutboxRecord
) => Promise<boolean>;

function requireTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("now must be a non-negative safe integer timestamp.");
  }
}

function requireBoundedSeconds(value: number, field: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be an integer from 1 to ${maximum}.`);
  }
}

function normalizeProviderOutcome(value: unknown): ProviderOutcome {
  const keys = value && typeof value === "object" ? Object.keys(value).sort() : [];
  const outcome = (value as { outcome?: unknown } | null)?.outcome;
  if (keys.join(",") !== "outcome" || !PROVIDER_OUTCOMES.includes(outcome as ProviderOutcome)) {
    return "temporary_failure";
  }
  return outcome as ProviderOutcome;
}

function reportPrivateFailure(
  onPrivateError: (() => void) | undefined
): void {
  try {
    onPrivateError?.();
  } catch {
    // Observability must never alter delivery state or outward results.
  }
}

/**
 * Processes one provider-neutral outbox record.
 *
 * The injected compare-and-set must atomically match the complete expected
 * record. Sending starts only after that lease claim succeeds. The provider
 * must honor the supplied idempotency key so an uncertain completion write can
 * be retried without producing a second notification.
 *
 * This module adds no route, scheduler, persistence adapter or live provider.
 */
export async function processGuideDocumentNotificationOutboxRecord({
  record,
  now,
  compareAndSet,
  sendIdempotently,
  leaseSeconds = 60,
  retryDelaySeconds = 60,
  onPrivateError,
}: {
  record: GuideDocumentNotificationOutboxRecord;
  now: number;
  compareAndSet: CompareAndSet;
  sendIdempotently: (
    request: GuideDocumentNotificationProviderRequest
  ) => Promise<Readonly<{ outcome: ProviderOutcome }>>;
  leaseSeconds?: number;
  retryDelaySeconds?: number;
  onPrivateError?: () => void;
}): Promise<GuideDocumentNotificationWorkerResult> {
  requireTimestamp(now);
  requireBoundedSeconds(leaseSeconds, "leaseSeconds", 300);
  requireBoundedSeconds(retryDelaySeconds, "retryDelaySeconds", 3_600);
  const retryAt = now + retryDelaySeconds;
  requireTimestamp(retryAt);

  try {
    if (record.status === "delivering") {
      const recovered = recoverExpiredGuideDocumentNotificationLease({
        record,
        now,
        retryAt,
      });
      if (!recovered.applied) {
        return Object.freeze({ action: "none", reason: "not_available" });
      }
      const persisted = await compareAndSet(record, recovered.record);
      return Object.freeze({ action: "lease_recovered", persisted: persisted === true });
    }

    const started = beginGuideDocumentNotificationAttempt({ record, now, leaseSeconds });
    if (!started.applied) {
      return Object.freeze({ action: "none", reason: "not_available" });
    }

    const claimed = await compareAndSet(record, started.record);
    if (claimed !== true) {
      return Object.freeze({ action: "none", reason: "claim_conflict" });
    }

    let outcome: ProviderOutcome;
    try {
      outcome = normalizeProviderOutcome(
        await sendIdempotently(
          Object.freeze({
            idempotencyKey: started.record.idempotencyKey,
            payload: started.record.payload,
          })
        )
      );
    } catch {
      outcome = "temporary_failure";
      reportPrivateFailure(onPrivateError);
    }

    const completed = completeGuideDocumentNotificationAttempt({
      record: started.record,
      outcome,
      now,
      ...(outcome === "temporary_failure" &&
      started.record.attemptCount < GUIDE_DOCUMENT_NOTIFICATION_MAX_ATTEMPTS
        ? { retryAt }
        : {}),
    });
    const persisted = await compareAndSet(started.record, completed.record);
    return Object.freeze({
      action: "delivery_attempted",
      outcome,
      persisted: persisted === true,
    });
  } catch {
    reportPrivateFailure(onPrivateError);
    return Object.freeze({ action: "none", reason: "private_failure" });
  }
}
