import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import AutoSync from "@/components/AutoSync";

// MVP nav (창업자 지시 2026-08-16): 본질만 남긴다 — 지시하기 → 답변 받기 →
// 수행됨 처리. 지시하기와 메일 발송은 /capture 한 입구로 단일화됐고 /mail은
// 연결·답장 확인용 보조 화면이다. KPI·전략·분석·조직도·프로세스는 숨김
// (라우트는 살아 있음 — 되살리려면 여기 다시 추가).
const NAV = [
  { href: "/capture", label: "＋ 지시하기" },
  { href: "/instructions", label: "지시 목록" },
  { href: "/dashboard", label: "대시보드" },
  { href: "/inbox", label: "받은 업무" },
  { href: "/mail", label: "메일 연결·답장 확인" },
  { href: "/members", label: "멤버" },
];

const NAV_ADVANCED: { href: string; label: string }[] = [];

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
      <AutoSync />
      {children}
    </AppShell>
  );
}
