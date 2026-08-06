// Seed des espaces support : deux comptes agents, une file de tickets, des
// incidents et un pipeline commercial.
//
// Idempotent : upsert sur des identifiants fixes, donc relancer le script
// remet les données dans le même état plutôt que de les dupliquer.
//
// Les valeurs sont choisies pour que les dashboards racontent quelque chose de
// cohérent : des tickets réellement en dépassement de SLA, des résolus datés du
// mois en cours pour alimenter les moyennes, un objectif commercial atteint à
// ~80 %. Un seed « tout propre » afficherait des écrans vides et ne prouverait
// rien.
//
// Usage : npm run seed:support

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ids = {
  supportTech: '3a3a3a3a-0000-4000-8000-000000000001',
  supportCom: '3a3a3a3a-0000-4000-8000-000000000002'
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const periodKey = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));

/// Budget de première réponse par priorité, en minutes — doit rester aligné
/// sur SLA_MINUTES dans support.controller.js.
const SLA_MINUTES = { critical: 60, high: 240, normal: 720, low: 2880 };

function ago(ms) {
  return new Date(now.getTime() - ms);
}

/// Date dans le mois courant, `daysAgo` jours avant aujourd'hui, sans jamais
/// remonter avant le 1er du mois : sinon les compteurs « ce mois » sautent le
/// ticket et les moyennes deviennent fausses en début de mois.
function withinThisMonth(daysAgo) {
  const candidate = ago(daysAgo * DAY);
  return candidate < monthStart ? new Date(monthStart.getTime() + HOUR) : candidate;
}

const agents = [
  {
    id: ids.supportTech,
    email: 'support.tech@procolis.test',
    phone: '+221770000501',
    fullName: 'Awa Ndoye',
    role: 'support_technique',
    city: 'Dakar',
    region: 'Dakar',
    address: 'Point E'
  },
  {
    id: ids.supportCom,
    email: 'support.com@procolis.test',
    phone: '+221770000502',
    fullName: 'Seydou Kane',
    role: 'support_commercial',
    city: 'Dakar',
    region: 'Dakar',
    address: 'Almadies'
  }
];

/// `createdAgo` en heures ; `resolvedDaysAgo` non nul => ticket résolu.
const tickets = [
  {
    reference: 'TK-2601',
    subject: 'Paiement PayDunya non credite',
    category: 'Paiement',
    channel: 'in_app',
    priority: 'critical',
    status: 'in_progress',
    createdAgo: 3 * HOUR,
    firstResponseAgo: 2.5 * HOUR
  },
  {
    reference: 'TK-2602',
    subject: 'Colis marque livre mais non recu',
    category: 'Suivi colis',
    channel: 'phone',
    priority: 'high',
    status: 'open',
    createdAgo: 20 * HOUR
  },
  {
    reference: 'TK-2603',
    subject: 'Impossible de recevoir le code PIN',
    category: 'Compte / PIN',
    channel: 'in_app',
    priority: 'normal',
    status: 'pending',
    createdAgo: 30 * HOUR,
    firstResponseAgo: 28 * HOUR
  },
  {
    reference: 'TK-2604',
    subject: "L'application se ferme au scan QR",
    category: 'Bug appli',
    channel: 'email',
    priority: 'high',
    status: 'open',
    createdAgo: 6 * HOUR
  },
  {
    reference: 'TK-2605',
    subject: 'Erreur de montant sur la commission',
    category: 'Paiement',
    channel: 'in_app',
    priority: 'normal',
    status: 'in_progress',
    createdAgo: 9 * HOUR,
    firstResponseAgo: 8 * HOUR
  },
  {
    reference: 'TK-2606',
    subject: 'Notification push jamais recue',
    category: 'Bug appli',
    channel: 'in_app',
    priority: 'low',
    status: 'resolved',
    createdAgo: 4 * DAY,
    firstResponseAgo: 4 * DAY - 40 * MINUTE,
    resolvedDaysAgo: 3,
    satisfactionScore: 5
  },
  {
    reference: 'TK-2607',
    subject: 'Retrait de portefeuille bloque',
    category: 'Paiement',
    channel: 'phone',
    priority: 'high',
    status: 'resolved',
    createdAgo: 6 * DAY,
    firstResponseAgo: 6 * DAY - 25 * MINUTE,
    resolvedDaysAgo: 5,
    satisfactionScore: 4
  },
  {
    reference: 'TK-2608',
    subject: 'Chauffeur injoignable depuis 2 h',
    category: 'Suivi colis',
    channel: 'in_app',
    priority: 'critical',
    status: 'resolved',
    createdAgo: 2 * DAY,
    firstResponseAgo: 2 * DAY - 12 * MINUTE,
    resolvedDaysAgo: 2,
    satisfactionScore: 5
  },
  {
    reference: 'TK-2609',
    subject: 'Demande de remboursement express',
    category: 'Paiement',
    channel: 'email',
    priority: 'normal',
    status: 'resolved',
    createdAgo: 8 * DAY,
    firstResponseAgo: 8 * DAY - 90 * MINUTE,
    resolvedDaysAgo: 7,
    satisfactionScore: 3
  },
  {
    reference: 'TK-2610',
    subject: 'Le suivi ne se met plus a jour',
    category: 'Suivi colis',
    channel: 'in_app',
    priority: 'normal',
    status: 'resolved',
    createdAgo: 1 * DAY,
    firstResponseAgo: 1 * DAY - 35 * MINUTE,
    resolvedDaysAgo: 0,
    satisfactionScore: 5
  }
];

const incidents = [
  {
    title: 'Webhook PayDunya en echec',
    scope: 'Paiements · confirmations retardees',
    severity: 'sev1',
    mitigated: false,
    impactedUsers: 240,
    startedAgo: 90 * MINUTE
  },
  {
    title: 'Latence sur la creation de colis',
    scope: 'API · endpoint /client/parcels',
    severity: 'sev2',
    mitigated: true,
    impactedUsers: 85,
    startedAgo: 5 * HOUR
  },
  {
    // Résolu : ne doit pas apparaître dans la liste par défaut.
    title: 'Notifications push non delivrees (Android 12)',
    scope: 'FCM · appareils Android 12',
    severity: 'sev3',
    mitigated: true,
    impactedUsers: 38,
    startedAgo: 6 * DAY,
    resolvedAgo: 5 * DAY
  }
];

const leads = [
  {
    name: 'Garage Baobab Transport',
    city: 'Thies',
    kind: 'garage',
    stage: 'negotiation',
    monthlyValue: 450000,
    contactName: 'M. Sy',
    contactPhone: '+221770001001',
    followUpInDays: -3
  },
  {
    name: 'Boutique Keur Massar',
    city: 'Dakar',
    kind: 'business_client',
    stage: 'qualified',
    monthlyValue: 180000,
    contactName: 'Mme Fall',
    contactPhone: '+221770001002',
    followUpInDays: 2
  },
  {
    name: 'Cooperative Ndiaye & Fils',
    city: 'Kaolack',
    kind: 'business_client',
    stage: 'contacted',
    monthlyValue: 95000,
    contactName: 'M. Ndour',
    contactPhone: '+221770001003',
    followUpInDays: -1
  },
  {
    name: 'Flotte Senegal Express',
    city: 'Dakar',
    kind: 'driver_fleet',
    stage: 'negotiation',
    monthlyValue: 720000,
    contactName: 'Mme Ba',
    contactPhone: '+221770001004',
    followUpInDays: 5
  },
  {
    name: 'Pharmacie Sacre-Coeur',
    city: 'Dakar',
    kind: 'business_client',
    stage: 'signed',
    monthlyValue: 260000,
    contactName: 'M. Gueye',
    contactPhone: '+221770001005',
    signedDaysAgo: 6
  },
  {
    name: 'Garage Central Kaolack',
    city: 'Kaolack',
    kind: 'garage',
    stage: 'signed',
    monthlyValue: 540000,
    contactName: 'Mme Thiam',
    contactPhone: '+221770001006',
    signedDaysAgo: 12
  },
  {
    name: 'Transports Touba Freres',
    city: 'Touba',
    kind: 'driver_fleet',
    stage: 'signed',
    monthlyValue: 380000,
    contactName: 'M. Sy',
    contactPhone: '+221770001007',
    signedDaysAgo: 2
  },
  {
    name: 'Marche Tilene Grossiste',
    city: 'Dakar',
    kind: 'business_client',
    stage: 'qualified',
    monthlyValue: 140000,
    contactName: 'Mme Fall',
    contactPhone: '+221770001008',
    followUpInDays: 8
  }
];

async function main() {
  // --- Agents ---
  const created = {};
  for (const agent of agents) {
    const pinHash = await bcrypt.hash('123456', 12);
    const passwordHash = await bcrypt.hash('Password123!', 12);
    const shared = {
      email: agent.email,
      fullName: agent.fullName,
      role: agent.role,
      status: 'active',
      address: agent.address,
      city: agent.city,
      region: agent.region,
      pinHash,
      passwordHash,
      isEmailVerified: true,
      isPhoneVerified: true,
      isVerified: true,
      isProfileComplete: true
    };

    created[agent.role] = await prisma.user.upsert({
      where: { phone: agent.phone },
      update: shared,
      create: { id: agent.id, phone: agent.phone, ...shared }
    });
    console.log(`✔ agent ${agent.role} → ${agent.email}`);
  }

  const techAgent = created.support_technique;
  const comAgent = created.support_commercial;

  // Demandeurs : on réutilise les comptes existants pour que les tickets
  // affichent un vrai nom et un vrai rôle côté mobile.
  const requesters = await prisma.user.findMany({
    where: { role: { in: ['client', 'driver', 'admin'] }, deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 6
  });

  // --- Tickets ---
  for (const [index, ticket] of tickets.entries()) {
    const createdAt = ago(ticket.createdAgo);
    const resolvedAt =
      ticket.resolvedDaysAgo === undefined ? null : withinThisMonth(ticket.resolvedDaysAgo);
    
    const data = {
      reference: ticket.reference,
      subject: ticket.subject,
      body: ticket.category ? `Catégorie: ${ticket.category}` : null,
      category: ticket.category || null,
      channel: ticket.channel,
      priority: ticket.priority,
      status: ticket.status,
      createdAt,
      slaDueAt: new Date(createdAt.getTime() + SLA_MINUTES[ticket.priority] * MINUTE),
      firstResponseAt: ticket.firstResponseAgo ? ago(ticket.firstResponseAgo) : null,
      resolvedAt,
      satisfactionScore: ticket.satisfactionScore ?? null,
      requesterId: requesters.length ? requesters[index % requesters.length].id : null,
      assigneeId: ticket.status === 'open' ? null : techAgent.id
    };

    await prisma.supportTicket.upsert({
      where: { reference: ticket.reference },
      update: data,
      create: data
    });
  }
  console.log(`✔ ${tickets.length} tickets`);

  // --- Incidents ---
  // Pas de clé naturelle unique : on repart d'une table vide pour rester
  // idempotent sans créer de doublons à chaque exécution.
  await prisma.platformIncident.deleteMany({});
  for (const incident of incidents) {
    await prisma.platformIncident.create({
      data: {
        title: incident.title,
        scope: incident.scope,
        severity: incident.severity,
        mitigated: incident.mitigated,
        impactedUsers: incident.impactedUsers,
        startedAt: ago(incident.startedAgo),
        resolvedAt: incident.resolvedAgo ? ago(incident.resolvedAgo) : null,
        createdById: techAgent.id
      }
    });
  }
  console.log(`✔ ${incidents.length} incidents (dont 1 resolu, masque par defaut)`);

  // --- Pipeline commercial ---
  await prisma.commercialLead.deleteMany({ where: { ownerId: comAgent.id } });
  for (const lead of leads) {
    await prisma.commercialLead.create({
      data: {
        name: lead.name,
        city: lead.city || null,
        kind: lead.kind,
        stage: lead.stage,
        monthlyValue: lead.monthlyValue,
        contactName: lead.contactName || null,
        contactPhone: lead.contactPhone || null,
        nextFollowUpAt:
          lead.followUpInDays === undefined
            ? null
            : new Date(now.getTime() + lead.followUpInDays * DAY),
        signedAt: lead.signedDaysAgo === undefined ? null : withinThisMonth(lead.signedDaysAgo),
        notes: null,
        ownerId: comAgent.id
      }
    });
  }
  console.log(`✔ ${leads.length} prospects`);

  // --- Objectif du mois ---
  // Les 3 contrats signés pèsent 1 180 000 F ; un objectif de 1 500 000 F situe
  // l'agent à ~79 %, donc une jauge lisible plutôt que 0 % ou 100 %.
  await prisma.commercialObjective.upsert({
    where: { 
      ownerId_period: { 
        ownerId: comAgent.id, 
        period: periodKey 
      } 
    },
    update: { 
      targetAmount: 1500000, 
      territory: 'Thies · Diourbel · Mbour' 
    },
    create: {
      ownerId: comAgent.id,
      period: periodKey,
      targetAmount: 1500000,
      territory: 'Thies · Diourbel · Mbour'
    }
  });
  console.log('✔ objectif commercial du mois');
}

main()
  .catch((error) => {
    console.error('Seed support en echec:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });