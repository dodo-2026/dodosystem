import { GUIDE_PORTAL_SESSION_TTL_SECONDS } from "../dodo/guidePortal.ts";

export const GUIDE_SESSION_COOKIE = "dodo_guide_session";
export const GUIDE_SESSION_MAX_AGE_SECONDS =
  GUIDE_PORTAL_SESSION_TTL_SECONDS;

const SESSION_VERSION = "v1";
const SESSION_KIND = "guide";
const MIN_SECRET_LENGTH = 32;
const GUIDE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSessionSecret() {
  const secret = process.env.GUIDE_SESSION_SECRET || "";

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `GUIDE_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`
    );
  }

  return secret;
}

export function assertGuideSessionConfigured() {
  getSessionSecret();
}

export function normalizeGuideSessionGuideId(guideId: string) {
  if (typeof guideId !== "string" || !GUIDE_ID_PATTERN.test(guideId)) {
    throw new Error("guideId must be a valid UUID.");
  }
  return guideId.toLowerCase();
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function getSigningKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(payload: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(),
    new TextEncoder().encode(payload)
  );
  return toHex(new Uint8Array(signature));
}

export async function createGuideSession(guideId: string) {
  const normalizedGuideId = normalizeGuideSessionGuideId(guideId);
  const expiresAt =
    Math.floor(Date.now() / 1000) + GUIDE_SESSION_MAX_AGE_SECONDS;
  const payload = `${SESSION_VERSION}.${SESSION_KIND}.${normalizedGuideId}.${expiresAt}`;

  return `${payload}.${await sign(payload)}`;
}

export async function verifyGuideSession(
  token: string | undefined
): Promise<string | null> {
  if (!token) return null;

  const [version, kind, guideId, expiresAtValue, signatureValue, ...extra] =
    token.split(".");
  if (
    extra.length > 0 ||
    version !== SESSION_VERSION ||
    kind !== SESSION_KIND ||
    !GUIDE_ID_PATTERN.test(guideId)
  ) {
    return null;
  }

  const expiresAt = Number(expiresAtValue);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;

  const signature = fromHex(signatureValue);
  if (!signature) return null;

  try {
    const normalizedGuideId = guideId.toLowerCase();
    if (normalizedGuideId !== guideId) return null;

    const payload = `${version}.${kind}.${guideId}.${expiresAtValue}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      signature,
      new TextEncoder().encode(payload)
    );
    return valid ? guideId : null;
  } catch {
    return null;
  }
}
