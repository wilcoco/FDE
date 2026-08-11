/** Capability matrix drives the UX honesty — it must track protocolFor exactly. */
import assert from "node:assert/strict";
import { capabilitiesFor } from "../src/lib/mail-capabilities";

export async function run(t: (name: string, fn: () => void) => void) {
  t("IMAP ports (993/143/custom): full experience, no BCC habit", () => {
    for (const port of [993, 143, 1430]) {
      const c = capabilitiesFor(port);
      assert.equal(c.protocol, "imap");
      assert.equal(c.sentList, true);
      assert.equal(c.needsSelfBcc, false);
    }
  });

  t("POP3 ports (995/110): no sent list, BCC habit required, reply sync still on", () => {
    for (const port of [995, 110]) {
      const c = capabilitiesFor(port);
      assert.equal(c.protocol, "pop3");
      assert.equal(c.sentList, false);
      assert.equal(c.needsSelfBcc, true);
      assert.equal(c.replySync, true);
      assert.equal(c.bodyOptIn, true);
    }
  });
}
