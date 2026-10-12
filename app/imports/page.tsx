import type { Metadata } from "next";
import Link from "next/link";
import ImportPreview from "./ImportPreview";

export const metadata: Metadata = { title: "Excel取込 | DODO GUIDE OFFICE" };

export default function Page() {
  return (
    <main className="min-h-screen bg-slate-50 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Link
          href="/"
          className="text-sm font-bold text-slate-600 hover:text-slate-950"
        >
          ← DODOホーム
        </Link>
        <div className="mb-6 mt-5">
          <h1 className="text-3xl font-black text-slate-950">Excel取込</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
            月次CSV・TSVを確認し、作業ファイルの保存・再読込とガイド別精算書の印刷・PDF出力を行います。
          </p>
        </div>
        <ImportPreview />
      </div>
    </main>
  );
}
