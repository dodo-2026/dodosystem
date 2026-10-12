import {
  dispatchGuideDocumentReadyNotification,
  normalizeGuideDocumentNotificationProviderRequest,
  type GuideDocumentNotificationAdapter,
} from "./guideDocumentReadyNotificationDispatch.ts";
import { resolveGuideDocumentNotificationRecipient } from "./guideDocumentNotificationRecipientResolver.ts";
import type { GuideDocumentNotificationProviderRequest } from "./guideDocumentReadyNotificationWorker.ts";

type ProviderOutcome = "delivered" | "temporary_failure" | "permanent_failure";

function reportPrivateFailure(onPrivateError: (() => void) | undefined): void {
  try {
    onPrivateError?.();
  } catch {
    // Observability must not change the fixed outward result.
  }
}

/**
 * Composes strict worker-request validation, private recipient resolution and
 * an idempotency-capable provider adapter into one worker delivery callback.
 *
 * Invalid public input is rejected before private reads. Unresolved private
 * data is retryable and never reaches the adapter. All readers and the adapter
 * remain injected; this module adds no route, database, secret, or live send.
 */
export async function deliverGuideDocumentReadyNotification({
  request,
  loadBinding,
  loadDocument,
  loadRecipient,
  adapter,
  onPrivateError,
}: {
  request: GuideDocumentNotificationProviderRequest;
  loadBinding: (idempotencyKey: string) => Promise<unknown>;
  loadDocument: (documentId: string) => Promise<unknown>;
  loadRecipient: (guideId: string) => Promise<unknown>;
  adapter: GuideDocumentNotificationAdapter;
  onPrivateError?: () => void;
}): Promise<Readonly<{ outcome: ProviderOutcome }>> {
  let normalizedRequest: GuideDocumentNotificationProviderRequest;
  try {
    normalizedRequest = normalizeGuideDocumentNotificationProviderRequest(request);
  } catch {
    reportPrivateFailure(onPrivateError);
    return Object.freeze({ outcome: "permanent_failure" });
  }

  const resolution = await resolveGuideDocumentNotificationRecipient({
    idempotencyKey: normalizedRequest.idempotencyKey,
    loadBinding,
    loadDocument,
    loadRecipient,
    onPrivateError,
  });
  if (!resolution.resolved) {
    return Object.freeze({ outcome: "temporary_failure" });
  }

  return dispatchGuideDocumentReadyNotification({
    recipient: resolution.recipient,
    request: normalizedRequest,
    adapter,
    onPrivateError,
  });
}
