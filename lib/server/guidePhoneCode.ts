import { GUIDE_PHONE_CODE_LENGTH } from "../dodo/guidePortal.ts";

const DIGEST_VERSION = "v1";
const DIGEST_PURPOSE = "guide-phone";
const MIN_SECRET_LENGTH = 32;
const GUIDE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = new RegExp(`^\\d{${GUIDE_PHONE_CODE_LENGTH}}$`);
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function getCodeSecret() {
  const secret = process.env.GUIDE_PHONE_CODE_SECRET || "";

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `GUIDE_PHONE_CODE_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`
    );
  }

  return secret;
}

function requireChallengeId(challengeId: string) {
  if (typeof challengeId !== "string" || !GUIDE_ID_PATTERN.test(challengeId)) {
    throw new Error("challengeId must be a valid UUID.");
  }
  return challengeId.toLowerCase();
}

function requireCode(code: string) {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
    throw new Error(
      `code must contain exactly ${GUIDE_PHONE_CODE_LENGTH} ASCII digits.`
    );
  }
  return code;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  if (!SHA256_HEX_PATTERN.test(value)) return null;

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function getSigningKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getCodeSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function createPayload(challengeId: string, code: string) {
  return `${DIGEST_VERSION}.${DIGEST_PURPOSE}.${challengeId}.${code}`;
}

/**
 * Creates the value persisted for one phone challenge. The raw code must only
 * exist long enough to hand it to the configured SMS provider.
 */
export async function createGuidePhoneCodeDigest(
  challengeId: string,
  code: string
) {
  const payload = createPayload(
    requireChallengeId(challengeId),
    requireCode(code)
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(),
    new TextEncoder().encode(payload)
  );

  return toHex(new Uint8Array(digest));
}

/**
 * Uses Web Crypto verification so the digest comparison is not implemented as
 * an early-exit string comparison. Invalid input and missing configuration
 * fail closed.
 */
export async function verifyGuidePhoneCodeDigest({
  challengeId,
  code,
  digest,
}: {
  challengeId: string;
  code: string;
  digest: string;
}) {
  try {
    return await verifyConfiguredGuidePhoneCodeDigest({
      challengeId,
      code,
      digest,
    });
  } catch {
    return false;
  }
}

/**
 * Verification variant for the attempt service. Invalid user input is a
 * mismatch, while missing server configuration throws so it cannot consume a
 * guide's limited attempts.
 */
export async function verifyConfiguredGuidePhoneCodeDigest({
  challengeId,
  code,
  digest,
}: {
  challengeId: string;
  code: string;
  digest: string;
}) {
  if (
    typeof challengeId !== "string" ||
    typeof code !== "string" ||
    typeof digest !== "string"
  ) {
    return false;
  }
  const signature = fromHex(digest);
  if (!signature || !GUIDE_ID_PATTERN.test(challengeId) || !CODE_PATTERN.test(code)) {
    return false;
  }

  const payload = createPayload(challengeId.toLowerCase(), code);
  return crypto.subtle.verify(
    "HMAC",
    await getSigningKey(),
    signature,
    new TextEncoder().encode(payload)
  );
}
