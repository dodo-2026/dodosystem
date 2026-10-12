import { NextRequest, NextResponse } from "next/server";

import {
  OFFICE_SESSION_COOKIE,
  verifyOfficeSession,
} from "@/lib/server/officeSession";

export async function requireOfficeSession(request: NextRequest) {
  const officeSession = request.cookies.get(OFFICE_SESSION_COOKIE)?.value;

  if (!(await verifyOfficeSession(officeSession))) {
    return NextResponse.json(
      { error: "社内ログインが必要です。" },
      { status: 401 }
    );
  }

  return null;
}
