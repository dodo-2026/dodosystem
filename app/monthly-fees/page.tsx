import type { Metadata } from "next";
import DodoSectionPage from "@/app/components/DodoSectionPage";

export const metadata: Metadata = { title: "月次精算 | DODO GUIDE OFFICE" };

export default function Page() {
  return (
    <DodoSectionPage
      title="月次精算"
      description="月ごとのCOM、DODO手数料、ガイド支払額を確認する画面です。"
      items={[
        "対象月と取込元の確認",
        "DODO手数料と差引額の表示",
        "確定前のエラー・重複確認",
      ]}
      notice="月会費は目的・金額・対象者・徴収方法が未確定のため、DODO手数料と同一扱いにせず、自動計算や差引を実装していません。"
    />
  );
}
