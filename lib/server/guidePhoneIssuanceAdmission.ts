export const GUIDE_PHONE_SOURCE_WINDOW_SECONDS = 60;
export const GUIDE_PHONE_MAX_ADMISSIONS_PER_SOURCE = 5;
export const GUIDE_PHONE_GLOBAL_WINDOW_SECONDS = 60;
export const GUIDE_PHONE_MAX_ADMISSIONS_GLOBALLY = 60;

const SOURCE_KEY_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

export type GuidePhoneAdmissionSnapshot = Readonly<{
  sourceAcceptedAt: readonly number[];
  globalAcceptedAt: readonly number[];
}>;

function requireTimestamp(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer timestamp.`);
  }
}

function activeCount(
  timestamps: readonly number[],
  now: number,
  window: number,
  field: string
) {
  if (!Array.isArray(timestamps)) throw new Error(`${field} must be an array.`);
  return timestamps.filter((timestamp, index) => {
    requireTimestamp(timestamp, `${field}[${index}]`);
    if (timestamp > now) throw new Error(`${field} must not contain future timestamps.`);
    return timestamp > now - window;
  }).length;
}

/**
 * Pure admission check for a request-code intake. `sourceKey` must be an
 * opaque, trusted edge-derived identifier (for example a keyed hash of the
 * normalized client network identity); never accept it from browser JSON or
 * store a raw IP here. The live adapter must fetch both counters and append
 * the accepted timestamp atomically, before enqueueing.
 */
export function decideGuidePhoneIssuanceAdmission({
  sourceKey,
  snapshot,
  now = Math.floor(Date.now() / 1000),
}: {
  sourceKey: string;
  snapshot: GuidePhoneAdmissionSnapshot;
  now?: number;
}) {
  requireTimestamp(now, "now");
  if (typeof sourceKey !== "string" || !SOURCE_KEY_PATTERN.test(sourceKey)) {
    throw new Error("sourceKey must be a trusted opaque identifier.");
  }
  const sourceCount = activeCount(
    snapshot.sourceAcceptedAt,
    now,
    GUIDE_PHONE_SOURCE_WINDOW_SECONDS,
    "sourceAcceptedAt"
  );
  const globalCount = activeCount(
    snapshot.globalAcceptedAt,
    now,
    GUIDE_PHONE_GLOBAL_WINDOW_SECONDS,
    "globalAcceptedAt"
  );
  return sourceCount < GUIDE_PHONE_MAX_ADMISSIONS_PER_SOURCE &&
    globalCount < GUIDE_PHONE_MAX_ADMISSIONS_GLOBALLY;
}
