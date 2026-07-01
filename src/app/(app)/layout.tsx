import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";

const NAV = [
  { href: "/capture", label: "＋ 지시하기" },
  { href: "/instructions", label: "지시 목록" },
  { href: "/strategy", label: "전략 통일성" },
  { href: "/inbox", label: "받은 업무·결재" },
  { href: "/dashboard", label: "대시보드" },
  { href: "/objectives", label: "목표 (OKR·KPI)" },
  { href: "/analytics", label: "분석" },
  { href: "/org", label: "조직도" },
  { href: "/members", label: "멤버" },
];

const NAV_ADVANCED = [
  { href: "/processes", label: "프로세스 템플릿" },
  { href: "/instances", label: "프로세스 실행" },
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
    <AppShell
      nav={NAV}
      navAdvanced={NAV_ADVANCED}
      tenantName={tenant.name}
      tenantSlug={tenant.slug}
      userName={user.name}
      userEmail={user.email}
      userRole={user.role}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}
