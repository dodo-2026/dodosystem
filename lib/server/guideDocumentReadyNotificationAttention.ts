import type { GuideDocumentReadyNotificationCycleSummary } from "./guideDocumentReadyNotificationCycleSummary.ts";

const MAX_BATCH_SIZE = 25;

export type GuideDocumentReadyNotificationAttention = Readonly<{
  schemaVersion: 1;
  level: "none" | "review" | "action_required";
  reason:
    | "healthy"
    | "admission_delayed"
    | "retry_pending"
    | "lease_recovery"
    | "candidates_skipped"
    | "cycle_failed"
    | "release_uncertain"
    | "load_failed"
    | "persistence_uncertain"
    | "permanent_failures"
    | "private_failures"
    | "invalid_summary";
}>;

type Counts = GuideDocumentReadyNotificationCycleSummary["counts"];

function result(
  level: GuideDocumentReadyNotificationAttention["level"],
  reason: GuideDocumentReadyNotificationAttention["reason"]
): GuideDocumentReadyNotificationAttention {
  return Object.freeze({ schemaVersion: 1, level, reason });
}

function exactKeys(value: object, expected: string): boolean {
  return Object.keys(value).sort().join(",") === expected;
}

function boundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_BATCH_SIZE;
}

function normalizeCounts(value: unknown): Counts | null {
  if (!value || typeof value !== "object" || !exactKeys(
    value,
    "attempted,candidates,delivered,leasesRecovered,permanentFailures,persistenceUncertain,privateFailures,skipped,temporaryFailures"
  )) {
    return null;
  }
  const counts = value as Record<string, unknown>;
  const fields = [
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
  if (!fields.every((field) => boundedCount(counts[field]))) return null;
  return Object.freeze({
    candidates: counts.candidates as number,
    attempted: counts.attempted as number,
    delivered: counts.delivered as number,
    temporaryFailures: counts.temporaryFailures as number,
    permanentFailures: counts.permanentFailures as number,
    leasesRecovered: counts.leasesRecovered as number,
    skipped: counts.skipped as number,
    persistenceUncertain: counts.persistenceUncertain as number,
    privateFailures: counts.privateFailures as number,
  });
}

function allZero(counts: Counts): boolean {
  return Object.values(counts).every((value) => value === 0);
}

function isConsistent(
  summary: Record<string, unknown>,
  counts: Counts
): summary is Record<string, unknown> & GuideDocumentReadyNotificationCycleSummary {
  const admission = summary.admission;
  const release = summary.release;
  const batch = summary.batch;

  if (admission === "busy" || admission === "contended") {
    return release === "not_applicable" && batch === "not_run" && allZero(counts);
  }
  if (admission === "failed") {
    return (release === "confirmed" || release === "unknown") && batch === "not_run" && allZero(counts);
  }
  if (admission !== "executed" || (release !== "confirmed" && release !== "uncertain")) {
    return false;
  }
  if (batch === "load_failed") return allZero(counts);
  if (batch !== "processed") return false;

  return counts.attempted + counts.leasesRecovered + counts.skipped === counts.candidates &&
    counts.delivered + counts.temporaryFailures + counts.permanentFailures === counts.attempted &&
    counts.persistenceUncertain <= counts.attempted + counts.leasesRecovered &&
    counts.privateFailures <= counts.skipped;
}

/**
 * Reduces a sanitized cycle summary to one bounded operator-attention state.
 * No counters or internal identifiers are copied to the result. Malformed,
 * expanded, inconsistent, or hostile summaries fail closed.
 */
export function classifyGuideDocumentReadyNotificationAttention(
  input: GuideDocumentReadyNotificationCycleSummary
): GuideDocumentReadyNotificationAttention {
  try {
    if (!input || typeof input !== "object" || !exactKeys(
      input,
      "admission,batch,counts,release,schemaVersion"
    )) {
      return result("action_required", "invalid_summary");
    }
    const summary = input as unknown as Record<string, unknown>;
    if (summary.schemaVersion !== 1) return result("action_required", "invalid_summary");
    const counts = normalizeCounts(summary.counts);
    if (!counts || !isConsistent(summary, counts)) {
      return result("action_required", "invalid_summary");
    }

    if (summary.admission === "failed") return result("action_required", "cycle_failed");
    if (summary.admission === "busy" || summary.admission === "contended") {
      return result("review", "admission_delayed");
    }
    if (summary.release === "uncertain") return result("action_required", "release_uncertain");
    if (summary.batch === "load_failed") return result("action_required", "load_failed");
    if (counts.persistenceUncertain > 0) {
      return result("action_required", "persistence_uncertain");
    }
    if (counts.permanentFailures > 0) {
      return result("action_required", "permanent_failures");
    }
    if (counts.privateFailures > 0) return result("action_required", "private_failures");
    if (counts.temporaryFailures > 0) return result("review", "retry_pending");
    if (counts.leasesRecovered > 0) return result("review", "lease_recovery");
    if (counts.skipped > 0) return result("review", "candidates_skipped");
    return result("none", "healthy");
  } catch {
    return result("action_required", "invalid_summary");
  }
}
