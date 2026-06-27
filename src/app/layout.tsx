import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowDesk — 업무 프로세스 자동화",
  description:
    "중소기업을 위한 그룹웨어 · 자연어로 만드는 업무 프로세스 · 전자결재 · OKR/KPI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
