"use client";

// 되돌릴 수 없는 액션용 confirm 버튼 — form 안에 넣으면 확인 후에만 제출된다.

export default function DangerButton({
  label,
  message,
  className,
}: {
  label: string;
  message: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}
      className={className ?? "text-xs text-gray-400 hover:text-red-500"}
      title={label}
    >
      {label}
    </button>
  );
}
