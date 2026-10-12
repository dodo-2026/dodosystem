import { NextResponse } from "next/server";

const OFFICE_SESSION_COOKIE = "office_session";

export async function POST() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set(OFFICE_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}