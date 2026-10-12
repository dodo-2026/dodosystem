import { canViewGuideDocument } from "../dodo/guidePortal.ts";
import {
  verifyGuideSession,
  normalizeGuideSessionGuideId,
} from "./guideSession.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DOWNLOAD_TTL_SECONDS = 60;

export type GuideDocument = Readonly<{
  documentId: string;
  guideId: string;
  kind: "settlement" | "receipt" | "payment_certificate" | "work_report";
  period: string;
  status: "draft" | "final" | "void";
  storageKey: string;
}>;

export type GuideDocumentSummary = Readonly<Pick<
  GuideDocument,
  "documentId" | "kind" | "period"
>>;

type VerifySession = (token: string | undefined) => Promise<string | null>;

function requireNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer timestamp.");
  }
}

function validateDocument(document: GuideDocument): GuideDocument {
  if (
    !document ||
    typeof document !== "object" ||
    !UUID_PATTERN.test(document.documentId) ||
    !UUID_PATTERN.test(document.guideId) ||
    !["settlement", "receipt", "payment_certificate", "work_report"].includes(document.kind) ||
    !PERIOD_PATTERN.test(document.period) ||
    !["draft", "final", "void"].includes(document.status) ||
    typeof document.storageKey !== "string" || document.storageKey.length === 0
  ) {
    throw new Error("Loaded guide document is malformed.");
  }
  return Object.freeze({
    ...document,
    documentId: document.documentId.toLowerCase(),
    guideId: document.guideId.toLowerCase(),
  });
}

async function resolveGuideId(token: string | undefined, verifySession: VerifySession) {
  const guideId = await verifySession(token);
  return guideId ? normalizeGuideSessionGuideId(guideId) : null;
}

/**
 * Returns only a signed-in guide's final document metadata. The data adapter
 * is given the resolved guide ID, but each returned record is still validated
 * and re-authorized so an accidental broad query cannot disclose another
 * guide's document. This performs no database or storage I/O itself.
 */
export async function listGuideDocuments({
  sessionToken,
  listDocuments,
  verifySession = verifyGuideSession,
  now = Math.floor(Date.now() / 1000),
}: {
  sessionToken: string | undefined;
  listDocuments: (guideId: string) => Promise<readonly GuideDocument[]>;
  verifySession?: VerifySession;
  now?: number;
}): Promise<readonly GuideDocumentSummary[]> {
  requireNow(now);
  const sessionGuideId = await resolveGuideId(sessionToken, verifySession);
  if (!sessionGuideId) return [];
  const records = await listDocuments(sessionGuideId);
  if (!Array.isArray(records)) throw new Error("Guide document list must be an array.");

  return Object.freeze(records.flatMap((record) => {
    const document = validateDocument(record);
    const access = canViewGuideDocument({
      sessionGuideId,
      documentGuideId: document.guideId,
      documentStatus: document.status,
      sessionExpiresAt: now + 1,
      now,
    });
    return access.allowed
      ? [Object.freeze({ documentId: document.documentId, kind: document.kind, period: document.period })]
      : [];
  }));
}

/**
 * Authorizes one final own document, then delegates a 60-second signed URL to
 * the storage adapter. `storageKey` remains inside the server adapter and is
 * never included in the outward result. Missing, other-guide, draft and void
 * records all return the same unavailable result.
 */
export async function createGuideDocumentDownload({
  sessionToken,
  documentId,
  loadDocument,
  createSignedDownload,
  verifySession = verifyGuideSession,
  now = Math.floor(Date.now() / 1000),
}: {
  sessionToken: string | undefined;
  documentId: string;
  loadDocument: (documentId: string) => Promise<GuideDocument | null>;
  createSignedDownload: (input: Readonly<{ storageKey: string; expiresAt: number }>) => Promise<string>;
  verifySession?: VerifySession;
  now?: number;
}): Promise<
  | { available: false }
  | { available: true; url: string; expiresAt: number }
> {
  requireNow(now);
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    return { available: false };
  }
  const sessionGuideId = await resolveGuideId(sessionToken, verifySession);
  if (!sessionGuideId) return { available: false };
  const loaded = await loadDocument(documentId.toLowerCase());
  if (!loaded) return { available: false };
  const document = validateDocument(loaded);
  const access = canViewGuideDocument({
    sessionGuideId,
    documentGuideId: document.guideId,
    documentStatus: document.status,
    sessionExpiresAt: now + 1,
    now,
  });
  if (!access.allowed) return { available: false };

  const expiresAt = now + DOWNLOAD_TTL_SECONDS;
  const url = await createSignedDownload(Object.freeze({ storageKey: document.storageKey, expiresAt }));
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new Error("Storage adapter returned an invalid signed download URL.");
  }
  return Object.freeze({ available: true, url, expiresAt });
}
