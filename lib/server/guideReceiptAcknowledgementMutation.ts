import {
  type GuideReceiptAcknowledgementRecord,
} from "./guideReceiptAcknowledgement.ts";
import type { GuideReceiptAcknowledgementResponseBody } from "./guideReceiptAcknowledgementHttp.ts";
import { handlePersistedGuideReceiptAcknowledgementRequest } from "./guideReceiptAcknowledgementService.ts";
import type { CommitGuideReceiptAcknowledgementTransaction } from "./guideReceiptAcknowledgementTransaction.ts";
import { GUIDE_SESSION_COOKIE } from "./guideSession.ts";

const MAX_SESSION_TOKEN_LENGTH = 1_024;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type GuideCookieStore = Readonly<{
  get: (name: string) => Readonly<{ value: unknown }> | undefined;
}>;

function reportPrivateFailure(
  onPrivateError: ((event: "guide_receipt_acknowledgement_failed") => void) | undefined
) {
  try {
    onPrivateError?.("guide_receipt_acknowledgement_failed");
  } catch {
    // Monitoring must never change the serializable mutation result.
  }
}

export function readDedicatedGuideSessionToken(cookieStore: GuideCookieStore): string | undefined {
  const value = cookieStore.get(GUIDE_SESSION_COOKIE)?.value;
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SESSION_TOKEN_LENGTH &&
    !CONTROL_CHARACTER_PATTERN.test(value)
    ? value
    : undefined;
}

/**
 * Framework-neutral contract for a future Server Action. It reads only the
 * dedicated guide cookie, delegates to the persisted acknowledgement service,
 * and returns a serializable body. The actual `cookies()` call, public action,
 * persistence and cache revalidation are intentionally not wired here.
 */
export async function runGuideReceiptAcknowledgementMutation({
  cookieStore,
  body,
  loadReceipt,
  commitTransaction,
  verifySession,
  createEventId,
  now,
  onPrivateError,
}: {
  cookieStore: GuideCookieStore;
  body: unknown;
  loadReceipt: (documentId: string) => Promise<GuideReceiptAcknowledgementRecord | null>;
  commitTransaction: CommitGuideReceiptAcknowledgementTransaction;
  verifySession?: (token: string | undefined) => Promise<string | null>;
  createEventId?: () => string;
  now?: number;
  onPrivateError?: (event: "guide_receipt_acknowledgement_failed") => void;
}): Promise<GuideReceiptAcknowledgementResponseBody> {
  let sessionToken: string | undefined;
  try {
    sessionToken = readDedicatedGuideSessionToken(cookieStore);
  } catch {
    reportPrivateFailure(onPrivateError);
    return Object.freeze({ ok: false, error: "temporarily_unavailable" });
  }

  const result = await handlePersistedGuideReceiptAcknowledgementRequest({
    sessionToken,
    body,
    loadReceipt,
    commitTransaction,
    verifySession,
    createEventId,
    now,
    onPrivateError,
  });
  return result.body;
}
