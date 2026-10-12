import type { GuideDocumentNotificationAdapter } from "./guideDocumentReadyNotificationDispatch.ts";
import {
  deliverGuideDocumentReadyNotification,
} from "./guideDocumentReadyNotificationDelivery.ts";
import type { GuideDocumentNotificationOutboxRecord } from "./guideDocumentReadyNotificationOutbox.ts";
import {
  runGuideDocumentNotificationBatch,
  type GuideDocumentNotificationBatchResult,
} from "./guideDocumentReadyNotificationBatch.ts";

type CompareAndSet = (
  expected: GuideDocumentNotificationOutboxRecord,
  next: GuideDocumentNotificationOutboxRecord
) => Promise<boolean>;

export type GuideDocumentReadyNotificationCycleInput = Readonly<{
  now: number;
  loadCandidates: (input: Readonly<{ now: number; limit: number }>) => Promise<unknown>;
  compareAndSet: CompareAndSet;
  loadBinding: (idempotencyKey: string) => Promise<unknown>;
  loadDocument: (documentId: string) => Promise<unknown>;
  loadRecipient: (guideId: string) => Promise<unknown>;
  adapter: GuideDocumentNotificationAdapter;
  maximum?: number;
  leaseSeconds?: number;
  retryDelaySeconds?: number;
  onPrivateError?: () => void;
}>;

/**
 * Runs one bounded, serial notification cycle using only injected storage,
 * private readers and an idempotency-capable provider adapter.
 *
 * The batch worker claims each outbox record before this composition reads any
 * recipient data or calls the adapter. This module deliberately adds no route,
 * scheduler, live database client, provider implementation, secret, or timer.
 */
export function runGuideDocumentReadyNotificationCycle({
  now,
  loadCandidates,
  compareAndSet,
  loadBinding,
  loadDocument,
  loadRecipient,
  adapter,
  maximum = 10,
  leaseSeconds = 60,
  retryDelaySeconds = 60,
  onPrivateError,
}: GuideDocumentReadyNotificationCycleInput): Promise<GuideDocumentNotificationBatchResult> {
  return runGuideDocumentNotificationBatch({
    now,
    loadCandidates,
    compareAndSet,
    maximum,
    leaseSeconds,
    retryDelaySeconds,
    onPrivateError,
    sendIdempotently: (request) => deliverGuideDocumentReadyNotification({
      request,
      loadBinding,
      loadDocument,
      loadRecipient,
      adapter,
      onPrivateError,
    }),
  });
}
