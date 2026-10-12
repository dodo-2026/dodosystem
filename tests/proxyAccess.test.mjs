import assert from "node:assert/strict";
import test from "node:test";

import {
  decideProxyAccess,
  isAllowedOfficePath,
  isGuideProtectedPath,
  isOfficeProtectedPath,
  isStaticAsset,
} from "../lib/server/proxyAccess.ts";

function assertPathResults(predicate, expected, paths) {
  for (const pathname of paths) assert.equal(predicate(pathname), expected, pathname);
}

test("recognizes static assets without exempting ordinary pages", () => {
  assertPathResults(isStaticAsset, true, [
    "/_next/static/chunks/app.js", "/favicon.ico", "/file.svg",
    "/images/logo.png", "/manifest.json", "/manifest.webmanifest",
  ]);
  assertPathResults(isStaticAsset, false, [
    "/_next-auth", "/dashboard", "/dashboard/export.js",
    "/favicon.ico/private", "/icons-admin", "/images-private",
    "/manifest-admin", "/publications", "/reports",
  ]);
});

test("keeps only office login and static assets public", () => {
  assertPathResults(isAllowedOfficePath, true, [
    "/login", "/guide", "/api/office-login/login", "/api/office-login/logout",
    "/api/guide-auth/request-code", "/api/guide-auth/verify-code",
  ]);
  assertPathResults(isAllowedOfficePath, false, [
    "/", "/private-area", "/api/private-tool", "/api/unknown",
    "/api/guide-auth/admin-only",
  ]);
  assertPathResults(isOfficeProtectedPath, false, [
    "/login", "/api/office-login/login", "/images/logo.png",
    "/guide", "/api/guide-auth/request-code",
  ]);
  assertPathResults(isOfficeProtectedPath, true, [
    "/", "/dashboard", "/private-area", "/api/private-tool", "/api/unknown",
  ]);
  assertPathResults(isGuideProtectedPath, true, [
    "/guide/documents", "/guide/documents/settlement-1",
    "/api/guide-documents/list", "/api/guide-documents/download",
  ]);
  assertPathResults(isGuideProtectedPath, false, [
    "/guide", "/guide-documents", "/api/guide-auth/request-code",
  ]);
});

test("keeps static paths public without requiring a session", () => {
  assert.deepEqual(
    decideProxyAccess({ pathname: "/_next/static/chunks/app.js", officeRole: null }),
    { type: "next" }
  );
});

test("does not let static-looking protected paths bypass login", () => {
  for (const pathname of [
    "/_next-auth", "/dashboard/export.js", "/images-private", "/manifest-admin",
  ]) {
    assert.deepEqual(
      decideProxyAccess({ pathname, officeRole: null }),
      { type: "redirect", pathname: "/login" },
      pathname
    );
  }
});

test("redirects anonymous DODO routes and APIs to login", () => {
  for (const pathname of ["/", "/guides", "/private-area", "/api/private-tool"]) {
    assert.deepEqual(
      decideProxyAccess({ pathname, officeRole: null }),
      { type: "redirect", pathname: "/login" },
      pathname
    );
  }
});

test("redirects signed-in office users from login to DODO home", () => {
  for (const officeRole of ["office"]) {
    assert.deepEqual(
      decideProxyAccess({ pathname: "/login", officeRole }),
      { type: "redirect", pathname: "/" },
      officeRole
    );
  }
});

test("allows signed-in office through protected routes", () => {
  for (const pathname of ["/", "/guides", "/api/private-tool"]) {
    assert.deepEqual(
      decideProxyAccess({ pathname, officeRole: "office" }),
      { type: "next" },
      pathname
    );
  }
});

test("requires a separate guide session for guide document routes", () => {
  for (const pathname of ["/guide/documents", "/api/guide-documents/download"]) {
    assert.deepEqual(
      decideProxyAccess({ pathname, officeRole: "office", guideId: null }),
      { type: "redirect", pathname: "/guide" },
      pathname
    );
    assert.deepEqual(
      decideProxyAccess({ pathname, officeRole: null, guideId: "guide-id" }),
      { type: "next" },
      pathname
    );
  }
});

test("guide sessions cannot open internal management routes", () => {
  for (const pathname of ["/", "/imports", "/api/private-tool"]) {
    assert.deepEqual(decideProxyAccess({ pathname, officeRole: null, guideId: "guide-id" }),
      { type: "redirect", pathname: "/login" });
  }
});
