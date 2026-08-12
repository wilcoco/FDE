// Single source of truth for the app's public URL. Defensive: a scheme-less
// APP_URL ("fde-production….up.railway.app") silently produced invalid OAuth
// redirect URIs and broken 직답 links — normalize once, here.
export function appUrl(): string {
  const raw = (process.env.APP_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}
