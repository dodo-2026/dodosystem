import type { Metadata } from "next";
import DodoSectionPage from "@/app/components/DodoSectionPage";

export const metadata: Metadata = { title: "ガイド管理 | DODO GUIDE OFFICE" };

export default function Page() {
  return <DodoSectionPage title="ガイド管理" description="ガイド番号、氏名、ITC No.、振込先、WeChat情報を管理する画面です。" items={["ガイド基本情報","振込先情報","WeChat情報と在籍状態"]} />;
}
