export function decodeUtf8File(data: ArrayBuffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

export function containsUnsafeControlCharacters(text: string): boolean {
  return UNSAFE_CONTROL_CHARACTER.test(text);
}
