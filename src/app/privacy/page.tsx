import Link from "next/link";

export const metadata = { title: "개인정보처리방침 — FlowDesk" };

/** Privacy policy — honest v0.1 for the validation phase. Public page. */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">← FlowDesk</Link>
      <h1 className="mt-4 text-2xl font-bold">개인정보처리방침</h1>
      <p className="mt-1 text-xs text-gray-400">v0.1 (검증 단계 초안) · 시행 2026-08-10</p>

      <div className="mt-8 space-y-8 text-sm leading-6 text-gray-700">
        <section>
          <h2 className="font-semibold text-gray-900">1. 수집하는 정보</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><b>계정 정보</b>: 이름, 이메일, 비밀번호(해시로만 저장 — 원문은 저장하지 않습니다), 소속 회사명.</li>
            <li><b>업무 데이터</b>: 서비스 이용 중 사용자가 작성하는 지시·꼭지·증빙·협업 노트·데이터 표·목표 등.</li>
            <li><b>서비스 로그</b>: 접속 및 주요 활동 기록(감사 로그).</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900">2. 이용 목적</h2>
          <p className="mt-2">서비스 제공(업무 약속의 등록·추적·알림), 계정 인증, 보안 사고 대응, 문의 처리. 그 외 목적으로 사용하지 않습니다.</p>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900">3. AI 처리에 관한 안내</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>지시 텍스트는 꼭지 분해·전략 분석 기능 수행을 위해 Anthropic(Claude) API로 전송·처리됩니다.</li>
            <li><b>귀사의 데이터는 AI 모델 학습에 사용되지 않습니다.</b> (Anthropic 상용 API는 API 데이터를 모델 학습에 사용하지 않습니다.)</li>
            <li>AI 키가 설정되지 않은 환경에서는 외부 AI 전송 없이 내부 규칙으로만 처리됩니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900">4. 보관과 파기</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>서비스 이용 기간 동안 보관하며, 회사(테넌트) 삭제 요청 시 30일 이내에 파기합니다.</li>
            <li>관리자는 언제든 회사 전체 데이터를 <b>JSON으로 내보내기(Export)</b> 할 수 있습니다 — 데이터는 귀사의 것이며, 떠날 자유가 있어야 신뢰할 수 있다고 믿습니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900">5. 제3자 제공 및 처리 위탁</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>제3자 제공: 없습니다(법령상 요구 제외).</li>
            <li>처리 위탁: 호스팅(Railway), AI 처리(Anthropic), 이메일 발송(설정 시 Resend). 위탁사는 처리 목적 외 사용이 금지됩니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900">6. 보안 조치</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>전송 구간 암호화(TLS), 비밀번호 단방향 해시(bcrypt), 회사별 데이터 격리, 로그인 무차별 대입 차단(레이트리밋).</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900">7. 이용자의 권리</h2>
          <p className="mt-2">자신의 정보에 대한 열람·정정·삭제·내보내기를 요청할 수 있습니다. 요청은 서비스 내 문의 또는 가입 시 안내된 운영자 연락처로 접수합니다.</p>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900">8. 변경 고지</h2>
          <p className="mt-2">본 방침이 변경되면 시행 7일 전 서비스 내 공지합니다. 검증 단계(v0.x) 동안의 변경 이력은 본 페이지에 누적 표기합니다.</p>
        </section>
      </div>
    </div>
  );
}
