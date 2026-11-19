// Seed du referentiel `incident_severity_levels`.
//
// Les quatre codes classiques (low/medium/high/critical) accompagnent un
// SLA de reponse exprime en heures, repris sur les tableaux de bord Ops.
// L'enum Prisma `IncidentSeverity` (sev1..sev3) reste utilise cote DB pour
// les incidents existants ; la table expose une vue utilisateur plus riche.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const items = [
  { code: 'low',      label: 'Faible',   color: '#22c55e', slaHours: 72, sortOrder: 10 },
  { code: 'medium',   label: 'Moyen',    color: '#f97316', slaHours: 24, sortOrder: 20 },
  { code: 'high',     label: 'Élevé',    color: '#ef4444', slaHours: 6,  sortOrder: 30 },
  { code: 'critical', label: 'Critique', color: '#111827', slaHours: 1,  sortOrder: 40 }
];

export async function seedIncidentSeverities() {
  for (const item of items) {
    await prisma.incidentSeverityLevel.upsert({
      where: { code: item.code },
      update: {
        label: item.label,
        color: item.color,
        slaHours: item.slaHours,
        sortOrder: item.sortOrder
      },
      create: { ...item, isActive: true }
    });
  }
  console.log(`[seed] incident_severity_levels: ${items.length} entrees synchronisees`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedIncidentSeverities()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
