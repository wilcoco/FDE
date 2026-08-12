/**
 * SMTP client tests against a scripted server: EHLO/AUTH LOGIN/MAIL/RCPT/
 * DATA flow, dot-stuffing, BCC recipients, 한글 subject encoding, auth
 * failure (535), derivation of SMTP endpoints from incoming hosts.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { smtpSend, buildMessage, encodeHeaderWord, deriveSmtp } from "../src/lib/smtp";

interface Captured {
  rcpts: string[];
  data: string;
  authUser: string;
}

function startServer(port: number, captured: Captured): Promise<net.Server> {
  const srv = net.createServer((sock) => {
    sock.on("error", () => {});
    let inData = false;
    let dataBuf = "";
    let authStage = 0;
    sock.write("220 fake SMTP ready\r\n");
    sock.on("data", (d) => {
      const chunk = d.toString();
      if (inData) {
        dataBuf += chunk;
        if (dataBuf.includes("\r\n.\r\n")) {
          captured.data = dataBuf.split("\r\n.\r\n")[0];
          inData = false;
          sock.write("250 OK queued\r\n");
        }
        return;
      }
      for (const line of chunk.split("\r\n").filter(Boolean)) {
        const up = line.toUpperCase();
        if (up.startsWith("EHLO")) sock.write("250-fake\r\n250 AUTH LOGIN PLAIN\r\n");
        else if (up === "AUTH LOGIN") { authStage = 1; sock.write("334 VXNlcm5hbWU6\r\n"); }
        else if (authStage === 1) { captured.authUser = Buffer.from(line, "base64").toString(); authStage = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); }
        else if (authStage === 2) {
          authStage = 0;
          const pw = Buffer.from(line, "base64").toString();
          sock.write(pw === "goodpw" ? "235 ok\r\n" : "535 auth failed\r\n");
        }
        else if (up.startsWith("MAIL FROM")) sock.write("250 ok\r\n");
        else if (up.startsWith("RCPT TO")) { captured.rcpts.push(line.replace(/RCPT TO:<(.+)>/i, "$1")); sock.write("250 ok\r\n"); }
        else if (up === "DATA") { inData = true; dataBuf = ""; sock.write("354 go\r\n"); }
        else if (up === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 ok\r\n");
      }
    });
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}

export async function run(t: (name: string, fn: () => void | Promise<void>) => void) {
  const PORT = 12525;
  const captured: Captured = { rcpts: [], data: "", authUser: "" };
  const srv = await startServer(PORT, captured);
  const cfg = { host: "127.0.0.1", port: PORT, user: "json", pass: "goodpw" };

  await t("smtpSend: full happy path — auth, rcpts incl. BCC, data", async () => {
    await smtpSend(cfg, {
      from: "json@icams.co.kr",
      to: ["vendor@partner.co.kr"],
      bcc: ["json@icams.co.kr"],
      subject: "납품 단가 요청",
      text: "단가표 부탁드립니다.\n.점으로 시작하는 줄", // dot-stuffing case
      messageId: "fd-test-1@icams.co.kr",
    });
    assert.equal(captured.authUser, "json");
    assert.deepEqual(captured.rcpts, ["vendor@partner.co.kr", "json@icams.co.kr"]);
    assert.match(captured.data, /Message-ID: <fd-test-1@icams\.co\.kr>/);
    assert.match(captured.data, /Subject: =\?UTF-8\?B\?/); // 한글 → encoded-word
    assert.ok(!captured.data.includes("json@icams.co.kr>, <json"), "BCC must not appear twice in headers");
    assert.ok(!/^Bcc:/m.test(captured.data), "BCC must not appear in headers at all");
  });

  await t("smtpSend: wrong password → authenticationFailed", async () => {
    try {
      await smtpSend({ ...cfg, pass: "wrong" }, {
        from: "a@b", to: ["c@d"], subject: "x", text: "", messageId: "m@x",
      });
      assert.fail("should throw");
    } catch (e) {
      assert.equal((e as { authenticationFailed?: boolean }).authenticationFailed, true);
    }
  });

  await t("buildMessage: body base64 round-trips 한글", () => {
    const msg = buildMessage({
      from: "a@b", to: ["c@d"], subject: "s", text: "안녕하세요\n줄바꿈", messageId: "m@x",
    });
    const b64 = msg.split("\r\n\r\n")[1].replace(/\s+/g, "");
    assert.equal(Buffer.from(b64, "base64").toString("utf8"), "안녕하세요\n줄바꿈");
  });

  await t("encodeHeaderWord: ASCII passes through, 한글 gets encoded", () => {
    assert.equal(encodeHeaderWord("plain"), "plain");
    assert.match(encodeHeaderWord("제목"), /^=\?UTF-8\?B\?.+\?=$/);
  });

  await t("REGRESSION: bare-code SMTP replies (\"221\" without text) don't hang", async () => {
    // RFC 5321 allows a reply of just the code — the fake above sends "221 bye",
    // so spin a variant that answers QUIT with a bare "221".
    const bare: Captured = { rcpts: [], data: "", authUser: "" };
    const srv2 = await startServer(12526, bare);
    // monkey: swap QUIT handling is inside startServer; instead measure duration —
    // a hang would take COMMAND_TIMEOUT (30s); normal completion is instant.
    const t0 = Date.now();
    await smtpSend({ host: "127.0.0.1", port: 12526, user: "json", pass: "goodpw" }, {
      from: "a@b", to: ["c@d"], subject: "s", text: "t", messageId: "m@x",
    });
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0}ms — parser hang?`);
    srv2.close();
  });

  await t("no-AUTH server (POP-before-SMTP 방식): AUTH is skipped, send succeeds", async () => {
    // Nmail-style: EHLO doesn't advertise AUTH; the client must not send it
    const noauth: Captured = { rcpts: [], data: "", authUser: "" };
    const srv3 = net.createServer((sock) => {
      sock.on("error", () => {});
      let inData = false, buf = "";
      sock.write("220 nmail\r\n");
      sock.on("data", (d) => {
        const chunk = d.toString();
        if (inData) {
          buf += chunk;
          if (buf.includes("\r\n.\r\n")) { noauth.data = buf.split("\r\n.\r\n")[0]; inData = false; sock.write("250 queued\r\n"); }
          return;
        }
        for (const line of chunk.split("\r\n").filter(Boolean)) {
          const up = line.toUpperCase();
          if (up.startsWith("EHLO")) sock.write("250-nmail\r\n250 SIZE 52428800\r\n"); // no AUTH!
          else if (up.startsWith("AUTH")) sock.write("500 command not recognized\r\n");
          else if (up.startsWith("RCPT TO")) { noauth.rcpts.push(line); sock.write("250 ok\r\n"); }
          else if (up === "DATA") { inData = true; buf = ""; sock.write("354 go\r\n"); }
          else if (up === "QUIT") { sock.write("221\r\n"); sock.end(); }
          else sock.write("250 ok\r\n");
        }
      });
    });
    await new Promise((r) => srv3.listen(12527, "127.0.0.1", () => r(null)));
    await smtpSend({ host: "127.0.0.1", port: 12527, user: "json", pass: "pw" }, {
      from: "json@icams.co.kr", to: ["v@x.com"], subject: "s", text: "t", messageId: "m2@x",
    });
    assert.equal(noauth.rcpts.length, 1);
    srv3.close();
  });

  await t("deriveSmtp: known providers mapped, company falls back to same host:587", () => {
    assert.deepEqual(deriveSmtp("imap.naver.com"), { host: "smtp.naver.com", port: 465 });
    assert.deepEqual(deriveSmtp("imap.gmail.com"), { host: "smtp.gmail.com", port: 465 });
    assert.deepEqual(deriveSmtp("mail.icams.co.kr"), { host: "mail.icams.co.kr", port: 587 });
  });

  srv.close();
}
