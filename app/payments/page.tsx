import type { Metadata } from "next";
import DodoSectionPage from "@/app/components/DodoSectionPage";

export const metadata: Metadata = { title: "未振込一覧 | DODO GUIDE OFFICE" };

export default function Page() {
  return <DodoSectionPage title="未振込一覧" description="支払待ちのガイド報酬を確認し、振込処理へつなぐ画面です。" items={["未振込と振込済みの明確な区別","振込CSV出力前の最終確認","二重振込を防ぐ確定状態の管理"]} />;
}
