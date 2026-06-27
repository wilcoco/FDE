import Link from "next/link";
import { requireContext } from "@/lib/session";
import { logoutAction } from "@/app/actions/auth";
import { prisma } from "@/lib/db";

const NAV = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/inbox", label: "받은 업무·결재" },
  { href: "/processes", label: "프로세스" },
  { href: "/instances", label: "실행 현황" },
  { href: "/objectives", label: "목표 (OKR·KPI)" },
  { href: "/analytics", label: "분석" },
  { href: "/org", label: "조직도" },
  { href: "/members", label: "멤버" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, tenant } = await requireContext();
  const unread = await prisma.notification.count({
    where: { tenantId: tenant.id, userId: user.id, readAt: null },
  });

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-gray-200 bg-white p-4">
        <div className="mb-6">
          <div className="text-lg font-bold text-indigo-600">FlowDesk</div>
          <div className="mt-1 text-sm font-medium text-gray-700">{tenant.name}</div>
          <div className="text-xs text-gray-400">@{tenant.slug}</div>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              <span>{n.label}</span>
              {n.href === "/inbox" && unread > 0 && (
                <span className="badge bg-indigo-100 text-indigo-700">{unread}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="mt-8 border-t border-gray-100 pt-4">
          <div className="text-sm font-medium text-gray-800">{user.name}</div>
          <div className="text-xs text-gray-400">{user.email}</div>
          <span className="badge mt-2 bg-gray-100 text-gray-600">{user.role}</span>
          <form action={logoutAction} className="mt-3">
            <button className="btn-ghost w-full">로그아웃</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto bg-gray-50 p-8">{children}</main>
    </div>
  );
}
