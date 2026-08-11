/**
 * Auto-detection tests: known-provider shortcut, candidate ordering for
 * company domains, live probe pick (IMAP preferred over POP3) against
 * scripted listeners.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { knownProvider, candidateHosts, detectEndpoints, tcpProbe, IN_PORTS } from "../src/lib/mail-autodetect";

export async function run(t: (name: string, fn: () => void | Promise<void>) => void) {
  t("known providers resolve without probing", () => {
    assert.deepEqual(knownProvider("naver.com")?.in, { host: "imap.naver.com", port: 993 });
    assert.deepEqual(knownProvider("GMAIL.com")?.smtp, { host: "smtp.gmail.com", port: 465 });
    assert.equal(knownProvider("icams.co.kr"), null);
  });

  t("candidateHosts: conventional names first, MX deduped, apex last", () => {
    const hosts = candidateHosts("icams.co.kr", ["mail.icams.co.kr.", "mx2.icams.co.kr"]);
    assert.deepEqual(hosts, [
      "mail.icams.co.kr", // conventional AND first MX — deduped, kept first
      "imap.icams.co.kr",
      "pop.icams.co.kr",
      "mx2.icams.co.kr",
      "icams.co.kr",
    ]);
  });

  t("IN_PORTS prefers IMAP over POP3", () => {
    assert.ok(IN_PORTS.indexOf(993) < IN_PORTS.indexOf(995));
    assert.ok(IN_PORTS.indexOf(143) < IN_PORTS.indexOf(110));
  });

  await t("tcpProbe: open port true, closed port false (fast)", async () => {
    const srv = net.createServer(() => {});
    await new Promise<void>((r) => srv.listen(12621, "127.0.0.1", () => r()));
    assert.equal(await tcpProbe("127.0.0.1", 12621, 2000), true);
    assert.equal(await tcpProbe("127.0.0.1", 12622, 2000), false);
    srv.close();
  });

  await t("detectEndpoints: known provider returns instantly with SMTP", async () => {
    const d = await detectEndpoints("ceo@naver.com");
    assert.deepEqual(d.incoming, { host: "imap.naver.com", port: 993 });
    assert.deepEqual(d.smtp, { host: "smtp.naver.com", port: 465 });
  });

  await t("detectEndpoints: garbage address → nulls, never throws", async () => {
    const d = await detectEndpoints("not-an-address");
    assert.equal(d.incoming, null);
    assert.equal(d.smtp, null);
  });
}
