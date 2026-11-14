#!/usr/bin/env node
/**
 * Script CLI de promotion de rôle (OPS-2).
 *
 * Usage :
 *   node scripts/promote-role.mjs --userId <uuid> --role <role>
 *   node scripts/promote-role.mjs --phone <phone> --role shuttle_operator
 *
 * Variables d'env :
 *   DATABASE_URL — URL Postgres (requis)
 *
 * Rôles autorisés : client, driver, admin, support, support_technique,
 * support_commercial, shuttle_operator. super_admin n'est jamais assigné
 * via ce script — il nécessite un seed dédié.
 */

import { PrismaClient } from '@prisma/client';

const ASSIGNABLE_ROLES = ['client', 'driver', 'admin', 'support', 'support_technique', 'support_commercial', 'shuttle_operator'];

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, '');
    const value = process.argv[i + 1];
    if (!key || !value) continue;
    args[key] = value;
  }
  return args;
}

async function main() {
  const { userId, phone, role } = parseArgs();
  if (!role || !ASSIGNABLE_ROLES.includes(role)) {
    console.error(`[promote-role] --role requis. Rôles autorisés : ${ASSIGNABLE_ROLES.join(', ')}`);
    process.exit(1);
  }
  if (!userId && !phone) {
    console.error('[promote-role] --userId ou --phone requis');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const where = userId ? { id: userId } : { phone };
    const user = await prisma.user.findFirst({
      where,
      select: { id: true, phone: true, fullName: true, role: true }
    });
    if (!user) {
      console.error(`[promote-role] Utilisateur introuvable (${userId ?? phone})`);
      process.exit(2);
    }
    if (user.role === 'super_admin') {
      console.error('[promote-role] Refusé : super_admin non modifiable via ce script');
      process.exit(3);
    }
    if (user.role === role) {
      console.log(`[promote-role] ${user.fullName} (${user.phone}) a déjà le rôle ${role} — aucune action.`);
      return;
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role }
    });
    console.log(`[promote-role] OK : ${updated.fullName} (${updated.phone}) : ${user.role} → ${updated.role}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[promote-role] Erreur :', err?.message ?? err);
  process.exit(10);
});
