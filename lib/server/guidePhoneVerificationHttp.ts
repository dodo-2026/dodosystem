import type { GuidePhoneChallengeState } from "../dodo/guidePhoneChallenge.ts";
import { getGuidePhoneChallengeStatus } from "../dodo/guidePhoneChallenge.ts";
import { verifyConfiguredGuidePhoneCodeDigest } from "./guidePhoneCode.ts";
import {
  completePersistedGuidePhoneAuthentication,
  type CommitGuidePhoneChallengeTransition,
  type GuideSessionCookie,
} from "./guidePhoneAuthentication.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^\d{6}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

export type GuidePhoneVerificationPayload = {
  challengeId: string;
  code: string;
};

export type GuidePhoneVerificationRecord = {
  challengeId: string;
  guideId: string;
  codeDigest: string;
  state: GuidePhoneChallengeState;
};

export type LoadGuidePhoneVerificationRecord = (
  challengeId: string
) => Promise<GuidePhoneVerificationRecord | null>;

export type GuidePhoneVerificationHttpResult =
  | {
      status: 400;
      headers: typeof RESPONSE_HEADERS;
      body: { ok: false; error: "invalid_request" };
    }
  | {
      status: 401;
      headers: typeof RESPONSE_HEADERS;
      body: { ok: false; error: "verification_failed" };
    }
  | {
      status: 200;
      headers: typeof RESPONSE_HEADERS;
      body: { ok: true };
      cookie: GuideSessionCookie;
    };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseGuidePhoneVerificationPayload(
  value: unknown
): GuidePhoneVerificationPayload | null {
  if (!isPlainRecord(value)) return null;

  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("challengeId") ||
    !keys.includes("code") ||
    typeof value.challengeId !== "string" ||
    typeof value.code !== "string" ||
    !UUID_PATTERN.test(value.challengeId) ||
    !CODE_PATTERN.test(value.code)
  ) {
    return null;
  }

  return {
    challengeId: value.challengeId.toLowerCase(),
    code: value.code,
  };
}

function invalidRequest(): GuidePhoneVerificationHttpResult {
  return {
    status: 400,
    headers: RESPONSE_HEADERS,
    body: { ok: false, error: "invalid_request" },
  };
}

function verificationFailed(): GuidePhoneVerificationHttpResult {
  return {
    status: 401,
    headers: RESPONSE_HEADERS,
    body: { ok: false, error: "verification_failed" },
  };
}

function assertTrustedRecord(
  record: GuidePhoneVerificationRecord,
  requestedChallengeId: string
) {
  if (
    typeof record.challengeId !== "string" ||
    !UUID_PATTERN.test(record.challengeId) ||
    record.challengeId.toLowerCase() !== requestedChallengeId
  ) {
    throw new Error("Loaded challenge record does not match the request.");
  }
  if (
    typeof record.codeDigest !== "string" ||
    !SHA256_HEX_PATTERN.test(record.codeDigest)
  ) {
    throw new Error("Loaded challenge digest is malformed.");
  }
}

/**
 * Route-independent boundary for the future verify-code endpoint. Untrusted
 * JSON is bounded before a store lookup. Missing records and every ordinary
 * authentication denial intentionally share one outward response, while the
 * atomic completion service remains the only source of cookie metadata.
 *
 * This helper performs no HTTP, database, cookie or external-network I/O.
 */
export async function handleGuidePhoneVerificationRequest({
  body,
  load,
  commit,
  now = Math.floor(Date.now() / 1000),
}: {
  body: unknown;
  load: LoadGuidePhoneVerificationRecord;
  commit: CommitGuidePhoneChallengeTransition;
  now?: number;
}): Promise<GuidePhoneVerificationHttpResult> {
  const payload = parseGuidePhoneVerificationPayload(body);
  if (!payload) return invalidRequest();

  const record = await load(payload.challengeId);
  if (!record) {
    // Match the cryptographic work of a pending challenge. The result is
    // deliberately ignored: a missing record can never authenticate.
    await verifyConfiguredGuidePhoneCodeDigest({
      ...payload,
      digest: "0".repeat(64),
    });
    return verificationFailed();
  }
  assertTrustedRecord(record, payload.challengeId);

  if (getGuidePhoneChallengeStatus(record.state, now) !== "pending") {
    // The lower-level attempt service short-circuits terminal states. At the
    // public boundary do equivalent crypto work without changing their state.
    await verifyConfiguredGuidePhoneCodeDigest({
      ...payload,
      digest: record.codeDigest,
    });
    return verificationFailed();
  }

  const result = await completePersistedGuidePhoneAuthentication({
    guideId: record.guideId,
    state: record.state,
    challengeId: payload.challengeId,
    code: payload.code,
    digest: record.codeDigest,
    commit,
    now,
  });

  if (!result.authenticated) return verificationFailed();

  return {
    status: 200,
    headers: RESPONSE_HEADERS,
    body: { ok: true },
    cookie: result.cookie,
  };
}
