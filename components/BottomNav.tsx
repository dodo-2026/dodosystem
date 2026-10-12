"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "DODOホーム", icon: "🏠" },
];

export default function BottomNav() {
  const pathname = usePathname();

  const hiddenPaths = ["/login"];

  const shouldHide = hiddenPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  async function handleOfficeLogout() {
    try {
      await fetch("/api/office-login/logout", {
        method: "POST",
      });
    } finally {
      window.location.href = "/login";
    }
  }

  if (shouldHide) return null;

  return (
    <nav
      aria-label="DODO共通メニュー"
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        className="mx-auto max-w-md"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        }}
      >
        {navItems.map((item) => {
          const isActive =
            pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-[64px] flex-col items-center justify-center px-1 text-[11px] font-medium transition ${
                isActive
                  ? "bg-orange-50 text-orange-500"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="mt-1 leading-none">{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={handleOfficeLogout}
          className="flex min-h-[64px] flex-col items-center justify-center px-1 text-[11px] font-medium text-gray-500 transition hover:text-gray-800"
        >
          <span className="text-lg leading-none">🚪</span>
          <span className="mt-1 leading-none">ログアウト</span>
        </button>
      </div>
    </nav>
  );
}
