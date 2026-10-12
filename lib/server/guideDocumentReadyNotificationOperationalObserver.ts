import type { GuideDocumentReadyNotificationAdmissionInput } from "./guideDocumentReadyNotificationCycleAdmission.ts";
import {
  observeGuideDocumentReadyNotificationCycle,
  type GuideDocumentReadyNotificationCycleObserverInput,
} from "./guideDocumentReadyNotificationCycleObserver.ts";
import type { GuideDocumentReadyNotificationAttention } from "./guideDocumentReadyNotificationAttention.ts";
import {
  observeGuideDocumentReadyNotificationAttention,
  type GuideDocumentReadyNotificationAttentionObserverInput,
} from "./guideDocumentReadyNotificationAttentionObserver.ts";
import type { GuideDocumentReadyNotificationCycleSummary } from "./guideDocumentReadyNotificationCycleSummary.ts";

export type GuideDocumentReadyNotificationOperationalObserverInput =
  GuideDocumentReadyNotificationAdmissionInput &
  Readonly<{
    observeAttention: (
      attention: GuideDocumentReadyNotificationAttention
    ) => void | Promise<void>;
  }>;

function cycleInput(
  input: GuideDocumentReadyNotificationOperationalObserverInput
): GuideDocumentReadyNotificationCycleObserverInput {
  const forwarded = Object.create(null) as Record<string, unknown>;
  for (const key of [
    "runId",
    "cycle",
    "loadLease",
    "compareAndSetLease",
    "admissionLeaseSeconds",
    "onPrivateError",
  ] as const) {
    Object.defineProperty(forwarded, key, {
      enumerable: true,
      get: () => input[key],
    });
  }
  Object.defineProperty(forwarded, "observeSummary", {
    enumerable: true,
    value: () => {},
  });
  return Object.freeze(forwarded) as GuideDocumentReadyNotificationCycleObserverInput;
}

function attentionInput(
  input: GuideDocumentReadyNotificationOperationalObserverInput,
  summary: GuideDocumentReadyNotificationCycleSummary
): GuideDocumentReadyNotificationAttentionObserverInput {
  const forwarded = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(forwarded, {
    summary: { enumerable: true, value: summary },
    observeAttention: {
      enumerable: true,
      get: () => input.observeAttention,
    },
    onPrivateError: {
      enumerable: true,
      get: () => input.onPrivateError,
    },
  });
  return Object.freeze(forwarded) as GuideDocumentReadyNotificationAttentionObserverInput;
}

/**
 * Runs one admitted notification cycle and exposes only its fixed attention
 * classification to the caller's observer. The counter-bearing cycle summary
 * remains inside this composition boundary. Existing cycle and attention
 * observers contain malformed input, hostile accessors, and callback failures.
 * No route, scheduler, live monitor, persistence, or external alert is added.
 */
export async function observeGuideDocumentReadyNotificationOperationalState(
  input: GuideDocumentReadyNotificationOperationalObserverInput
): Promise<GuideDocumentReadyNotificationAttention> {
  const summary = await observeGuideDocumentReadyNotificationCycle(cycleInput(input));
  return observeGuideDocumentReadyNotificationAttention(attentionInput(input, summary));
}
