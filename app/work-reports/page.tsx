import type { Metadata } from "next";
import DodoSectionPage from "@/app/components/DodoSectionPage";

export const metadata: Metadata = { title: "業務完了報告 | DODO GUIDE OFFICE" };

export default function Page() {
  return <DodoSectionPage title="業務完了報告" description="ガイドがスマホで業務内容を確認し、サインするための管理画面です。" items={["対象業務と報酬内容の確認","本人確認後のスマホサイン","提出済み・未提出の状態管理"]} />;
}
