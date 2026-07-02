import { requireContext } from "@/lib/session";
import { CATEGORIES, effectivePrefs } from "@/lib/notify-prefs";
import { saveNotifyPrefs } from "@/app/actions/settings";
import { mailConfigured } from "@/lib/mail";

export default async function SettingsPage() {
  const { user } = await requireContext();
  const prefs = effectivePrefs(user.notifyPrefs);
  const mailOn = mailConfigured();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">알림 설정</h1>
        <p className="mt-1 text-sm text-gray-500">
          받고 싶은 알림 종류를 선택하세요. 나에게만 적용됩니다.
        </p>
      </div>

      <form action={saveNotifyPrefs} className="card p-0">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-500">
          <span>알림 종류</span>
          <span className="w-10 text-center">인앱</span>
          <span className="w-10 text-center">이메일</span>
        </div>
        <div className="divide-y divide-gray-100">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-4 py-3">
              <div>
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-xs text-gray-400">{c.desc}</div>
              </div>
              <label className="flex w-10 justify-center">
                <input
                  type="checkbox"
                  name={`${c.key}_inapp`}
                  defaultChecked={prefs[c.key].inapp}
                  className="h-4 w-4 accent-indigo-600"
                />
              </label>
              <label className="flex w-10 justify-center">
                <input
                  type="checkbox"
                  name={`${c.key}_email`}
                  defaultChecked={prefs[c.key].email}
                  className="h-4 w-4 accent-indigo-600"
                />
              </label>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400">
            {mailOn
              ? "이메일은 체크한 종류만 발송됩니다."
              : "이메일 발송이 아직 설정되지 않아, 이메일 열은 설정해 두어도 지금은 발송되지 않습니다."}
          </p>
          <button className="btn">저장</button>
        </div>
      </form>

      <p className="text-xs text-gray-400">
        정체·기한 알림은 같은 건에 대해 24시간에 한 번만 발송됩니다. 긴급 확인이 필요한
        검수 요청과 업무 배정은 켜 두기를 권장합니다.
      </p>
    </div>
  );
}
