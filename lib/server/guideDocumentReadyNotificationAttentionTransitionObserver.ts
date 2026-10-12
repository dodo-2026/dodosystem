import type { GuideDocumentReadyNotificationAttention } from "./guideDocumentReadyNotificationAttention.ts";
import {
  classifyGuideDocumentReadyNotificationAttentionTransition,
  type GuideDocumentReadyNotificationAttentionTransition,
} from "./guideDocumentReadyNotificationAttentionTransition.ts";

export type GuideDocumentReadyNotificationAttentionTransitionObserverInput = Readonly<{
  previous: GuideDocumentReadyNotificationAttention | null;
  current: GuideDocumentReadyNotificationAttention;
  observeTransition: (
    transition: GuideDocumentReadyNotificationAttentionTransition
  ) => void | Promise<void>;
  onPrivateError?: () => void;
}>;

function invalidTransition(): GuideDocumentReadyNotificationAttentionTransition {
  return classifyGuideDocumentReadyNotificationAttentionTransition(null, null as never);
}

function reportPrivateFailure(input: unknown): void {
  try {
    if (!input || typeof input !== "object") return;
    const onPrivateError = (input as { onPrivateError?: unknown }).onPrivateError;
    if (typeof onPrivateError === "function") onPrivateError();
  } catch {
    // Observability failures must not alter the fixed public result.
  }
}

/**
 * Observes only meaningful attention transitions. Initially healthy and
 * unchanged states are returned as suppressed without reading or invoking the
 * callback. Opening, changes, escalation, de-escalation, recovery, and fixed
 * fail-closed results cross the callback boundary. Callback failures are
 * contained; no persistence, route, live monitor, or external alert is added.
 */
export async function observeGuideDocumentReadyNotificationAttentionTransition(
  input: GuideDocumentReadyNotificationAttentionTransitionObserverInput
): Promise<GuideDocumentReadyNotificationAttentionTransition> {
  let transition: GuideDocumentReadyNotificationAttentionTransition;
  try {
    transition = classifyGuideDocumentReadyNotificationAttentionTransition(
      input.previous,
      input.current
    );
  } catch {
    reportPrivateFailure(input);
    transition = invalidTransition();
  }

  if (transition.signal === "suppressed") return transition;

  try {
    await input.observeTransition(transition);
  } catch {
    reportPrivateFailure(input);
  }
  return transition;
}
