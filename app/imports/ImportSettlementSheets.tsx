"use client";

import { summarizeDodoImportRows, type DodoImportBatchValidation } from "@/lib/dodo/importValidation";
import { groupImportByGuide } from "@/lib/dodo/importWorkspace";

const yen = (value: number | bigint) => `${value.toLocaleString("ja-JP")}円`;

export default function ImportSettlementSheets({ batch }: { batch: DodoImportBatchValidation }) {
  const groups = groupImportByGuide(batch);
  if (groups.length === 0) return null;
  return (
    <section>
      <div className="print-hidden mb-4 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black">ガイド別精算書（確認版）</h2>
        <p className="mt-2 text-sm leading-7 text-slate-600">{groups.length}名の入力明細をガイド別に出力します。印刷画面で「PDFに保存」を選べます。金額はCSVの値です。月会費・振込結果・受領確認は含まれません。</p>
        <button type="button" onClick={() => window.print()} className="mt-4 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">精算書を印刷・PDF出力</button>
      </div>
      <div className="print-area space-y-6 print:space-y-0">
        {groups.map(({ guideCode, rows }) => {
          const totals = summarizeDodoImportRows(rows);
          return <article key={guideCode} className="page-break rounded-2xl bg-white p-6 text-slate-950 shadow-sm print:rounded-none print:p-[12mm] print:shadow-none">
            <header className="border-b-2 border-slate-950 pb-4">
              <p className="text-xs font-bold">DODO GUIDE OFFICE</p>
              <h2 className="mt-2 text-2xl font-black">月次精算書・確認版</h2>
              <p className="mt-3">ガイドコード：{guideCode}</p>
              <p className="mt-1 text-sm">対象月：{batch.statementMonth} ／ 取込元：{batch.sourcePartner}</p>
            </header>
            <table className="mt-6 w-full border-collapse text-xs sm:text-sm">
              <thead className="table-header-group"><tr className="border-b border-slate-300"><th className="py-3 text-left">稼働日</th><th className="text-right">COM</th><th className="text-right">DODO手数料</th><th className="text-right">ガイド支払</th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.sourceRowNumber} className="border-b border-slate-200 break-inside-avoid"><td className="py-3">{row.workDate}</td><td className="text-right tabular-nums">{yen(row.grossComYen)}</td><td className="text-right tabular-nums">{yen(row.dodoFeeYen)}</td><td className="text-right font-bold tabular-nums">{yen(row.guidePaymentYen)}</td></tr>)}</tbody>
            </table>
            <dl className="ml-auto mt-6 max-w-sm space-y-2 break-inside-avoid">
              {[["明細", `${totals.rowCount}件`], ["COM合計", yen(totals.grossComYen)], ["DODO手数料合計", yen(totals.dodoFeeYen)], ["ガイド支払額合計", yen(totals.guidePaymentYen)]].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="font-bold">{value}</dd></div>)}
            </dl>
            <p className="mt-8 text-xs text-slate-500">入力明細の確認用です。支払済み・受領済みを証明する書類ではありません。</p>
          </article>;
        })}
      </div>
    </section>
  );
}
