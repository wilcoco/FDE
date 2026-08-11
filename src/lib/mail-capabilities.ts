// Capability model for mail connections. The product promise ("메일로 맡긴
// 일을 추적한다") degrades differently per protocol — this is the single
// source of truth for what works, what doesn't, and what to tell the user.
// Pure — no IO.

import { protocolFor } from "./mail-fetch";

export interface MailCapabilities {
  protocol: "imap" | "pop3";
  /** can list the sent folder (SAY 후보를 자동으로 보여줄 수 있는가) */
  sentList: boolean;
  /** can detect replies in the inbox (DO 감지) — both protocols can */
  replySync: boolean;
  /** per-mail body opt-in for AI decomposition — both protocols can */
  bodyOptIn: boolean;
  /** the self-BCC habit is REQUIRED to capture SAYs (POP3-only servers) */
  needsSelfBcc: boolean;
}

export function capabilitiesFor(port: number): MailCapabilities {
  const protocol = protocolFor(port);
  const isImap = protocol === "imap";
  return {
    protocol,
    sentList: isImap,
    replySync: true,
    bodyOptIn: true,
    needsSelfBcc: !isImap,
  };
}

/** Provider presets for the setup screen — host/port plus what to expect. */
export interface MailPreset {
  key: string;
  label: string;
  host: string;
  port: number;
  note: string;
}

export const MAIL_PRESETS: MailPreset[] = [
  {
    key: "naver",
    label: "네이버",
    host: "imap.naver.com",
    port: 993,
    note: "네이버 메일 → 환경설정 → POP3/IMAP 설정에서 IMAP 사용 켜기 + 2단계 인증 후 앱 비밀번호 발급.",
  },
  {
    key: "gmail",
    label: "Gmail",
    host: "imap.gmail.com",
    port: 993,
    note: "Google 계정 2단계 인증을 켠 뒤 앱 비밀번호를 발급해 입력하세요.",
  },
  {
    key: "daum",
    label: "다음",
    host: "imap.daum.net",
    port: 993,
    note: "Daum 메일 설정에서 IMAP 사용을 켜고 앱 비밀번호(2단계 인증)를 사용하세요.",
  },
  {
    key: "company",
    label: "회사 메일서버",
    host: "",
    port: 993,
    note: "보통 mail.회사도메인 형태입니다. IMAP(993/143)이 안 열려 있으면 POP3(995/110)로 연결됩니다 — 이 경우 기능 일부가 제한되며 화면에서 안내합니다.",
  },
];
