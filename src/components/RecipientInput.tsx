"use client";

// 받는사람 입력 + 과거 상대방 칩 — 구글 주소록 없이, 우리 원장에서.
// 칩 클릭 = 주소 추가/제거 토글. 쓸수록 자기 주소록이 좋아진다.

import { useState } from "react";

export default function RecipientInput({
  recent,
  defaultValue = "",
}: {
  recent: string[];
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const current = value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  const toggle = (email: string) => {
    if (current.includes(email)) {
      setValue(current.filter((e) => e !== email).join(", "));
    } else {
      setValue([...current, email].join(", "));
    }
  };

  return (
    <div>
      <input
        name="to"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="받는 사람 (쉼표로 여러 명)"
        className="input w-full"
        required
      />
      {recent.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {recent.map((email) => (
            <button
              key={email}
              type="button"
              onClick={() => toggle(email)}
              className={`rounded-full border px-2 py-0.5 text-xs transition ${
                current.includes(email)
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              {current.includes(email) ? "✓ " : "+ "}{email}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
