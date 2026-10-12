import { NextRequest, NextResponse } from "next/server";

import {
  createOfficeSession,
  OFFICE_SESSION_COOKIE,
  OFFICE_SESSION_MAX_AGE_SECONDS,
} from "@/lib/server/officeSession";

import { authenticateOfficeLogin } from "@/lib/server/officeLogin";

type RequestBody = {
  loginId?: string;
  password?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    const loginId = body.loginId?.trim() || "";
    const password = body.password?.trim() || "";

    const result = authenticateOfficeLogin(loginId, password);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    const response = NextResponse.json({ ok: true });

    response.cookies.set(OFFICE_SESSION_COOKIE, await createOfficeSession(), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: OFFICE_SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch {
    return NextResponse.json(
      { ok: false, error: "ログインに失敗しました。" },
      { status: 500 }
    );
  }
}
