// Espaces support technique et support commercial.
//
// Les deux rôles partagent ce module mais pas leurs permissions : le technique
// traite tickets et incidents, le commercial son pipeline. Les gardes vivent
// dans support.routes.js.

import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/api-response.js';
import { getPagination, paginationMeta } from '../../utils/pagination.js';
import { NotFoundError, ValidationError, normalizeError } from '../../utils/errors.js';
import { serializeUser } from '../../utils/mobile-serializers.js';

function cleanUndefined(data) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log.error(
        {
          error,
          action,
          userId: req.user?.id,
          role: req.user?.role,
          requestId: req.requestId
        },
        `Support endpoint failed: ${action}`
      );

      return fail(res, {
        status: normalized?.statusCode || 500,
        message:
          normalized?.publicMessage ||
          (env.NODE_ENV === 'production' ? 'Operation impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || []
      });
    }
  };
}

// ============================================================
// Helpers de période
// ============================================================

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/// Premier jour du mois en UTC, pour la colonne `period` de type DATE.
/// Un minuit local sous fuseau négatif serait converti en UTC vers le mois
/// précédent, et l'objectif du mois ne serait jamais retrouvé.
function periodKey(date = new Date()) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
}

function startOfToday(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/// Budget de première réponse par priorité, en minutes. Sert à recalculer une
/// échéance quand la priorité d'un ticket change.
const SLA_MINUTES = {
  critical: 60,
  high: 240,
  normal: 720,
  low: 2880
};

// ============================================================
// Sérialisation
// ============================================================

function serializeTicket(ticket) {
  if (!ticket) return null;

  const now = Date.now();
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt).getTime() : now;
  const slaDue = ticket.slaDueAt ? new Date(ticket.slaDueAt).getTime() : null;

  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    body: ticket.body,
    channel: ticket.channel,
    priority: ticket.priority,
    status: ticket.status,
    category: ticket.category,
    // Le client affiche « ouvert depuis » et « SLA dans » : les calculer ici
    // évite que l'horloge du téléphone fasse dériver l'affichage.
    ageMinutes: Math.max(0, Math.round((now - createdAt) / 60000)),
    slaRemainingMinutes: slaDue === null ? null : Math.round((slaDue - now) / 60000),
    slaDueAt: ticket.slaDueAt,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    satisfactionScore: ticket.satisfactionScore,
    requesterId: ticket.requesterId,
    requesterName: ticket.requester?.fullName ?? null,
    requesterRole: ticket.requester?.role ?? null,
    assigneeId: ticket.assigneeId,
    assigneeName: ticket.assignee?.fullName ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt
  };
}

function serializeIncident(incident) {
  if (!incident) return null;

  const now = Date.now();
  const startedAt = incident.startedAt ? new Date(incident.startedAt).getTime() : now;

  return {
    id: incident.id,
    title: incident.title,
    scope: incident.scope,
    severity: incident.severity,
    mitigated: incident.mitigated,
    impactedUsers: incident.impactedUsers,
    sinceMinutes: Math.max(0, Math.round((now - startedAt) / 60000)),
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    createdAt: incident.createdAt
  };
}

function serializeLead(lead) {
  if (!lead) return null;

  let daysToFollowUp = null;
  if (lead.nextFollowUpAt) {
    // Comparaison en jours calendaires : `next_follow_up_at` est un DATE, une
    // soustraction d'horodatages renverrait des fractions de jour trompeuses.
    const target = new Date(lead.nextFollowUpAt);
    const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
    const today = new Date();
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    daysToFollowUp = Math.round((targetDay - todayDay) / 86400000);
  }

  return {
    id: lead.id,
    name: lead.name,
    city: lead.city,
    kind: lead.kind,
    stage: lead.stage,
    monthlyValue: Number(lead.monthlyValue ?? 0),
    contactName: lead.contactName,
    contactPhone: lead.contactPhone,
    nextFollowUpAt: lead.nextFollowUpAt,
    daysToFollowUp,
    signedAt: lead.signedAt,
    notes: lead.notes,
    ownerId: lead.ownerId,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt
  };
}

const ticketInclude = {
  requester: { select: { id: true, fullName: true, role: true } },
  assignee: { select: { id: true, fullName: true, role: true } }
};

// ============================================================
// Profil (commun aux deux rôles)
// ============================================================

export const updateSupportProfile = handle('support.profile.update', async (req, res) => {
  const allowed = ['fullName', 'email', 'phone', 'address', 'city', 'region', 'gender', 'profilePhoto'];
  const data = cleanUndefined(Object.fromEntries(allowed.map((key) => [key, req.body[key]])));

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    include: { garage: true }
  });

  return ok(res, { message: 'Profil mis a jour', data: { user: serializeUser(user) } });
});

// ============================================================
// Support technique — statistiques
// ============================================================

export const supportTechniqueStats = handle('support.technique.stats', async (req, res) => {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const todayStart = startOfToday(now);
  const openStatuses = ['open', 'pending', 'in_progress'];

  const [openTickets, resolvedToday, resolvedMonth, slaAtRisk, openIncidents, resolvedSample, categoryGroups, weekTickets] =
    await Promise.all([
      prisma.supportTicket.count({ where: { status: { in: openStatuses } } }),
      prisma.supportTicket.count({ where: { status: 'resolved', resolvedAt: { gte: todayStart } } }),
      prisma.supportTicket.count({ where: { status: 'resolved', resolvedAt: { gte: monthStart } } }),
      // « En risque » = échéance dépassée sur un ticket encore ouvert.
      prisma.supportTicket.count({
        where: { status: { in: openStatuses }, slaDueAt: { lt: now } }
      }),
      prisma.platformIncident.count({ where: { resolvedAt: null } }),
      // Moyennes calculées en JS : Prisma ne sait pas faire AVG sur une
      // différence entre deux colonnes de dates.
      prisma.supportTicket.findMany({
        where: { status: 'resolved', resolvedAt: { gte: monthStart } },
        select: { createdAt: true, firstResponseAt: true, resolvedAt: true, satisfactionScore: true }
      }),
      prisma.supportTicket.groupBy({
        by: ['category'],
        where: { createdAt: { gte: monthStart } },
        _count: { _all: true }
      }),
      prisma.supportTicket.findMany({
        where: { createdAt: { gte: new Date(todayStart.getTime() - 6 * 86400000) } },
        select: { createdAt: true }
      })
    ]);

  let firstResponseMinutes = 0;
  let responseSamples = 0;
  let resolutionHours = 0;
  let resolutionSamples = 0;
  let satisfactionTotal = 0;
  let satisfactionSamples = 0;

  for (const ticket of resolvedSample) {
    if (ticket.firstResponseAt) {
      firstResponseMinutes += (new Date(ticket.firstResponseAt) - new Date(ticket.createdAt)) / 60000;
      responseSamples += 1;
    }
    if (ticket.resolvedAt) {
      resolutionHours += (new Date(ticket.resolvedAt) - new Date(ticket.createdAt)) / 3600000;
      resolutionSamples += 1;
    }
    if (ticket.satisfactionScore) {
      satisfactionTotal += ticket.satisfactionScore;
      satisfactionSamples += 1;
    }
  }

  // Volume des 7 derniers jours, du plus ancien au plus récent.
  const weeklyValues = Array(7).fill(0);
  for (const ticket of weekTickets) {
    const created = new Date(ticket.createdAt);
    const dayStart = new Date(created.getFullYear(), created.getMonth(), created.getDate());
    const index = 6 - Math.round((todayStart - dayStart) / 86400000);
    if (index >= 0 && index < 7) weeklyValues[index] += 1;
  }

  const weekdayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const labels = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(todayStart.getTime() - i * 86400000);
    labels.push(weekdayLabels[(day.getDay() + 6) % 7]);
  }

  return ok(res, {
    message: 'Statistiques support technique',
    data: {
      stats: {
        openTickets,
        resolvedToday,
        resolvedThisMonth: resolvedMonth,
        firstResponseMinutes: responseSamples ? Math.round(firstResponseMinutes / responseSamples) : 0,
        resolutionHours: resolutionSamples
          ? Math.round((resolutionHours / resolutionSamples) * 10) / 10
          : 0,
        // Note sur 5 ramenée en pourcentage ; pas d'avis => pas de score
        // inventé, on renvoie null et le client affiche un tiret.
        satisfactionPercent: satisfactionSamples
          ? Math.round((satisfactionTotal / satisfactionSamples / 5) * 100)
          : null,
        slaAtRisk,
        openIncidents,
        weeklySeries: { values: weeklyValues, labels, unit: 'tickets' },
        categories: categoryGroups
          .filter((group) => group.category)
          .map((group) => ({ label: group.category, count: group._count._all }))
          .sort((a, b) => b.count - a.count)
      }
    }
  });
});

// ============================================================
// Support technique — tickets
// ============================================================

export const listTickets = handle('support.technique.tickets', async (req, res) => {
  const { skip, page, limit } = getPagination(req.query);
  const { status, priority, assignee } = req.query;

  const where = cleanUndefined({
    status: status || undefined,
    priority: priority || undefined,
    assigneeId: assignee === 'me' ? req.user.id : assignee || undefined
  });

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: ticketInclude,
      // Ordre de traitement : les tickets encore actifs d'abord
      // (`resolvedAt` null), puis l'échéance la plus proche. Trier d'emblée par
      // SLA remontait des tickets résolus de longue date en tête de file.
      // `nulls: 'last'` sur slaDueAt évite que les tickets sans échéance
      // squattent le haut.
      orderBy: [
        { resolvedAt: { sort: 'asc', nulls: 'first' } },
        { slaDueAt: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' }
      ],
      skip,
      take: limit
    }),
    prisma.supportTicket.count({ where })
  ]);

  return ok(res, {
    message: 'Tickets support',
    data: { tickets: tickets.map(serializeTicket) },
    meta: paginationMeta({ page, limit, total })
  });
});

export const getTicket = handle('support.technique.ticketDetail', async (req, res) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.ticketId },
    include: ticketInclude
  });

  if (!ticket) throw new NotFoundError('Ticket introuvable');

  return ok(res, { message: 'Ticket', data: { ticket: serializeTicket(ticket) } });
});

export const updateTicket = handle('support.technique.ticketUpdate', async (req, res) => {
  const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.ticketId } });
  if (!existing) throw new NotFoundError('Ticket introuvable');

  const { status, priority, assigneeId, category } = req.body;

  const data = cleanUndefined({
    status: status || undefined,
    priority: priority || undefined,
    assigneeId: assigneeId === null ? null : assigneeId || undefined,
    category: category || undefined
  });

  if (Object.keys(data).length === 0) {
    throw new ValidationError([], 'Aucun champ modifiable fourni');
  }

  // Changer la priorité redéfinit l'échéance : garder l'ancienne rendrait
  // l'alerte SLA incohérente avec le budget affiché.
  if (priority && priority !== existing.priority && SLA_MINUTES[priority]) {
    data.slaDueAt = new Date(new Date(existing.createdAt).getTime() + SLA_MINUTES[priority] * 60000);
  }

  // Horodater la résolution, sinon les compteurs « résolus ce mois » et les
  // moyennes de résolution resteraient vides.
  if (status === 'resolved' && !existing.resolvedAt) {
    data.resolvedAt = new Date();
  }
  if (status && status !== 'resolved') {
    data.resolvedAt = null;
  }

  // Première prise en charge par un agent : sert au calcul du délai de
  // première réponse.
  if (!existing.firstResponseAt && (status === 'in_progress' || assigneeId)) {
    data.firstResponseAt = new Date();
  }

  // Prendre un ticket en charge sans titulaire l'assigne à l'agent qui agit :
  // un ticket « en cours » que personne ne détient n'est pas suivable, et
  // n'apparaîtrait dans aucun filtre `assignee=me`.
  if (status === 'in_progress' && !existing.assigneeId && assigneeId === undefined) {
    data.assigneeId = req.user.id;
  }

  const ticket = await prisma.supportTicket.update({
    where: { id: existing.id },
    data,
    include: ticketInclude
  });

  return ok(res, { message: 'Ticket mis a jour', data: { ticket: serializeTicket(ticket) } });
});

// ============================================================
// Support technique — incidents
// ============================================================

export const listIncidents = handle('support.technique.incidents', async (req, res) => {
  // Par défaut seuls les incidents ouverts : c'est ce que le dashboard montre.
  const includeResolved = String(req.query.includeResolved || '') === 'true';

  const incidents = await prisma.platformIncident.findMany({
    where: includeResolved ? {} : { resolvedAt: null },
    orderBy: [{ severity: 'asc' }, { startedAt: 'desc' }]
  });

  return ok(res, {
    message: 'Incidents plateforme',
    data: { incidents: incidents.map(serializeIncident) }
  });
});

export const createIncident = handle('support.technique.incidentCreate', async (req, res) => {
  const { title, scope, severity, impactedUsers, mitigated } = req.body;

  if (!title || !scope || !severity) {
    throw new ValidationError(
      [
        !title ? { path: 'title', message: 'Titre requis' } : null,
        !scope ? { path: 'scope', message: 'Perimetre requis' } : null,
        !severity ? { path: 'severity', message: 'Severite requise' } : null
      ].filter(Boolean),
      'Incident incomplet'
    );
  }

  const incident = await prisma.platformIncident.create({
    data: {
      title,
      scope,
      severity,
      impactedUsers: Number(impactedUsers) || 0,
      mitigated: Boolean(mitigated),
      createdById: req.user.id
    }
  });

  return ok(res, {
    status: 201,
    message: 'Incident declare',
    data: { incident: serializeIncident(incident) }
  });
});

export const updateIncident = handle('support.technique.incidentUpdate', async (req, res) => {
  const existing = await prisma.platformIncident.findUnique({ where: { id: req.params.incidentId } });
  if (!existing) throw new NotFoundError('Incident introuvable');

  const { title, scope, severity, impactedUsers, mitigated, resolved } = req.body;

  const data = cleanUndefined({
    title: title || undefined,
    scope: scope || undefined,
    severity: severity || undefined,
    impactedUsers: impactedUsers === undefined ? undefined : Number(impactedUsers) || 0,
    mitigated: mitigated === undefined ? undefined : Boolean(mitigated)
  });

  if (resolved === true && !existing.resolvedAt) data.resolvedAt = new Date();
  if (resolved === false) data.resolvedAt = null;

  if (Object.keys(data).length === 0) {
    throw new ValidationError([], 'Aucun champ modifiable fourni');
  }

  const incident = await prisma.platformIncident.update({ where: { id: existing.id }, data });

  return ok(res, { message: 'Incident mis a jour', data: { incident: serializeIncident(incident) } });
});

// ============================================================
// Support commercial — statistiques
// ============================================================

export const supportCommercialStats = handle('support.commercial.stats', async (req, res) => {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const ownerId = req.user.id;
  const activeStages = ['contacted', 'qualified', 'negotiation'];

  const [activeLeads, signedThisMonth, managedAccounts, overdueFollowUps, signedLeads, objective, sourceGroups, signedYear] =
    await Promise.all([
      prisma.commercialLead.count({ where: { ownerId, stage: { in: activeStages } } }),
      prisma.commercialLead.count({ where: { ownerId, stage: 'signed', signedAt: { gte: monthStart } } }),
      prisma.commercialLead.count({ where: { ownerId } }),
      prisma.commercialLead.count({
        where: { ownerId, stage: { in: activeStages }, nextFollowUpAt: { lt: startOfToday(now) } }
      }),
      prisma.commercialLead.findMany({
        where: { ownerId, stage: 'signed', signedAt: { gte: monthStart } },
        select: { monthlyValue: true, kind: true }
      }),
      prisma.commercialObjective.findUnique({
        where: { ownerId_period: { ownerId, period: periodKey(now) } }
      }),
      prisma.commercialLead.groupBy({
        by: ['kind'],
        where: { ownerId },
        _count: { _all: true }
      }),
      prisma.commercialLead.findMany({
        where: { ownerId, stage: 'signed', signedAt: { gte: new Date(now.getFullYear(), 0, 1) } },
        select: { signedAt: true }
      })
    ]);

  const monthlyRevenue = signedLeads.reduce((sum, lead) => sum + Number(lead.monthlyValue ?? 0), 0);
  const monthlyObjective = objective ? Number(objective.targetAmount) : 0;
  const newZonesSigned = signedLeads.filter((lead) => lead.kind === 'garage').length;

  // 12 mois de l'année en cours.
  const monthlyValues = Array(12).fill(0);
  for (const lead of signedYear) {
    if (!lead.signedAt) continue;
    monthlyValues[new Date(lead.signedAt).getMonth()] += 1;
  }

  const kindLabels = {
    garage: 'Zone / garage',
    business_client: 'Client pro',
    driver_fleet: 'Flotte chauffeurs'
  };

  return ok(res, {
    message: 'Statistiques support commercial',
    data: {
      stats: {
        activeLeads,
        signedThisMonth,
        managedAccounts,
        monthlyRevenue,
        monthlyObjective,
        // Un portefeuille vide ne doit pas afficher 0 % de conversion comme
        // s'il s'agissait d'un mauvais résultat : null => tiret côté client.
        conversionPercent: managedAccounts
          ? Math.round((signedThisMonth / managedAccounts) * 100)
          : null,
        overdueFollowUps,
        newZonesSigned,
        territory: objective?.territory ?? null,
        monthlySeries: {
          values: monthlyValues,
          labels: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'],
          unit: 'contrats'
        },
        sources: sourceGroups.map((group) => ({
          label: kindLabels[group.kind] ?? group.kind,
          count: group._count._all
        }))
      }
    }
  });
});

// ============================================================
// Support commercial — pipeline
// ============================================================

export const listLeads = handle('support.commercial.leads', async (req, res) => {
  const { skip, page, limit } = getPagination(req.query);
  const { stage } = req.query;

  // Un agent ne voit que son portefeuille ; le super admin voit tout.
  const where = cleanUndefined({
    ownerId: req.user.role === 'super_admin' ? undefined : req.user.id,
    stage: stage || undefined
  });

  const [leads, total] = await Promise.all([
    prisma.commercialLead.findMany({
      where,
      orderBy: [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip,
      take: limit
    }),
    prisma.commercialLead.count({ where })
  ]);

  return ok(res, {
    message: 'Pipeline commercial',
    data: { leads: leads.map(serializeLead) },
    meta: paginationMeta({ page, limit, total })
  });
});

export const createLead = handle('support.commercial.leadCreate', async (req, res) => {
  const { name, city, kind, stage, monthlyValue, contactName, contactPhone, nextFollowUpAt, notes } = req.body;

  if (!name) {
    throw new ValidationError([{ path: 'name', message: 'Nom requis' }], 'Prospect incomplet');
  }

  const lead = await prisma.commercialLead.create({
    data: cleanUndefined({
      name,
      city: city || undefined,
      kind: kind || undefined,
      stage: stage || undefined,
      monthlyValue: monthlyValue === undefined ? undefined : Number(monthlyValue) || 0,
      contactName: contactName || undefined,
      contactPhone: contactPhone || undefined,
      nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : undefined,
      notes: notes || undefined,
      ownerId: req.user.id,
      signedAt: stage === 'signed' ? new Date() : undefined
    })
  });

  return ok(res, { status: 201, message: 'Prospect cree', data: { lead: serializeLead(lead) } });
});

export const updateLead = handle('support.commercial.leadUpdate', async (req, res) => {
  const existing = await prisma.commercialLead.findUnique({ where: { id: req.params.leadId } });
  if (!existing) throw new NotFoundError('Prospect introuvable');

  // Un agent ne modifie que son portefeuille.
  if (req.user.role !== 'super_admin' && existing.ownerId !== req.user.id) {
    throw new NotFoundError('Prospect introuvable');
  }

  const { name, city, kind, stage, monthlyValue, contactName, contactPhone, nextFollowUpAt, notes } = req.body;

  const data = cleanUndefined({
    name: name || undefined,
    city: city || undefined,
    kind: kind || undefined,
    stage: stage || undefined,
    monthlyValue: monthlyValue === undefined ? undefined : Number(monthlyValue) || 0,
    contactName: contactName || undefined,
    contactPhone: contactPhone || undefined,
    nextFollowUpAt: nextFollowUpAt === null ? null : nextFollowUpAt ? new Date(nextFollowUpAt) : undefined,
    notes: notes || undefined
  });

  if (Object.keys(data).length === 0) {
    throw new ValidationError([], 'Aucun champ modifiable fourni');
  }

  // Passage à « signé » : horodater, sinon le CA du mois resterait à zéro.
  if (stage === 'signed' && !existing.signedAt) data.signedAt = new Date();
  if (stage && stage !== 'signed') data.signedAt = null;

  const lead = await prisma.commercialLead.update({ where: { id: existing.id }, data });

  return ok(res, { message: 'Prospect mis a jour', data: { lead: serializeLead(lead) } });
});

// ============================================================
// Support commercial — couverture du réseau
// ============================================================

export const coverage = handle('support.commercial.coverage', async (req, res) => {
  // Une zone est « à densifier » si elle compte moins de ce nombre de
  // chauffeurs actifs : en dessous, les délais de livraison décrochent.
  const THIN_COVERAGE = 2;

  const garages = await prisma.garage.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      city: true,
      region: true,
      users: {
        where: { role: 'driver', status: 'active', deletedAt: null },
        select: { id: true }
      }
    },
    orderBy: { name: 'asc' }
  });

  const gaps = garages
    .map((garage) => ({
      id: garage.id,
      name: garage.name,
      city: garage.city,
      region: garage.region,
      activeDrivers: garage.users.length
    }))
    .filter((zone) => zone.activeDrivers < THIN_COVERAGE)
    .map((zone) => ({
      ...zone,
      reason:
        zone.activeDrivers === 0
          ? 'Aucun chauffeur actif'
          : `${zone.activeDrivers} chauffeur seulement · delais degrades`
    }));

  return ok(res, {
    message: 'Couverture du reseau',
    data: {
      coverage: {
        totalZones: garages.length,
        thinThreshold: THIN_COVERAGE,
        gaps
      }
    }
  });
});
