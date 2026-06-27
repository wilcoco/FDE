import Link from "next/link";
import { getCurrentContext } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Landing() {
  const ctx = await getCurrentContext();
  if (ctx) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">FlowDesk</div>
        <nav className="flex gap-3">
          <Link href="/login" className="btn-ghost">로그인</Link>
          <Link href="/signup" className="btn">회사 시작하기</Link>
        </nav>
      </header>

      <section className="mt-20 text-center">
        <h1 className="text-4xl font-bold leading-tight text-gray-900 sm:text-5xl">
          업무 매뉴얼을 적으면,
          <br />
          <span className="text-indigo-600">실행되는 프로세스</span>가 됩니다.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
          중소기업을 위한 그룹웨어. 자연어로 업무 프로세스를 만들고, 조직도 기반
          전자결재로 승인받고, 실제 업무가 그 흐름을 따라 진행되는지 추적하세요.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/signup" className="btn px-5 py-3 text-base">무료로 시작</Link>
          <Link href="/login" className="btn-ghost px-5 py-3 text-base">로그인</Link>
        </div>
      </section>

      <section className="mt-24 grid gap-6 sm:grid-cols-3">
        {[
          { t: "자연어 → 순서도", d: "업무 매뉴얼을 적으면 AI가 프로세스 그래프로 변환하고 시각화합니다." },
          { t: "조직도 전자결재", d: "결재는 프로세스 노드의 하나. 조직도·전결규정으로 결재선이 자동 결정됩니다." },
          { t: "실행 · 추적 · 분석", d: "업무일지·업무지시·협조업무로 실제 진행을 추적하고 병목을 분석합니다." },
        ].map((f) => (
          <div key={f.t} className="card">
            <h3 className="font-semibold text-gray-900">{f.t}</h3>
            <p className="mt-2 text-sm text-gray-600">{f.d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
