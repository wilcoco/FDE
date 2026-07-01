"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";

export interface NavItem {
  href: string;
  label: string;
}

export default function AppShell({
  nav,
  navAdvanced,
  tenantName,
  tenantSlug,
  userName,
  userEmail,
  userRole,
  unread,
  children,
}: {
  nav: NavItem[];
  navAdvanced: NavItem[];
  tenantName: string;
  tenantSlug: string;
  userName: string;
  userEmail: string;
  userRole: string;
  unread: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);

  const sidebar = (
    <div className="flex h-full flex-col p-4">
      <div className="mb-6">
        <div className="text-lg font-bold text-indigo-600">FlowDesk</div>
        <div className="mt-1 text-sm font-medium text-gray-700">{tenantName}</div>
        <div className="text-xs text-gray-400">@{tenantSlug}</div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {nav.map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={close}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                active ? "bg-indigo-50 font-medium text-indigo-700" : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <span>{n.label}</span>
              {n.href === "/inbox" && unread > 0 && (
                <span className="badge bg-indigo-100 text-indigo-700">{unread}</span>
              )}
            </Link>
          );
        })}
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase text-gray-400">
            고급 (프로세스 설계)
          </div>
          {navAdvanced.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={close}
              className="block rounded-md px-3 py-2 text-sm text-gray-500 hover:bg-gray-100"
            >
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="text-sm font-medium text-gray-800">{userName}</div>
        <div className="text-xs text-gray-400">{userEmail}</div>
        <span className="badge mt-2 bg-gray-100 text-gray-600">{userRole}</span>
        <form action={logoutAction} className="mt-3">
          <button className="btn-ghost w-full">로그아웃</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-white md:block">
        {sidebar}
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85%] border-r border-gray-200 bg-white shadow-xl">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 md:hidden">
          <button
            onClick={() => setOpen(true)}
            aria-label="메뉴 열기"
            className="rounded-md p-1 text-gray-700 hover:bg-gray-100"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="font-bold text-indigo-600">FlowDesk</span>
          <span className="truncate text-sm text-gray-500">{tenantName}</span>
          {unread > 0 && (
            <Link href="/inbox" className="ml-auto badge bg-indigo-100 text-indigo-700">
              {unread}
            </Link>
          )}
        </header>

        <main className="min-w-0 flex-1 overflow-x-auto bg-gray-50 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
