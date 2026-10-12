const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AcknowledgementResult = Readonly<
  { acknowledged: false } | { acknowledged: true; acknowledgedAt: number }
>;

type AcknowledgeReceipt = (input: Readonly<{
  sessionToken: string | undefined;
  documentId: string;
}>) => Promise<AcknowledgementResult>;

export type GuideReceiptAcknowledgementResponseBody = Readonly<
  | { ok: true; acknowledgedAt: number }
  | { ok: false; error: "invalid_request" | "unavailable" | "temporarily_unavailable" }
>;

export type GuideReceiptAcknowledgementHttpResponse = Readonly<{
  status: 200 | 400 | 503;
  headers: Readonly<Record<string, string>>;
  body: GuideReceiptAcknowledgementResponseBody;
}>;

const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

function response(
  status: GuideReceiptAcknowledgementHttpResponse["status"],
  body: GuideReceiptAcknowledgementResponseBody
): GuideReceiptAcknowledgementHttpResponse {
  return Object.freeze({ status, headers: RESPONSE_HEADERS, body: Object.freeze(body) });
}

function parseDocumentId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const prototype = Object.getPrototypeOf(body);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "documentId") return null;
  const documentId = (body as { documentId?: unknown }).documentId;
  return typeof documentId === "string" && UUID_PATTERN.test(documentId)
    ? documentId.toLowerCase()
    : null;
}

function isAcknowledgementResult(value: unknown): value is AcknowledgementResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as { acknowledged?: unknown; acknowledgedAt?: unknown };
  if (result.acknowledged === false) {
    return Object.keys(result).length === 1;
  }
  return (
    result.acknowledged === true &&
    Object.keys(result).length === 2 &&
    Number.isSafeInteger(result.acknowledgedAt) &&
    (result.acknowledgedAt as number) >= 0
  );
}

/**
 * Route-independent JSON boundary for a future receipt acknowledgement API.
 * The caller must inject the domain operation; this module opens no DB,
 * Storage, cookie, or messaging connection.
 */
export async function handleGuideReceiptAcknowledgementRequest({
  sessionToken,
  body,
  acknowledge,
  onPrivateError = () => undefined,
}: {
  sessionToken: string | undefined;
  body: unknown;
  acknowledge: AcknowledgeReceipt;
  onPrivateError?: (event: "guide_receipt_acknowledgement_failed") => void;
}): Promise<GuideReceiptAcknowledgementHttpResponse> {
  const documentId = parseDocumentId(body);
  if (!documentId) {
    return response(400, { ok: false, error: "invalid_request" });
  }

  try {
    const result = await acknowledge(Object.freeze({ sessionToken, documentId }));
    if (!isAcknowledgementResult(result)) {
      throw new Error("Malformed receipt acknowledgement result.");
    }
    return result.acknowledged
      ? response(200, { ok: true, acknowledgedAt: result.acknowledgedAt })
      : response(200, { ok: false, error: "unavailable" });
  } catch {
    try {
      onPrivateError("guide_receipt_acknowledgement_failed");
    } catch {
      // Monitoring must never change the public failure response.
    }
    return response(503, { ok: false, error: "temporarily_unavailable" });
  }
}
