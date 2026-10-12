import {
  runGuideDocumentReadyNotificationCycle,
  type GuideDocumentReadyNotificationCycleInput,
} from "./guideDocumentReadyNotificationCycle.ts";
import type { GuideDocumentNotificationBatchResult } from "./guideDocumentReadyNotificationBatch.ts";

const LEASE_KEY = "guide-document-ready-cycle-v1";
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_LEASE_SECONDS = 900;

export type GuideDocumentReadyNotificationCycleLease = Readonly<{
  key: typeof LEASE_KEY;
  status: "idle" | "running";
  ownerRunId: string | null;
  updatedAt: number;
  leaseExpiresAt: number | null;
}>;

export type GuideDocumentReadyNotificationAdmissionResult = Readonly<
  | {
      status: "executed";
      batch: GuideDocumentNotificationBatchResult;
      releasePersisted: boolean;
    }
  | { status: "skipped"; reason: "busy" | "claim_conflict" }
  | { status: "failed"; releasePersisted: boolean }
>;

type CompareAndSetLease = (
  expected: GuideDocumentReadyNotificationCycleLease | null,
  next: GuideDocumentReadyNotificationCycleLease
) => Promise<boolean>;

export type GuideDocumentReadyNotificationAdmissionInput = Readonly<{
  runId: string;
  cycle: GuideDocumentReadyNotificationCycleInput;
  loadLease: () => Promise<unknown>;
  compareAndSetLease: CompareAndSetLease;
  admissionLeaseSeconds?: number;
  onPrivateError?: () => void;
}>;

function requireTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("now must be a non-negative safe integer timestamp.");
  }
}

function requireRunId(value: string): void {
  if (typeof value !== "string" || !RUN_ID_PATTERN.test(value)) {
    throw new Error("runId is malformed.");
  }
}

function requireLeaseSeconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LEASE_SECONDS) {
    throw new Error(`admissionLeaseSeconds must be an integer from 1 to ${MAX_LEASE_SECONDS}.`);
  }
}

function normalizeLease(value: unknown): GuideDocumentReadyNotificationCycleLease {
  if (!value || typeof value !== "object") throw new Error("Cycle lease is malformed.");
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "key,leaseExpiresAt,ownerRunId,status,updatedAt") {
    throw new Error("Cycle lease is malformed.");
  }
  const lease = value as Record<string, unknown>;
  if (lease.key !== LEASE_KEY || (lease.status !== "idle" && lease.status !== "running")) {
    throw new Error("Cycle lease is malformed.");
  }
  requireTimestamp(lease.updatedAt as number);

  const idleValid =
    lease.status === "idle" && lease.ownerRunId === null && lease.leaseExpiresAt === null;
  const runningValid =
    lease.status === "running" &&
    typeof lease.ownerRunId === "string" &&
    RUN_ID_PATTERN.test(lease.ownerRunId) &&
    Number.isSafeInteger(lease.leaseExpiresAt) &&
    (lease.leaseExpiresAt as number) > (lease.updatedAt as number) &&
    (lease.leaseExpiresAt as number) - (lease.updatedAt as number) <= MAX_LEASE_SECONDS;
  if (!idleValid && !runningValid) throw new Error("Cycle lease is inconsistent.");

  return Object.freeze({
    key: LEASE_KEY,
    status: lease.status,
    ownerRunId: lease.ownerRunId as string | null,
    updatedAt: lease.updatedAt as number,
    leaseExpiresAt: lease.leaseExpiresAt as number | null,
  });
}

function reportPrivateFailure(onPrivateError: (() => void) | undefined): void {
  try {
    onPrivateError?.();
  } catch {
    // Observability must not alter admission or release behavior.
  }
}

async function releaseLease({
  claimed,
  compareAndSetLease,
  onPrivateError,
}: {
  claimed: GuideDocumentReadyNotificationCycleLease;
  compareAndSetLease: CompareAndSetLease;
  onPrivateError?: () => void;
}): Promise<boolean> {
  const idle = Object.freeze({
    key: LEASE_KEY,
    status: "idle" as const,
    ownerRunId: null,
    updatedAt: claimed.updatedAt,
    leaseExpiresAt: null,
  });
  try {
    return await compareAndSetLease(claimed, idle) === true;
  } catch {
    reportPrivateFailure(onPrivateError);
    return false;
  }
}

/**
 * Admits at most one notification cycle for a bounded lease window.
 *
 * The caller supplies persistence and a unique run identifier. An active lease
 * stops before candidate or private-data reads. Expired leases can be replaced
 * atomically, and a stale runner can release only the exact lease it claimed.
 * Outbox-level leases remain the final duplicate-send guard during recovery.
 * No scheduler, timer, live store, route, or provider is added here.
 */
export async function runAdmittedGuideDocumentReadyNotificationCycle({
  runId,
  cycle,
  loadLease,
  compareAndSetLease,
  admissionLeaseSeconds = 300,
  onPrivateError,
}: GuideDocumentReadyNotificationAdmissionInput): Promise<GuideDocumentReadyNotificationAdmissionResult> {
  requireRunId(runId);
  requireTimestamp(cycle.now);
  requireLeaseSeconds(admissionLeaseSeconds);
  const leaseExpiresAt = cycle.now + admissionLeaseSeconds;
  requireTimestamp(leaseExpiresAt);

  let current: GuideDocumentReadyNotificationCycleLease | null;
  let expected: GuideDocumentReadyNotificationCycleLease | null;
  try {
    const loaded = await loadLease();
    if (loaded === null) {
      current = null;
      expected = null;
    } else {
      current = normalizeLease(loaded);
      expected = loaded as GuideDocumentReadyNotificationCycleLease;
    }
  } catch {
    reportPrivateFailure(onPrivateError);
    return Object.freeze({ status: "failed", releasePersisted: false });
  }

  if (
    current?.status === "running" &&
    current.leaseExpiresAt !== null &&
    cycle.now < current.leaseExpiresAt
  ) {
    return Object.freeze({ status: "skipped", reason: "busy" });
  }

  const claimed = Object.freeze({
    key: LEASE_KEY,
    status: "running" as const,
    ownerRunId: runId,
    updatedAt: cycle.now,
    leaseExpiresAt,
  });

  try {
    if (await compareAndSetLease(expected, claimed) !== true) {
      return Object.freeze({ status: "skipped", reason: "claim_conflict" });
    }
  } catch {
    reportPrivateFailure(onPrivateError);
    return Object.freeze({ status: "failed", releasePersisted: false });
  }

  let batch: GuideDocumentNotificationBatchResult;
  try {
    batch = await runGuideDocumentReadyNotificationCycle(cycle);
  } catch {
    reportPrivateFailure(onPrivateError);
    const releasePersisted = await releaseLease({
      claimed,
      compareAndSetLease,
      onPrivateError,
    });
    return Object.freeze({ status: "failed", releasePersisted });
  }

  const releasePersisted = await releaseLease({
    claimed,
    compareAndSetLease,
    onPrivateError,
  });
  return Object.freeze({ status: "executed", batch, releasePersisted });
}
