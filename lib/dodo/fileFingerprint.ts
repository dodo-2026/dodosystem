export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError("File size must be a non-negative finite number.");
  }

  if (bytes < 1024) {
    return `${bytes.toLocaleString("ja-JP")} B`;
  }

  const kibibytes = bytes / 1024;

  if (kibibytes < 1024) {
    return `${kibibytes.toLocaleString("ja-JP", {
      maximumFractionDigits: 1,
    })} KB`;
  }

  return `${(kibibytes / 1024).toLocaleString("ja-JP", {
    maximumFractionDigits: 2,
  })} MB`;
}
