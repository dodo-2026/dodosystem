import type { Metadata } from "next";

import { GuidePhoneWalkthroughPreview } from "./GuidePhoneWalkthroughPreview.tsx";

export const metadata: Metadata = { title: "ガイド専用ページ | DODO GUIDE OFFICE" };

const protections = [
  "登録済みの携帯番号へ届く6桁コードで本人確認",
  "コードは10分で失効し、連続5回失敗した場合は事務局確認へ切替",
  "ログイン後も、本人の確定済み精算書・受領証だけを表示",
  "WeChatは書類の通知に限定し、書類本文や口座情報は送信しない",
];

export default function GuidePortalPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-lg">
        <section className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-xs font-bold tracking-[0.3em] text-slate-300">DODO GUIDE OFFICE</p>
          <h1 className="mt-4 text-3xl font-black">ガイド専用ページ</h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            精算書・受領証を、ご本人の携帯電話から確認できるページです。
          </p>
        </section>

        <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm">
          <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
            認証準備中
          </div>
          <h2 className="mt-4 text-lg font-black text-slate-950">携帯番号認証を安全に開始します</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            現在は電話番号の登録、認証コードの送信、WeChat通知をまだ開始していません。準備が整い次第、この画面から本人確認を行います。
          </p>

          <div className="mt-6 space-y-3">
            {protections.map((protection) => (
              <div key={protection} className="flex gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                <span aria-hidden="true">✓</span>
                <p className="text-sm leading-6 text-slate-700">{protection}</p>
              </div>
            ))}
          </div>
        </section>

        <GuidePhoneWalkthroughPreview />

        <p className="mt-5 text-center text-xs leading-5 text-slate-500">
          ログイン用コードや口座情報を、電話・WeChatの返信で求めることはありません。
        </p>
      </div>
    </main>
  );
}
