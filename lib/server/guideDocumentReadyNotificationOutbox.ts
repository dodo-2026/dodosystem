import type {
  GuideDocumentReadyNotificationDecision,
  GuideDocumentReadyNotificationPayload,
} from "./guideDocumentReadyNotificationPolicy.ts";

export const GUIDE_DOCUMENT_NOTIFICATION_MAX_ATTEMPTS = 3;

const IDEMPOTENCY_KEY_PATTERN = /^guide-document-ready:[0-9a-f]{64}$/;
const STATUSES = [
  "pending",
  "delivering",
  "retryable_failed",
  "delivered",
  "terminal_failed",
] as const;
const OUTCOMES = ["delivered", "temporary_failure", "permanent_failure"] as const;

export type GuideDocumentNotificationOutboxStatus = (typeof STATUSES)[number];
export type GuideDocumentNotificationFailureCode =
  | "temporary"
  | "permanent"
  | "attempt_limit";

export type GuideDocumentNotificationOutboxRecord = Readonly<{
  idempotencyKey: string;
  payload: GuideDocumentReadyNotificationPayload;
  status: GuideDocumentNotificationOutboxStatus;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
  availableAt: number | null;
  leaseExpiresAt: number | null;
  deliveredAt: number | null;
  failureCode: GuideDocumentNotificationFailureCode | null;
}>;

type AllowedDecision = Extract<GuideDocumentReadyNotificationDecision, { allowed: true }>;

function requireTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer timestamp.`);
  }
}

function requireNullableTimestamp(value: number | null, field: string): void {
  if (value !== null) requireTimestamp(value, field);
}

function normalizePayload(input: GuideDocumentReadyNotificationPayload) {
  const keys = input && typeof input === "object" ? Object.keys(input).sort() : [];
  if (
    keys.join(",") !== "actionLabel,body,event,schemaVersion,title" ||
    input.schemaVersion !== 1 ||
    input.event !== "guide.document-ready" ||
    input.title !== "書類の準備ができました" ||
    input.body !== "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。" ||
    input.actionLabel !== "DODOで確認する"
  ) {
    throw new Error("Notification payload is outside the public allowlist.");
  }
  return Object.freeze({ ...input });
}

function normalizeRecord(
  input: GuideDocumentNotificationOutboxRecord
): GuideDocumentNotificationOutboxRecord {
  const keys = input && typeof input === "object" ? Object.keys(input).sort() : [];
  if (
    keys.join(",") !==
      "attemptCount,availableAt,createdAt,deliveredAt,failureCode,idempotencyKey,leaseExpiresAt,payload,status,updatedAt" ||
    !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) ||
    !STATUSES.includes(input.status) ||
    !Number.isSafeInteger(input.attemptCount) ||
    input.attemptCount < 0 ||
    input.attemptCount > GUIDE_DOCUMENT_NOTIFICATION_MAX_ATTEMPTS
  ) {
    throw new Error("Notification outbox record is malformed.");
  }

  requireTimestamp(input.createdAt, "createdAt");
  requireTimestamp(input.updatedAt, "updatedAt");
  requireNullableTimestamp(input.availableAt, "availableAt");
  requireNullableTimestamp(input.leaseExpiresAt, "leaseExpiresAt");
  requireNullableTimestamp(input.deliveredAt, "deliveredAt");
  if (input.updatedAt < input.createdAt) {
    throw new Error("updatedAt must not be earlier than createdAt.");
  }

  const pendingValid =
    input.status === "pending" &&
    input.attemptCount === 0 &&
    input.availableAt !== null &&
    input.availableAt >= input.updatedAt &&
    input.leaseExpiresAt === null &&
    input.deliveredAt === null &&
    input.failureCode === null;
  const deliveringValid =
    input.status === "delivering" &&
    input.attemptCount >= 1 &&
    input.availableAt === null &&
    input.leaseExpiresAt !== null &&
    input.leaseExpiresAt > input.updatedAt &&
    input.deliveredAt === null &&
    input.failureCode === null;
  const retryableValid =
    input.status === "retryable_failed" &&
    input.attemptCount >= 1 &&
    input.attemptCount < GUIDE_DOCUMENT_NOTIFICATION_MAX_ATTEMPTS &&
    input.availableAt !== null &&
    input.availableAt > input.updatedAt &&
    input.leaseExpiresAt === null &&
    input.deliveredAt === null &&
    input.failureCode === "temporary";
  const deliveredValid =
    input.status === "delivered" &&
    input.attemptCount >= 1 &&
    input.availableAt === null &&
    input.leaseExpiresAt === null &&
    input.deliveredAt !== null &&
    input.deliveredAt === input.updatedAt &&
    input.failureCode === null;
  const terminalValid =
    input.status === "terminal_failed" &&
    input.attemptCount >= 1 &&
    input.availableAt === null &&
    input.leaseExpiresAt === null &&
    input.deliveredAt === null &&
    (input.failureCode === "permanent" || input.failureCode === "attempt_limit");

  if (!(pendingValid || deliveringValid || retryableValid || deliveredValid || terminalValid)) {
    throw new Error("Notification outbox state is inconsistent.");
  }

  return Object.freeze({ ...input, payload: normalizePayload(input.payload) });
}

function unchanged(record: GuideDocumentNotificationOutboxRecord) {
  return Object.freeze({ applied: false as const, record: normalizeRecord(record) });
}

export function createGuideDocumentNotificationOutboxRecord(
  decision: AllowedDecision,
  now: number
): GuideDocumentNotificationOutboxRecord {
  requireTimestamp(now, "now");
  if (
    !decision ||
    decision.allowed !== true ||
    !IDEMPOTENCY_KEY_PATTERN.test(decision.idempotencyKey)
  ) {
    throw new Error("An allowed notification decision is required.");
  }
  return normalizeRecord({
    idempotencyKey: decision.idempotencyKey,
    payload: normalizePayload(decision.payload),
    status: "pending",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
    availableAt: now,
    leaseExpiresAt: null,
    deliveredAt: null,
    failureCode: null,
  });
}

export function beginGuideDocumentNotificationAttempt({
  record,
  now,
  leaseSeconds = 60,
}: {
  record: GuideDocumentNotificationOutboxRecord;
  now: number;
  leaseSeconds?: number;
}) {
  const current = normalizeRecord(record);
  requireTimestamp(now, "now");
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) {
    throw new Error("leaseSeconds must be an integer from 1 to 300.");
  }
  if (now < current.updatedAt) throw new Error("now must not move backwards.");
  if (
    (current.status !== "pending" && current.status !== "retryable_failed") ||
    current.availableAt === null ||
    now < current.availableAt
  ) {
    return unchanged(current);
  }

  return Object.freeze({
    applied: true as const,
    record: normalizeRecord({
      ...current,
      status: "delivering",
      attemptCount: current.attemptCount + 1,
      updatedAt: now,
      availableAt: null,
      leaseExpiresAt: now + leaseSeconds,
      failureCode: null,
    }),
  });
}

export function completeGuideDocumentNotificationAttempt({
  record,
  outcome,
  now,
  retryAt,
}: {
  record: GuideDocumentNotificationOutboxRecord;
  outcome: "delivered" | "temporary_failure" | "permanent_failure";
  now: number;
  retryAt?: number;
}) {
  const current = normalizeRecord(record);
  requireTimestamp(now, "now");
  if (!OUTCOMES.includes(outcome)) throw new Error("outcome is unsupported.");
  if (now < current.updatedAt) throw new Error("now must not move backwards.");
  if (current.status !== "delivering") return unchanged(current);

  if (outcome === "delivered") {
    return Object.freeze({
      applied: true as const,
      record: normalizeRecord({
        ...current,
        status: "delivered",
        updatedAt: now,
        leaseExpiresAt: null,
        deliveredAt: now,
      }),
    });
  }

  if (
    outcome === "permanent_failure" ||
    current.attemptCount >= GUIDE_DOCUMENT_NOTIFICATION_MAX_ATTEMPTS
  ) {
    return Object.freeze({
      applied: true as const,
      record: normalizeRecord({
        ...current,
        status: "terminal_failed",
        updatedAt: now,
        leaseExpiresAt: null,
        failureCode:
          outcome === "permanent_failure" ? "permanent" : "attempt_limit",
      }),
    });
  }

  if (retryAt === undefined) throw new Error("retryAt is required for a temporary failure.");
  requireTimestamp(retryAt, "retryAt");
  if (retryAt <= now) throw new Error("retryAt must be later than now.");
  return Object.freeze({
    applied: true as const,
    record: normalizeRecord({
      ...current,
      status: "retryable_failed",
      updatedAt: now,
      availableAt: retryAt,
      leaseExpiresAt: null,
      failureCode: "temporary",
    }),
  });
}

export function recoverExpiredGuideDocumentNotificationLease({
  record,
  now,
  retryAt,
}: {
  record: GuideDocumentNotificationOutboxRecord;
  now: number;
  retryAt: number;
}) {
  const current = normalizeRecord(record);
  requireTimestamp(now, "now");
  requireTimestamp(retryAt, "retryAt");
  if (
    current.status !== "delivering" ||
    current.leaseExpiresAt === null ||
    now < current.leaseExpiresAt
  ) {
    return unchanged(current);
  }
  if (current.attemptCount >= GUIDE_DOCUMENT_NOTIFICATION_MAX_ATTEMPTS) {
    return completeGuideDocumentNotificationAttempt({
      record: current,
      outcome: "temporary_failure",
      now,
    });
  }
  return completeGuideDocumentNotificationAttempt({
    record: current,
    outcome: "temporary_failure",
    now,
    retryAt,
  });
}
