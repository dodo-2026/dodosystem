import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFileSize,
  sha256Hex,
} from "../lib/dodo/fileFingerprint.ts";

test("creates the standard SHA-256 fingerprint for the exact file bytes", async () => {
  const bytes = new TextEncoder().encode("abc");

  assert.equal(
    await sha256Hex(bytes.buffer),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("formats file sizes for the import confirmation screen", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(999), "999 B");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5 MB");
  assert.throws(() => formatFileSize(-1), RangeError);
});
