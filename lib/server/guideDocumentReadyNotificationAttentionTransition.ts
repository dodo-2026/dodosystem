import type { GuideDocumentReadyNotificationAttention } from "./guideDocumentReadyNotificationAttention.ts";

export type GuideDocumentReadyNotificationAttentionTransition = Readonly<{
  schemaVersion: 1;
  signal:
    | "suppressed"
    | "opened"
    | "changed"
    | "escalated"
    | "deescalated"
    | "recovered";
  attention: GuideDocumentReadyNotificationAttention;
}>;

const REASON_LEVEL = Object.freeze({
  healthy: "none",
  admission_delayed: "review",
  retry_pending: "review",
  lease_recovery: "review",
  candidates_skipped: "review",
  cycle_failed: "action_required",
  release_uncertain: "action_required",
  load_failed: "action_required",
  persistence_uncertain: "action_required",
  permanent_failures: "action_required",
  private_failures: "action_required",
  invalid_summary: "action_required",
} as const);

function invalidAttention(): GuideDocumentReadyNotificationAttention {
  return Object.freeze({
    schemaVersion: 1,
    level: "action_required",
    reason: "invalid_summary",
  });
}

function normalizeAttention(value: unknown): GuideDocumentReadyNotificationAttention | null {
  if (!value || typeof value !== "object") return null;
  if (Object.keys(value).sort().join(",") !== "level,reason,schemaVersion") return null;
  const attention = value as Record<string, unknown>;
  if (attention.schemaVersion !== 1 || typeof attention.reason !== "string") return null;
  const expectedLevel = REASON_LEVEL[attention.reason as keyof typeof REASON_LEVEL];
  if (!expectedLevel || attention.level !== expectedLevel) return null;
  return Object.freeze({
    schemaVersion: 1,
    level: expectedLevel,
    reason: attention.reason as GuideDocumentReadyNotificationAttention["reason"],
  });
}

function transition(
  signal: GuideDocumentReadyNotificationAttentionTransition["signal"],
  attention: GuideDocumentReadyNotificationAttention
): GuideDocumentReadyNotificationAttentionTransition {
  return Object.freeze({ schemaVersion: 1, signal, attention });
}

/**
 * Reduces two fixed attention snapshots to one bounded transition signal.
 * Identical and initially healthy states are suppressed. Opening, escalation,
 * de-escalation, reason changes, and recovery remain explicit. Malformed,
 * expanded, inconsistent, or hostile snapshots fail closed as a generic
 * action-required signal. No persistence, callback, route, or alert is added.
 */
export function classifyGuideDocumentReadyNotificationAttentionTransition(
  previous: GuideDocumentReadyNotificationAttention | null,
  current: GuideDocumentReadyNotificationAttention
): GuideDocumentReadyNotificationAttentionTransition {
  try {
    const normalizedCurrent = normalizeAttention(current);
    const normalizedPrevious = previous === null ? null : normalizeAttention(previous);
    if (!normalizedCurrent || (previous !== null && !normalizedPrevious)) {
      return transition("opened", invalidAttention());
    }
    if (!normalizedPrevious) {
      return transition(
        normalizedCurrent.level === "none" ? "suppressed" : "opened",
        normalizedCurrent
      );
    }
    if (
      normalizedPrevious.level === normalizedCurrent.level &&
      normalizedPrevious.reason === normalizedCurrent.reason
    ) {
      return transition("suppressed", normalizedCurrent);
    }
    if (normalizedCurrent.level === "none") {
      return transition("recovered", normalizedCurrent);
    }
    if (normalizedPrevious.level === "none") {
      return transition("opened", normalizedCurrent);
    }
    if (
      normalizedPrevious.level === "review" &&
      normalizedCurrent.level === "action_required"
    ) {
      return transition("escalated", normalizedCurrent);
    }
    if (
      normalizedPrevious.level === "action_required" &&
      normalizedCurrent.level === "review"
    ) {
      return transition("deescalated", normalizedCurrent);
    }
    return transition("changed", normalizedCurrent);
  } catch {
    return transition("opened", invalidAttention());
  }
}
