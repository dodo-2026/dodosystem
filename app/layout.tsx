import type { Metadata } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "DODO GUIDE OFFICE",
  description: "ガイド管理・Excel取込・月次精算・支払書類を管理するDODO事務アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
