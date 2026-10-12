import { NextRequest, NextResponse } from "next/server";

import {
  decideProxyAccess,
  isStaticAsset,
} from "@/lib/server/proxyAccess";
import {
  OFFICE_SESSION_COOKIE,
  verifyOfficeSession,
} from "@/lib/server/officeSession";
import {
  GUIDE_SESSION_COOKIE,
  verifyGuideSession,
} from "@/lib/server/guideSession";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const [officeRole, guideId] = await Promise.all([
    verifyOfficeSession(request.cookies.get(OFFICE_SESSION_COOKIE)?.value),
    verifyGuideSession(request.cookies.get(GUIDE_SESSION_COOKIE)?.value),
  ]);
  const decision = decideProxyAccess({
    pathname,
    officeRole,
    guideId,
  });

  if (decision.type === "redirect") {
    return NextResponse.redirect(new URL(decision.pathname, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
