export const OFFICE_SESSION_COOKIE = "office_session";
export const OFFICE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export type OfficeRole = "office";

const SESSION_VERSION = "v1";
const MIN_SECRET_LENGTH = 32;

function getSessionSecret() {
  const secret = process.env.OFFICE_SESSION_SECRET || "";

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `OFFICE_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`
    );
  }

  return secret;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    return null;
  }

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

export async function createOfficeSession(role: OfficeRole = "office") {
  if (role !== "office") throw new Error("Unsupported office session role.");
  const expiresAt = Math.floor(Date.now() / 1000) + OFFICE_SESSION_MAX_AGE_SECONDS;
  const payload = `${SESSION_VERSION}.${role}.${expiresAt}`;
  return `${payload}.${await sign(payload)}`;
}

export async function verifyOfficeSession(
  token: string | undefined
): Promise<OfficeRole | null> {
  if (!token) return null;

  const [version, role, expiresAtValue, signatureValue, ...extra] = token.split(".");
  if (
    extra.length > 0 ||
    version !== SESSION_VERSION ||
    role !== "office"
  ) {
    return null;
  }

  const expiresAt = Number(expiresAtValue);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return null;
  }

  const signature = fromHex(signatureValue);
  if (!signature) return null;

  try {
    const payload = `${version}.${role}.${expiresAtValue}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      signature,
      new TextEncoder().encode(payload)
    );
    return valid ? role : null;
  } catch {
    return null;
  }
}
