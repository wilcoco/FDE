import { configuredProviders, type ProviderId } from "@/lib/oauth";

const STYLES: Record<ProviderId, string> = {
  google: "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  slack: "border-transparent bg-[#4A154B] text-white hover:opacity-90",
  kakao: "border-transparent bg-[#FEE500] text-[#191600] hover:opacity-90",
};

const ICON: Record<ProviderId, string> = { google: "G", slack: "S", kakao: "K" };

/** Renders a sign-in button per configured provider; nothing if none set. */
export default function SocialButtons() {
  const providers = configuredProviders();
  if (providers.length === 0) return null;

  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <a
          key={p.id}
          href={`/api/auth/${p.id}`}
          className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition ${STYLES[p.id]}`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/10 text-xs font-bold">
            {ICON[p.id]}
          </span>
          {p.label}로 계속하기
        </a>
      ))}
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400">또는</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>
    </div>
  );
}
