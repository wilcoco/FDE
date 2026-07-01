/**
 * Break-glass password reset — for when email delivery isn't configured yet.
 * Requires direct database access (DATABASE_URL), so it's inherently privileged.
 *
 * Usage:
 *   tsx scripts/reset-password.ts <company-slug> <email> <new-password>
 *   npm run admin:reset -- <company-slug> <email> <new-password>
 *
 * On Railway (has the prod DATABASE_URL):
 *   railway run npm run admin:reset -- acme you@example.com 'newpass123'
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [slug, email, password] = process.argv.slice(2);
  if (!slug || !email || !password) {
    console.error(
      "Usage: tsx scripts/reset-password.ts <company-slug> <email> <new-password>",
    );
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`No company with slug "${slug}".`);
    const all = await prisma.tenant.findMany({ select: { slug: true, name: true } });
    console.error("Available companies:", all.map((t) => `${t.slug} (${t.name})`).join(", ") || "(none)");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: email.toLowerCase() },
  });
  if (!user) {
    console.error(`No user "${email}" in company "${slug}".`);
    const members = await prisma.user.findMany({
      where: { tenantId: tenant.id },
      select: { email: true, role: true },
    });
    console.error("Members:", members.map((m) => `${m.email} (${m.role})`).join(", ") || "(none)");
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, 12), status: "ACTIVE" },
  });
  // invalidate any outstanding reset tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: { tenantId: tenant.id, actorId: user.id, action: "PASSWORD_RESET_CLI", target: user.id },
  });

  console.log(`✅ Password updated for ${user.name} <${user.email}> in "${tenant.name}" (@${slug}).`);
  console.log(`   Log in at /login with slug "${slug}", email "${user.email}", and your new password.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
