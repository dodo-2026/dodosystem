import type { Metadata } from "next";
import Link from "next/link";

import { GuideDocumentsPreview } from "../GuideDocumentsPreview.tsx";

export const metadata: Metadata = {
  title: "本人書類 | DODO GUIDE OFFICE",
};

export default function GuideDocumentsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-lg">
        <Link href="/guide" className="text-sm font-bold text-slate-600">
          ← ガイド専用ページ
        </Link>
        <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm">
          <div className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900">
            本人認証が必要
          </div>
          <h1 className="mt-4 text-3xl font-black text-slate-950">精算書・受領証</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            携帯認証済みのガイド本人に限り、確定済みの書類を対象月ごとに表示します。
          </p>
          <div className="mt-6 rounded-2xl bg-slate-950 px-4 py-4 text-sm leading-6 text-white">
            現在は認証と閲覧制御の土台のみです。実データ、PDF、口座情報は表示していません。
          </div>
        </section>
        <GuideDocumentsPreview />
      </div>
    </main>
  );
}
