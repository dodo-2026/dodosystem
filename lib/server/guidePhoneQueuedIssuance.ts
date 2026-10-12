import { issueGuidePhoneCode } from "./guidePhoneIssuance.ts";
import {
  handleGuidePhoneIssuanceRequest,
  parseGuidePhoneIssuancePayload,
} from "./guidePhoneIssuanceHttp.ts";

const MAX_QUEUE_AGE_SECONDS = 120;
const RECEIPT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type GuidePhoneIssuanceJob = Readonly<{
  challengeId: string;
  phone: string;
  enqueuedAt: number;
}>;

export type AdmitGuidePhoneIssuance = (input: Readonly<{
  sourceKey: string;
  acceptedAt: number;
}>) => Promise<boolean>;

type IssuanceDependencies = Pick<Parameters<typeof issueGuidePhoneCode>[0],
  "loadContext" | "persistChallenge" | "sendCode">;

/**
 * Future public intake: wait only for durable enqueue, never for guide lookup
 * or SMS. The queue adapter MUST NOT execute the worker inline or branch on
 * account existence. Apply source/global abuse limits before this boundary.
 * No live queue, route or provider is configured by this module.
 */
export function handleQueuedGuidePhoneIssuanceRequest({
  body,
  sourceKey,
  admit,
  enqueue,
  now = Math.floor(Date.now() / 1000),
  onInternalFailure,
}: {
  body: unknown;
  /** Trusted edge-derived opaque ID. Never obtain this from request JSON. */
  sourceKey: string;
  /** Atomically checks and records source/global admission before enqueue. */
  admit: AdmitGuidePhoneIssuance;
  enqueue: (job: GuidePhoneIssuanceJob) => Promise<void>;
  now?: number;
  onInternalFailure?: (event: "guide_phone_issuance_failed") => void;
}) {
  return handleGuidePhoneIssuanceRequest({
    body,
    onInternalFailure,
    issue: async (phone) => {
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid queue time.");
      const admitted = await admit(Object.freeze({ sourceKey, acceptedAt: now }));
      if (typeof admitted !== "boolean") throw new Error("admit must resolve to a boolean.");
      if (!admitted) return { issued: false, reason: "rate_limited", retryAt: null };
      const challengeId = crypto.randomUUID();
      await enqueue(Object.freeze({ challengeId, phone, enqueuedAt: now }));
      // The HTTP adapter uses only the handle. This is an acknowledgement of
      // enqueue, not evidence of issuance; actual expiry starts in the worker.
      return { issued: true, challengeId, expiresAt: now + MAX_QUEUE_AGE_SECONDS };
    },
  });
}

/**
 * Trusted queue consumer only. Persistence MUST atomically enforce unique
 * challenge IDs and phone throttles so concurrent/retried jobs cannot send
 * twice. A send failure does not undo persistence: retry must not issue again.
 * Delete/expire queued phone data promptly; never log the job or plaintext OTP.
 */
export async function processQueuedGuidePhoneIssuance({
  job,
  now = Math.floor(Date.now() / 1000),
  ...dependencies
}: IssuanceDependencies & { job: GuidePhoneIssuanceJob; now?: number }) {
  if (
    !job || !RECEIPT_PATTERN.test(job.challengeId) ||
    !parseGuidePhoneIssuancePayload({ phone: job.phone }) ||
    !Number.isSafeInteger(job.enqueuedAt) || job.enqueuedAt < 0 ||
    !Number.isSafeInteger(now) || now < job.enqueuedAt
  ) throw new Error("Invalid queued issuance job.");

  if (now - job.enqueuedAt >= MAX_QUEUE_AGE_SECONDS) {
    return { issued: false as const, reason: "queue_expired" as const };
  }

  return issueGuidePhoneCode({
    ...dependencies,
    phone: job.phone,
    challengeId: job.challengeId,
    now,
  });
}
