import type { Metadata } from "next";
import Link from "next/link";

import {
  createGuideFinancialDocumentView,
  paginateSettlementDocumentView,
  type ReceiptDocumentView,
  type SettlementDocumentView,
} from "@/lib/dodo/guideFinancialDocumentView";
import {
  createGuideReceiptAcknowledgementView,
  type GuideReceiptAcknowledgementView,
} from "@/lib/dodo/guideReceiptAcknowledgementView";
import {
  createReceiptDocumentSnapshot,
  createSettlementDocumentSnapshot,
  fingerprintGuideFinancialDocument,
} from "@/lib/server/guideFinancialDocuments";

export const metadata: Metadata = { title: "書類プレビュー | DODO GUIDE OFFICE" };

const sampleLines = Array.from({ length: 18 }, (_, index) => ({
  importRowId: `423e4567-e89b-42d3-a456-${String(index + 1).padStart(12, "0")}`,
  workDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
  grossComYen: 12_000,
  dodoFeeYen: 1_200,
  guidePaymentYen: 10_800,
}));

const sampleSettlement = createSettlementDocumentSnapshot({
  documentId: "123e4567-e89b-42d3-a456-426614174000",
  version: 1,
  settlementId: "223e4567-e89b-42d3-a456-426614174000",
  guideId: "323e4567-e89b-42d3-a456-426614174000",
  statementMonth: "2026-10",
  settlementStatus: "paid",
  confirmedAt: "2026-10-03T00:00:00.000Z",
  totals: {
    grossComYen: 216_000,
    dodoFeeYen: 21_600,
    adjustmentYen: 0,
    guidePaymentYen: 194_400,
  },
  lines: sampleLines,
});

const viewContext = {
  guideDisplayName: "テスト ガイド",
  issuerDisplayName: "DODO GUIDE OFFICE",
  issuedOn: "2026-10-03",
};

function DocumentHeader({
  title,
  recipient,
  issuer,
  reference,
  issuedOnLabel,
  periodLabel,
  revisionLabel,
  statusLabel,
}: SettlementDocumentView | ReceiptDocumentView) {
  return (
    <>
      <div className="flex items-start justify-between gap-6 border-b-2 border-slate-950 pb-5">
        <div>
          <p className="text-xs font-bold tracking-[0.24em] text-slate-500">DODO GUIDE OFFICE</p>
          <h2 className="mt-2 text-3xl font-black tracking-wide text-slate-950">{title}</h2>
        </div>
        <div className="text-right text-xs leading-5 text-slate-600">
          <p>{reference}</p>
          <p>{revisionLabel}</p>
          <p>発行日：{issuedOnLabel}</p>
        </div>
      </div>
      <div className="mt-7 flex items-end justify-between gap-6">
        <div>
          <p className="text-xl font-bold text-slate-950">{recipient}</p>
          <p className="mt-2 text-sm text-slate-600">対象：{periodLabel}</p>
        </div>
        <div className="text-right">
          <p className="font-bold text-slate-950">{issuer}</p>
          <p className="mt-1 text-xs text-slate-500">{statusLabel}</p>
        </div>
      </div>
    </>
  );
}

function SettlementSheet({ view }: { view: SettlementDocumentView }) {
  const pages = paginateSettlementDocumentView(view);
  return (
    <>
      {pages.map((page) => (
        <article key={page.pageNumber} className="page-break min-h-[270mm] bg-white p-[14mm] text-slate-950 shadow-xl print:min-h-0 print:p-[12mm] print:shadow-none">
          <DocumentHeader {...view} />
          <p className="mt-4 text-right text-xs font-bold text-slate-500">
            {page.pageNumber} / {page.totalPages} ページ
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-300">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-100 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-3">稼働日</th>
                  <th className="px-3 py-3 text-right">COM</th>
                  <th className="px-3 py-3 text-right">DODO手数料</th>
                  <th className="px-3 py-3 text-right">ガイド支払額</th>
                </tr>
              </thead>
              <tbody>
                {page.details.map((line, index) => (
                  <tr key={`${page.pageNumber}-${line.workDateLabel}-${index}`} className="border-t border-slate-200">
                    <td className="px-3 py-3">{line.workDateLabel}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{line.grossComYen}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{line.dodoFeeYen}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums">{line.guidePaymentYen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.showTotals ? (
            <>
              <dl className="ml-auto mt-8 max-w-sm space-y-3">
                {view.totals.map((total) => (
                  <div key={total.label} className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <dt className="text-sm text-slate-600">{total.label}</dt>
                    <dd className="font-bold tabular-nums">{total.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-12 border-t border-slate-200 pt-5 text-xs leading-6 text-slate-500">
                この画面は架空データによるレイアウト確認用です。確定した業務ルール・実データ・振込結果とは連携していません。
              </p>
            </>
          ) : (
            <p className="mt-6 text-right text-xs font-bold text-slate-500">明細は次ページへ続きます</p>
          )}
        </article>
      ))}
    </>
  );
}

function ReceiptSheet({
  view,
  acknowledgement,
}: {
  view: ReceiptDocumentView;
  acknowledgement: GuideReceiptAcknowledgementView;
}) {
  return (
    <article className="min-h-[270mm] bg-white p-[14mm] text-slate-950 shadow-xl print:min-h-0 print:p-[12mm] print:shadow-none">
      <DocumentHeader {...view} />
      <div className="mt-16 rounded-2xl border-2 border-slate-950 px-8 py-10 text-center">
        <p className="text-sm font-bold text-slate-600">受取金額</p>
        <p className="mt-3 text-4xl font-black tracking-wide tabular-nums">{view.amountLabel}</p>
        <p className="mt-5 text-sm text-slate-600">受取日：{view.paidOnLabel}</p>
      </div>
      <dl className="mt-10 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-3 text-sm">
        <dt className="text-slate-500">対象精算書</dt>
        <dd className="font-medium">{view.settlementReference}</dd>
        <dt className="text-slate-500">対象月</dt>
        <dd className="font-medium">{view.periodLabel}</dd>
        <dt className="text-slate-500">発行状態</dt>
        <dd className="font-medium">{view.statusLabel}</dd>
        <dt className="text-slate-500">ガイド確認</dt>
        <dd>
          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-800">
            {acknowledgement.label}
          </span>
          <span className="ml-3 text-xs text-slate-500">{acknowledgement.detail}</span>
        </dd>
      </dl>
      <p className="mt-12 border-t border-slate-200 pt-5 text-xs leading-6 text-slate-500">
        この画面は架空データによるレイアウト確認用です。実際の受領意思・電子署名・支払証明を表すものではありません。
      </p>
    </article>
  );
}

export default async function DocumentsPage() {
  const settlementFingerprint = await fingerprintGuideFinancialDocument(sampleSettlement);
  const sampleReceipt = await createReceiptDocumentSnapshot({
    documentId: "623e4567-e89b-42d3-a456-426614174000",
    version: 1,
    settlement: sampleSettlement,
    settlementFingerprint,
    paymentId: "723e4567-e89b-42d3-a456-426614174000",
    paymentStatus: "paid",
    amountYen: sampleSettlement.totals.guidePaymentYen,
    paidAt: "2026-10-03T01:00:00.000Z",
  });
  const settlementView = createGuideFinancialDocumentView(sampleSettlement, viewContext);
  const receiptView = createGuideFinancialDocumentView(sampleReceipt, viewContext);
  const acknowledgementView = createGuideReceiptAcknowledgementView({
    status: "pending",
    acknowledgedAt: null,
  });

  return (
    <main className="min-h-screen bg-slate-200 pb-24 print:bg-white print:pb-0">
      <div className="print-hidden mx-auto max-w-5xl px-4 pt-8">
        <Link href="/" className="text-sm font-bold text-slate-600 hover:text-slate-950">← DODOホーム</Link>
        <section className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <div className="inline-flex rounded-full bg-amber-200 px-3 py-1 text-xs font-black text-amber-950">架空データ</div>
          <h1 className="mt-3 text-2xl font-black text-slate-950">精算書・受取書 印刷プレビュー</h1>
          <p className="mt-2 text-sm leading-7 text-slate-700">
            ブラウザーの印刷機能でA4レイアウトを確認できます。実データ、DB、Storage、PDF保存、WeChat送信には接続していません。
          </p>
        </section>
      </div>
      <div className="print-area mx-auto mt-8 max-w-[210mm] space-y-8 print:mt-0 print:max-w-none print:space-y-0">
        <SettlementSheet view={settlementView} />
        <ReceiptSheet view={receiptView} acknowledgement={acknowledgementView} />
      </div>
    </main>
  );
}
