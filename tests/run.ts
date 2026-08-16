/**
 * Zero-dependency test runner: `npm test`
 * Collects failures instead of stopping at the first one, prints a summary,
 * exits non-zero on any failure.
 */
let passed = 0;
const failures: { name: string; error: Error }[] = [];

async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e as Error });
    console.error(`  ✗ ${name}`);
  }
}

async function main() {
  console.log("── milestone-rules (pure logic) ──");
  await (await import("./milestone-rules.test")).run(t);

  console.log("── rate-limit ──");
  await (await import("./rate-limit.test")).run(t);

  console.log("── notify-prefs ──");
  await (await import("./notify-prefs.test")).run(t);

  console.log("── collab ──");
  await (await import("./collab.test")).run(t);

  console.log("── objective-progress ──");
  await (await import("./objective-progress.test")).run(t);

  console.log("── datatable ──");
  await (await import("./datatable.test")).run(t);

  console.log("── inbound-email ──");
  await (await import("./inbound-email.test")).run(t);

  console.log("── connector ──");
  await (await import("./connector.test")).run(t);

  console.log("── crypto ──");
  await (await import("./crypto.test")).run(t);

  console.log("── mail-headers ──");
  await (await import("./mail-headers.test")).run(t);

  console.log("── pop3 ──");
  await (await import("./pop3.test")).run(t);

  console.log("── mail-capabilities ──");
  await (await import("./mail-capabilities.test")).run(t);

  console.log("── smtp ──");
  await (await import("./smtp.test")).run(t);

  console.log("── mail-autodetect ──");
  await (await import("./mail-autodetect.test")).run(t);

  console.log("── reply-token ──");
  await (await import("./reply-token.test")).run(t);

  console.log("── gmail-local (browser-side pure logic) ──");
  await (await import("./gmail-local.test")).run(t);

  console.log("── mail-template ──");
  await (await import("./mail-template.test")).run(t);

  console.log("── migrations (embedded Postgres) ──");
  await (await import("./migrations.test")).run(t);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) {
    console.error(`\n✗ ${f.name}\n${f.error.stack ?? f.error.message}`);
  }
  if (failures.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
