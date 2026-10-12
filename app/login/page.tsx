"use client";

import { FormEvent, useState } from "react";

export default function OfficeLoginPage() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage("");

    if (!loginId.trim() || !password.trim()) {
      setErrorMessage("ログインIDとパスワードを入力してください。");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/office-login/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          loginId,
          password,
        }),
      });

      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!res.ok || !json.ok) {
        setErrorMessage(json.error || "ログインに失敗しました。");
        setLoading(false);
        return;
      }

      window.location.href = "/";
    } catch {
      setErrorMessage("ログインに失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-rose-50/40">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
        <div className="w-full rounded-[28px] border border-rose-100 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <p className="text-xs font-bold tracking-[0.25em] text-rose-400">
              DODO GUIDE OFFICE
            </p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">
              社内ログイン
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              ガイド売上・精算の管理には、社内用IDでログインしてください。
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                ログインID
              </label>
              <input
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className="w-full rounded-2xl border border-rose-200 bg-white px-4 py-3"
                placeholder="社内用ID"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-2xl border border-rose-200 bg-white px-4 py-3"
                placeholder="パスワード"
              />
            </div>

            {errorMessage ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
