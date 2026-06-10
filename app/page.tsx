import Link from "next/link";

const mainActions = [
  {
    title: "Excel取込",
    description:
      "免税店・取引先から届くExcelを取り込み、ガイド別の月次支払データを作成します。",
    href: "/imports",
    icon: "📥",
    status: "次に実装",
  },
  {
    title: "ガイド管理",
    description:
      "ガイド番号・氏名・ITC No.・振込先・WeChat情報などを管理します。",
    href: "/guides",
    icon: "🧭",
    status: "準備中",
  },
  {
    title: "月次精算",
    description:
      "対象月ごとのCOM・dodo手数料・ガイド支払額を確認します。",
    href: "/monthly-fees",
    icon: "📊",
    status: "準備中",
  },
  {
    title: "未振込一覧",
    description:
      "未振込のガイド報酬を確認し、振込CSV出力・振込済更新を行います。",
    href: "/payments",
    icon: "🏦",
    status: "重要",
  },
  {
    title: "PDF書類",
    description:
      "精算書・支払証明書・受領証・業務完了報告書をPDFで保管します。",
    href: "/documents",
    icon: "📄",
    status: "準備中",
  },
  {
    title: "業務完了報告",
    description:
      "ガイドがスマホで業務完了報告を確認し、サインできる画面を管理します。",
    href: "/work-reports",
    icon: "✍️",
    status: "準備中",
  },
];

const workflowSteps = [
  "免税店・取引先からExcelを受領",
  "Excelをアップロードして取込プレビュー",
  "ガイド番号・氏名・金額のエラー確認",
  "ガイド別に月次精算データを自動作成",
  "業務完了報告書にスマホサイン",
  "精算書・支払証明書・受領証PDFを保存",
  "振込CSVを出力",
  "振込後に未振込から振込済へ更新",
];

const summaryCards = [
  {
    label: "今月取込",
    value: "0件",
    note: "Excel取込後に自動集計",
  },
  {
    label: "未振込",
    value: "0件",
    note: "振込対象データを表示予定",
  },
  {
    label: "未サイン",
    value: "0件",
    note: "業務完了報告書の状態",
  },
  {
    label: "PDF保管",
    value: "0件",
    note: "精算書・受領証など",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <section className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow">
          <div className="text-xs font-bold tracking-[0.35em] text-slate-300">
            dodo GUIDE OFFICE
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
            <div>
              <h1 className="text-3xl font-black leading-tight md:text-4xl">
                ガイド報酬・精算書類を
                <br />
                ペーパレスで一元管理
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                毎月届く免税店Excelを取り込み、ガイド別の支払データを自動作成します。
                業務完了報告のスマホサイン、精算書・支払証明書・受領証PDF保管、
                振込CSV出力までをdodo事務アプリで管理します。
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/imports"
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
                >
                  Excel取込を始める
                </Link>
                <Link
                  href="/payments"
                  className="rounded-2xl border border-white/30 px-5 py-3 text-sm font-bold text-white"
                >
                  未振込一覧を見る
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
              <div className="text-sm font-bold text-slate-100">
                最初の開発ゴール
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                手入力をなくし、Excel取込からガイド別支払データ作成までを一瞬で終わらせる。
              </p>
              <div className="mt-4 rounded-2xl bg-emerald-400/15 px-4 py-3 text-sm font-bold text-emerald-100">
                二重振込防止ロジックを最優先で実装
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-3xl bg-white p-5 shadow-sm">
              <p className="text-sm font-bold text-slate-500">{card.label}</p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {card.value}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {card.note}
              </p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {mainActions.map((action) => (
            <Link
              key={action.title}
              href={action.href}
              className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
                  {action.icon}
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                  {action.status}
                </span>
              </div>

              <h2 className="mt-4 text-lg font-black text-slate-950">
                {action.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {action.description}
              </p>

              <div className="mt-4 text-sm font-bold text-slate-950 group-hover:underline">
                開く →
              </div>
            </Link>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">
              ペーパレス化する書類
            </h2>
            <div className="mt-4 space-y-3">
              {[
                "業務完了報告書",
                "月次精算書",
                "支払証明書",
                "受領証",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">
              月次処理フロー
            </h2>
            <div className="mt-4 space-y-3">
              {workflowSteps.map((step, index) => (
                <div key={step} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-white">
                    {index + 1}
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                    {step}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-black text-amber-900">
            開発メモ
          </h2>
          <p className="mt-2 text-sm leading-7 text-amber-900">
            現在はNaily AiDOLをベースにしたdodo事務アプリの初期トップ画面です。
            次の実装で、Excel取込画面・ガイド管理・月次精算テーブル取得へ進みます。
          </p>
        </section>
      </div>
    </main>
  );
}