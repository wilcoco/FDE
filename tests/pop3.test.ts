/**
 * POP3 client tests against a scripted in-process server: login, STAT/UIDL/
 * TOP listing, dot-stuffing, RETR by UIDL, auth failure classification.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { pop3Test, pop3ListRecent, pop3FetchRaw } from "../src/lib/pop3";

const MSGS = [
  // seq 1 — oldest
  {
    uid: "uid-001",
    raw:
      "Message-ID: <old@x>\r\nSubject: old mail\r\nFrom: a@x\r\nTo: b@y\r\n\r\nbody-old\r\n.leading-dot-line",
  },
  // seq 2 — newest (self-BCC'd SAY)
  {
    uid: "uid-002",
    raw:
      "Message-ID: <say-1@icams>\r\nSubject: =?UTF-8?B?" +
      Buffer.from("납품 단가 회신 요청").toString("base64") +
      "?=\r\nFrom: json@icams.co.kr\r\nTo: vendor@partner.co.kr\r\n\r\n단가표 부탁드립니다",
  },
];

function startServer(port: number): Promise<net.Server> {
  const stuff = (s: string) => s.replace(/(^|\r\n)\./g, "$1..");
  const srv = net.createServer((sock) => {
    sock.write("+OK fake POP3 ready\r\n");
    sock.on("data", (d) => {
      for (const line of d.toString().split("\r\n").filter(Boolean)) {
        const [cmd, ...args] = line.trim().split(/\s+/);
        const c = cmd.toUpperCase();
        if (c === "USER") sock.write(args[0] === "json" ? "+OK\r\n" : "+OK\r\n");
        else if (c === "PASS") sock.write(args[0] === "goodpw" ? "+OK logged in\r\n" : "-ERR [AUTH] invalid password\r\n");
        else if (c === "STAT") sock.write(`+OK ${MSGS.length} 9999\r\n`);
        else if (c === "UIDL") sock.write(`+OK\r\n${MSGS.map((m, i) => `${i + 1} ${m.uid}`).join("\r\n")}\r\n.\r\n`);
        else if (c === "TOP") {
          const m = MSGS[Number(args[0]) - 1];
          if (!m) { sock.write("-ERR no such message\r\n"); continue; }
          const headers = m.raw.split("\r\n\r\n")[0];
          sock.write(`+OK\r\n${stuff(headers)}\r\n.\r\n`);
        } else if (c === "RETR") {
          const m = MSGS[Number(args[0]) - 1];
          if (!m) { sock.write("-ERR no such message\r\n"); continue; }
          sock.write(`+OK\r\n${stuff(m.raw)}\r\n.\r\n`);
        } else if (c === "QUIT") { sock.write("+OK bye\r\n"); sock.end(); }
        else sock.write("+OK\r\n");
      }
    });
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}

export async function run(t: (name: string, fn: () => void | Promise<void>) => void) {
  const PORT = 11110; // plaintext (only 995 gets implicit TLS)
  const srv = await startServer(PORT);
  const conn = { host: "127.0.0.1", port: PORT, user: "json", pass: "goodpw" };

  await t("pop3Test: good credentials pass", async () => {
    await pop3Test(conn);
  });

  await t("pop3Test: bad password → authenticationFailed", async () => {
    try {
      await pop3Test({ ...conn, pass: "wrong" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal((e as { authenticationFailed?: boolean }).authenticationFailed, true);
    }
  });

  await t("pop3ListRecent: newest first, uid attached, headers only", async () => {
    const mails = await pop3ListRecent(conn, 10);
    assert.equal(mails.length, 2);
    assert.equal(mails[0].uid, "uid-002"); // newest first
    assert.match(mails[0].rawHeaders, /say-1@icams/);
    assert.ok(!mails[0].rawHeaders.includes("단가표 부탁드립니다"), "TOP must not leak the body");
  });

  await t("pop3FetchRaw: RETR by UIDL, dot-stuffing undone", async () => {
    const raw = await pop3FetchRaw(conn, "uid-001");
    assert.match(raw, /body-old/);
    assert.match(raw, /\n\.leading-dot-line/); // ".." unstuffed back to "."
    assert.equal(await pop3FetchRaw(conn, "no-such-uid"), "");
  });

  await t("pop3: connection refused classifies as ECONNREFUSED", async () => {
    try {
      await pop3Test({ ...conn, port: 11119 });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal((e as { code?: string }).code, "ECONNREFUSED");
    }
  });

  srv.close();
}
