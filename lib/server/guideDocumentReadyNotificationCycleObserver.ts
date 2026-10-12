import {
  runAdmittedGuideDocumentReadyNotificationCycle,
  type GuideDocumentReadyNotificationAdmissionInput,
} from "./guideDocumentReadyNotificationCycleAdmission.ts";
import {
  summarizeGuideDocumentReadyNotificationCycle,
  type GuideDocumentReadyNotificationCycleSummary,
} from "./guideDocumentReadyNotificationCycleSummary.ts";

export type GuideDocumentReadyNotificationCycleObserverInput =
  GuideDocumentReadyNotificationAdmissionInput &
  Readonly<{
    observeSummary: (
      summary: GuideDocumentReadyNotificationCycleSummary
    ) => void | Promise<void>;
  }>;

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
 * Runs one admitted cycle and gives an observer only its fixed operational
 * summary. Admission validation failures and observer failures are contained;
 * internal admission results, identifiers, payloads, and thrown details never
 * cross this boundary. No route, scheduler, persistence, or live monitor is
 * added here.
 */
export async function observeGuideDocumentReadyNotificationCycle(
  input: GuideDocumentReadyNotificationCycleObserverInput
): Promise<GuideDocumentReadyNotificationCycleSummary> {
  let summary: GuideDocumentReadyNotificationCycleSummary;
  try {
    const admissionResult = await runAdmittedGuideDocumentReadyNotificationCycle(input);
    summary = summarizeGuideDocumentReadyNotificationCycle(admissionResult);
  } catch {
    reportPrivateFailure(input);
    summary = summarizeGuideDocumentReadyNotificationCycle({
      status: "failed",
      releasePersisted: false,
    });
  }

  try {
    await input.observeSummary(summary);
  } catch {
    reportPrivateFailure(input);
  }
  return summary;
}
