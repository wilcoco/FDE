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
