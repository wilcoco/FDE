import type { Metadata, Viewport } from "next";
import "./globals.css";
import PWA from "@/components/PWA";

export const metadata: Metadata = {
  title: "FlowDesk — 업무 프로세스 자동화",
  description:
    "중소기업을 위한 그룹웨어 · 자연어로 만드는 업무 프로세스 · 전자결재 · OKR/KPI",
  applicationName: "FlowDesk",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FlowDesk",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        {children}
        <PWA />
      </body>
    </html>
  );
}
