import { normalizeJapaneseMobilePhone } from "../dodo/guidePortal.ts";

export const GUIDE_PHONE_RESEND_COOLDOWN_SECONDS = 60;
export const GUIDE_PHONE_ISSUE_WINDOW_SECONDS = 60 * 60;
export const GUIDE_PHONE_MAX_ISSUES_PER_WINDOW = 5;

export type GuidePhoneIssuanceDecision =
  | {
      allowed: true;
      phoneE164: string;
    }
  | {
      allowed: false;
      reason: "invalid_phone" | "cooldown" | "rate_limited";
      retryAt: number | null;
    };

function requireSafeTimestamp(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer timestamp.`);
  }
}

/**
 * Makes a local-only issuance decision for one normalized phone number. The
 * caller must supply issuance timestamps for that same number from a trusted
 * server-side store. A live implementation must record the accepted issuance
 * atomically before sending an SMS so concurrent requests cannot bypass it.
 */
export function decideGuidePhoneCodeIssuance({
  phone,
  issuedAt,
  now = Math.floor(Date.now() / 1000),
}: {
  phone: string;
  issuedAt: readonly number[];
  now?: number;
}): GuidePhoneIssuanceDecision {
  requireSafeTimestamp(now, "now");
  if (!Array.isArray(issuedAt)) {
    throw new Error("issuedAt must be an array of timestamps.");
  }

  const normalizedPhone =
    typeof phone === "string" ? normalizeJapaneseMobilePhone(phone) : null;
  if (!normalizedPhone) {
    return { allowed: false, reason: "invalid_phone", retryAt: null };
  }

  let latestIssue: number | null = null;
  const activeWindow: number[] = [];
  const windowStart = now - GUIDE_PHONE_ISSUE_WINDOW_SECONDS;

  issuedAt.forEach((timestamp, index) => {
    requireSafeTimestamp(timestamp, `issuedAt[${index}]`);
    if (timestamp > now) {
      throw new Error("issuedAt must not contain a future timestamp.");
    }
    if (latestIssue === null || timestamp > latestIssue) {
      latestIssue = timestamp;
    }
    if (timestamp > windowStart) {
      activeWindow.push(timestamp);
    }
  });

  if (
    latestIssue !== null &&
    now < latestIssue + GUIDE_PHONE_RESEND_COOLDOWN_SECONDS
  ) {
    return {
      allowed: false,
      reason: "cooldown",
      retryAt: latestIssue + GUIDE_PHONE_RESEND_COOLDOWN_SECONDS,
    };
  }

  if (activeWindow.length >= GUIDE_PHONE_MAX_ISSUES_PER_WINDOW) {
    const oldestActiveIssue = Math.min(...activeWindow);
    return {
      allowed: false,
      reason: "rate_limited",
      retryAt: oldestActiveIssue + GUIDE_PHONE_ISSUE_WINDOW_SECONDS,
    };
  }

  return { allowed: true, phoneE164: normalizedPhone };
}
