import type { GuidePhoneIssuanceResult } from "./guidePhoneIssuance.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_INPUT_PATTERN = /^[0-9+() -]+$/;
const MAX_PHONE_INPUT_LENGTH = 32;
const DENIAL_REASONS = new Set([
  "invalid_phone",
  "guide_not_available",
  "cooldown",
  "rate_limited",
  "state_conflict",
]);

const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

export type GuidePhoneIssuancePayload = {
  phone: string;
};

export type IssueGuidePhoneCode = (
  phone: string
) => Promise<GuidePhoneIssuanceResult>;

export type GuidePhoneIssuanceHttpResult =
  | {
      status: 400;
      headers: typeof RESPONSE_HEADERS;
      body: { ok: false; error: "invalid_request" };
    }
  | {
      status: 202;
      headers: typeof RESPONSE_HEADERS;
      body: { ok: true; challengeId: string };
    };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseGuidePhoneIssuancePayload(
  value: unknown
): GuidePhoneIssuancePayload | null {
  if (!isPlainRecord(value)) return null;

  const keys = Object.keys(value);
  if (
    keys.length !== 1 ||
    keys[0] !== "phone" ||
    typeof value.phone !== "string" ||
    value.phone.length === 0 ||
    value.phone.length > MAX_PHONE_INPUT_LENGTH ||
    !PHONE_INPUT_PATTERN.test(value.phone)
  ) {
    return null;
  }

  return { phone: value.phone };
}

function invalidRequest(): GuidePhoneIssuanceHttpResult {
  return {
    status: 400,
    headers: RESPONSE_HEADERS,
    body: { ok: false, error: "invalid_request" },
  };
}

function acceptedRequest(challengeId: string): GuidePhoneIssuanceHttpResult {
  return {
    status: 202,
    headers: RESPONSE_HEADERS,
    body: { ok: true, challengeId },
  };
}

/**
 * Route-independent boundary for the future request-code endpoint. The JSON
 * envelope is bounded before orchestration. Every well-formed request gets
 * the same outward shape, including denied requests and internal failures.
 * `ok` acknowledges receipt only; it does not assert delivery or registration.
 *
 * Denials use an unpersisted random UUID which grants no authentication.
 * The verification boundary rejects it as a missing record. Live integration
 * must still address timing differences (including provider latency) before
 * claiming resistance to account enumeration. No live route exists yet.
 */
export async function handleGuidePhoneIssuanceRequest({
  body,
  issue,
  onInternalFailure,
}: {
  body: unknown;
  issue: IssueGuidePhoneCode;
  onInternalFailure?: (event: "guide_phone_issuance_failed") => void;
}): Promise<GuidePhoneIssuanceHttpResult> {
  const payload = parseGuidePhoneIssuancePayload(body);
  if (!payload) return invalidRequest();

  // Allocate for every request, not only denials. Never persist or send this
  // fallback handle, and never reuse a previous valid challenge for a denial.
  const fallbackId = crypto.randomUUID();
  try {
    const result = await issue(payload.phone);
    if (
      !result ||
      typeof result !== "object" ||
      typeof result.issued !== "boolean"
    ) {
      throw new Error("Invalid issuance result.");
    }

    if (!result.issued) {
      if (!DENIAL_REASONS.has(result.reason)) {
        throw new Error("Unknown issuance denial.");
      }
      return acceptedRequest(fallbackId);
    }

    if (
      typeof result.challengeId !== "string" ||
      !UUID_PATTERN.test(result.challengeId)
    ) {
      throw new Error("Invalid issuance challenge ID.");
    }
    return acceptedRequest(result.challengeId.toLowerCase());
  } catch {
    // A provider/store exception may contain a phone, code or credential.
    // Report only a fixed event to private monitoring, never the exception.
    try {
      onInternalFailure?.("guide_phone_issuance_failed");
    } catch {
      // Keep the response uniform even if private monitoring fails.
    }
    return acceptedRequest(fallbackId);
  }
}
