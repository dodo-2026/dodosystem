import Link from "next/link";

type DodoSectionPageProps = {
  title: string;
  description: string;
  items: readonly string[];
  notice?: string;
};

export default function DodoSectionPage({
  title,
  description,
  items,
  notice = "現在は画面構成のみです。実データの登録・更新・送信は行いません。",
}: DodoSectionPageProps) {
  return (
    <main className="min-h-screen bg-slate-50 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/" className="text-sm font-bold text-slate-600 hover:text-slate-950">
          ← DODOホーム
        </Link>

        <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm">
          <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
            安全な初期画面
          </div>
          <h1 className="mt-4 text-3xl font-black text-slate-950">{title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>

          <div className="mt-6 space-y-3">
            {items.map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <span aria-hidden="true">○</span>
                <span className="text-sm font-medium leading-6 text-slate-700">{item}</span>
              </div>
            ))}
          </div>

          <p className="mt-6 rounded-2xl bg-slate-950 px-4 py-3 text-sm leading-6 text-white">
            {notice}
          </p>
        </section>
      </div>
    </main>
  );
}
