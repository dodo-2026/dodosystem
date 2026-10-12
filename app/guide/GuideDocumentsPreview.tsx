"use client";

import { useState } from "react";

import { createGuideReceiptPreview } from "@/lib/dodo/guideReceiptPreview.ts";
import { createGuideDocumentReadyNotificationPreview } from "@/lib/dodo/guideDocumentReadyNotificationPreview.ts";
import {
  createGuideReceiptStatePreviews,
  type GuideReceiptStatePreviewKey,
} from "@/lib/dodo/guideReceiptStatePreviews.ts";
import { createGuideSettlementPreview } from "@/lib/dodo/guideSettlementPreview.ts";

const receipt = createGuideReceiptPreview();
const settlement = createGuideSettlementPreview();
const states = createGuideReceiptStatePreviews();
const notification = createGuideDocumentReadyNotificationPreview();

export function GuideDocumentsPreview() {
  const [selectedKey, setSelectedKey] = useState<GuideReceiptStatePreviewKey>("pending");
  const selected = states.find((state) => state.key === selectedKey) ?? states[0];

  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-950">
          架空データ・表示確認専用
        </div>
        <h2 className="mt-4 text-2xl font-black text-slate-950">{settlement.title}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <p><span className="block text-xs text-slate-500">対象月</span>{settlement.periodLabel}</p>
          <p><span className="block text-xs text-slate-500">状態</span>{settlement.statusLabel}</p>
        </div>
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          {settlement.details.map((detail) => (
            <div key={detail.workDateLabel} className="grid grid-cols-2 gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0">
              <span className="font-bold text-slate-700">{detail.workDateLabel}</span>
              <span className="text-right font-black text-slate-950">{detail.guidePaymentYen}</span>
            </div>
          ))}
        </div>
        <dl className="mt-5 space-y-2">
          {settlement.totals.map((total) => (
            <div key={total.label} className="flex justify-between gap-4 text-sm">
              <dt className="text-slate-600">{total.label}</dt>
              <dd className="font-black text-slate-950">{total.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-black text-slate-950">{receipt.title}</h2>
          <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-black text-sky-900">
            {selected.label}
          </span>
        </div>
        <p className="mt-2 text-xs font-bold text-violet-800">{receipt.previewLabel}</p>
        <p className="mt-5 text-4xl font-black text-slate-950">{receipt.amountLabel}</p>
        <p className="mt-2 text-sm text-slate-600">{receipt.statementMonth}・{receipt.paidOnLabel}</p>

        <fieldset className="mt-5">
          <legend className="sr-only">受取書の表示状態</legend>
          <div className="grid grid-cols-2 gap-2">
            {states.map((state) => (
              <button
                key={state.key}
                type="button"
                aria-pressed={state.key === selectedKey}
                onClick={() => setSelectedKey(state.key)}
                className={state.key === selectedKey
                  ? "rounded-xl bg-slate-950 px-3 py-3 text-xs font-black text-white"
                  : "rounded-xl border border-slate-200 px-3 py-3 text-xs font-bold text-slate-700"}
              >
                {state.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div aria-live="polite" className="mt-4 rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-700">{selected.message}</p>
          <button
            type="button"
            disabled
            className="mt-4 w-full rounded-xl bg-slate-300 px-4 py-3 text-sm font-black text-white"
          >
            {selected.actionLabel}（表示のみ）
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          API、Supabase、Storage、WeChatには接続せず、確認状態も保存しません。
        </p>
      </section>

      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <div className="inline-flex rounded-full bg-emerald-200 px-3 py-1 text-xs font-black text-emerald-950">
          {notification.channelLabel}・送信なし
        </div>
        <h2 className="mt-4 text-xl font-black text-slate-950">{notification.title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">{notification.body}</p>
        <button
          type="button"
          disabled
          className="mt-4 w-full rounded-xl bg-emerald-300 px-4 py-3 text-sm font-black text-white"
        >
          {notification.actionLabel}（表示のみ）
        </button>
        <p className="mt-3 text-xs leading-5 text-slate-600">{notification.privacyNote}</p>
      </section>
    </div>
  );
}
