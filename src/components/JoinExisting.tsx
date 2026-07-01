"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  searchCompanies,
  requestToJoin,
  type CompanyHit,
  type FormState,
} from "@/app/actions/join-requests";

const initial: FormState = {};

export default function JoinExisting() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CompanyHit[]>([]);
  const [picked, setPicked] = useState<CompanyHit | null>(null);
  const [searching, startSearch] = useTransition();
  const [state, action, pending] = useActionState(requestToJoin, initial);

  // debounced company search
  useEffect(() => {
    if (picked) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      startSearch(async () => setHits(await searchCompanies(q)));
    }, 250);
    return () => clearTimeout(t);
  }, [query, picked]);

  if (state.ok) {
    return (
      <div className="rounded-md bg-green-50 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-green-800">가입 요청을 보냈습니다.</p>
        <p className="mt-1 text-xs text-green-700">
          관리자가 승인하면 로그인할 수 있습니다. 승인 결과는 이메일 계정으로 다시 로그인해 확인하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!picked ? (
        <div>
          <label className="label">회사 이름 검색</label>
          <input
            className="input"
            placeholder="회사명 또는 식별자 (2글자 이상)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="mt-2 space-y-1">
            {searching && <p className="text-xs text-gray-400">검색 중…</p>}
            {!searching && query.trim().length >= 2 && hits.length === 0 && (
              <p className="text-xs text-gray-400">일치하는 회사가 없습니다.</p>
            )}
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setPicked(h)}
                className="flex w-full items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-left text-sm hover:border-indigo-400 hover:bg-indigo-50"
              >
                <span className="font-medium">{h.name}</span>
                <span className="text-xs text-gray-400">{h.slug}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <input type="hidden" name="tenantId" value={picked.id} />
          <div className="flex items-center justify-between rounded-md bg-indigo-50 px-3 py-2">
            <span className="text-sm">
              <b>{picked.name}</b>에 가입 요청
            </span>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-xs text-gray-500 hover:text-indigo-600"
            >
              회사 변경
            </button>
          </div>
          <div>
            <label className="label">이름</label>
            <input name="name" className="input" placeholder="홍길동" required />
          </div>
          <div>
            <label className="label">이메일</label>
            <input name="email" type="email" className="input" placeholder="you@company.com" required />
          </div>
          <div>
            <label className="label">비밀번호</label>
            <input name="password" type="password" className="input" placeholder="6자 이상" required />
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <button className="btn w-full" disabled={pending}>
            {pending ? "요청 보내는 중…" : "가입 요청 보내기"}
          </button>
          <p className="text-center text-xs text-gray-400">관리자 승인 후 로그인할 수 있습니다.</p>
        </form>
      )}
    </div>
  );
}
