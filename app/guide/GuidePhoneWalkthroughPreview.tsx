"use client";

import { useState } from "react";

import {
  createGuidePhoneWalkthroughPreviews,
  type GuidePhoneWalkthroughPreviewKey,
} from "@/lib/dodo/guidePhoneWalkthroughPreview.ts";

const previews = createGuidePhoneWalkthroughPreviews();

function panelTone(phase: string): string {
  if (phase === "consumed") return "border-emerald-200 bg-emerald-50";
  if (phase === "invalid_code" || phase === "expired") {
    return "border-amber-200 bg-amber-50";
  }
  if (phase === "locked") return "border-rose-200 bg-rose-50";
  if (phase === "pending") return "border-sky-200 bg-sky-50";
  return "border-slate-200 bg-slate-50";
}

export function GuidePhoneWalkthroughPreview() {
  const [selectedKey, setSelectedKey] =
    useState<GuidePhoneWalkthroughPreviewKey>("phone_entry");
  const selected = previews.find((preview) => preview.key === selectedKey) ?? previews[0];

  return (
    <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm">
      <div className="inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-950">
        架空データ・表示確認専用
      </div>
      <h2 className="mt-4 text-xl font-black text-slate-950">携帯認証の画面を確認</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        実際の携帯番号や認証コードを使わず、本人確認画面の状態だけを切り替えます。
      </p>

      <fieldset className="mt-5">
        <legend className="sr-only">確認する携帯認証の状態</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {previews.map((preview) => {
            const isSelected = preview.key === selectedKey;
            return (
              <button
                key={preview.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedKey(preview.key)}
                className={isSelected
                  ? "rounded-xl bg-slate-950 px-3 py-3 text-xs font-black text-white"
                  : "rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700"}
              >
                {preview.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div
        aria-live="polite"
        className={`mt-4 rounded-2xl border p-4 ${panelTone(selected.phase)}`}
      >
        <p className="text-base font-black text-slate-950">{selected.title}</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">{selected.description}</p>
        <label className="mt-4 block text-xs font-black text-slate-700">
          {selected.fieldLabel}
          <input
            type="text"
            value={selected.fieldValue}
            disabled
            readOnly
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500"
          />
        </label>
        <button
          type="button"
          disabled
          className="mt-4 w-full rounded-xl bg-slate-300 px-4 py-3 text-sm font-black text-white"
        >
          {selected.actionLabel}
        </button>
      </div>
      <p className="mt-3 text-center text-xs leading-5 text-slate-500">
        すべての入力・操作は無効です。SMS送信、ログイン、Cookie発行、保存は行いません。
      </p>
    </section>
  );
}
