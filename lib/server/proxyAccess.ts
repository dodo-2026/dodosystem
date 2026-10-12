import type { OfficeRole } from "./officeSession";

export type ProxyAccessDecision =
  | { type: "next" }
  | {
      type: "redirect";
      pathname: "/" | "/login" | "/guide";
    };

type DecideProxyAccessInput = {
  pathname: string;
  officeRole: OfficeRole | null;
  guideId?: string | null;
};

const ROOT_PUBLIC_FILE_PATTERN =
  /^\/[^/]+\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml)$/i;

function isPathWithin(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function isStaticAsset(pathname: string) {
  return (
    isPathWithin(pathname, "/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest.webmanifest" ||
    isPathWithin(pathname, "/icons") ||
    isPathWithin(pathname, "/images") ||
    isPathWithin(pathname, "/public") ||
    ROOT_PUBLIC_FILE_PATTERN.test(pathname)
  );
}

export function isAllowedOfficePath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/guide" ||
    pathname.startsWith("/api/office-login/") ||
    pathname === "/api/guide-auth/request-code" ||
    pathname === "/api/guide-auth/verify-code"
  );
}

export function isOfficeProtectedPath(pathname: string) {
  if (isStaticAsset(pathname)) return false;
  if (isAllowedOfficePath(pathname)) return false;
  if (isGuideProtectedPath(pathname)) return false;

  return true;
}

export function isGuideProtectedPath(pathname: string) {
  return (
    isPathWithin(pathname, "/guide/documents") ||
    isPathWithin(pathname, "/api/guide-documents")
  );
}

export function decideProxyAccess({
  pathname,
  officeRole,
  guideId = null,
}: DecideProxyAccessInput): ProxyAccessDecision {
  if (isStaticAsset(pathname)) {
    return { type: "next" };
  }

  if (isGuideProtectedPath(pathname)) {
    return guideId === null
      ? { type: "redirect", pathname: "/guide" }
      : { type: "next" };
  }

  if (isOfficeProtectedPath(pathname) && officeRole === null) {
    return { type: "redirect", pathname: "/login" };
  }

  if (pathname === "/login" && officeRole !== null) {
    return {
      type: "redirect",
      pathname: "/",
    };
  }

  return { type: "next" };
}
