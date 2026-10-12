import {
  classifyGuideDocumentReadyNotificationAttention,
  type GuideDocumentReadyNotificationAttention,
} from "./guideDocumentReadyNotificationAttention.ts";
import type { GuideDocumentReadyNotificationCycleSummary } from "./guideDocumentReadyNotificationCycleSummary.ts";

export type GuideDocumentReadyNotificationAttentionObserverInput = Readonly<{
  summary: GuideDocumentReadyNotificationCycleSummary;
  observeAttention: (
    attention: GuideDocumentReadyNotificationAttention
  ) => void | Promise<void>;
  onPrivateError?: () => void;
}>;

function invalidAttention(): GuideDocumentReadyNotificationAttention {
  return classifyGuideDocumentReadyNotificationAttention(null as never);
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
 * Gives an operator observer only the fixed attention classification for one
 * sanitized cycle summary. Summary counters and internal processing details do
 * not cross the callback boundary. Malformed input and observer failures are
 * contained; no route, scheduler, persistence, or external alert is added.
 */
export async function observeGuideDocumentReadyNotificationAttention(
  input: GuideDocumentReadyNotificationAttentionObserverInput
): Promise<GuideDocumentReadyNotificationAttention> {
  let attention: GuideDocumentReadyNotificationAttention;
  try {
    attention = classifyGuideDocumentReadyNotificationAttention(input.summary);
  } catch {
    reportPrivateFailure(input);
    attention = invalidAttention();
  }

  try {
    await input.observeAttention(attention);
  } catch {
    reportPrivateFailure(input);
  }
  return attention;
}
