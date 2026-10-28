import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRoles } from "../../middlewares/rbac.middleware.js";
import { ok, fail } from "../../utils/api-response.js";
export const qualityRouter = Router();
qualityRouter.get(
  "/",
  authenticate,
  requireRoles("super_admin", "support_technique"),
  async (req, res) => {
    try {
      const now = new Date(),
        since = new Date(now.getTime() - 30 * 86400000),
        abandonedBefore = new Date(now.getTime() - 24 * 3600000);
      const [
        created,
        delivered,
        overdue,
        payments,
        tickets,
        attempts,
        responseTime,
      ] = await Promise.all([
        prisma.parcel.count({
          where: { createdAt: { gte: since }, deletedAt: null },
        }),
        prisma.parcel.count({
          where: {
            deliveryDate: { gte: since },
            status: "delivered",
            deletedAt: null,
          },
        }),
        prisma.parcel.count({
          where: {
            estimatedDeliveryDate: { lt: now },
            status: { notIn: ["delivered", "cancelled"] },
            deletedAt: null,
          },
        }),
        prisma.payment.groupBy({
          by: ["status"],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.supportTicket.groupBy({
          by: ["status"],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        // Une soumission sans événement client de fin peut avoir réussi : vérifier
        // le journal serveur avant de la compter comme abandon présumé.
        prisma.$queryRaw`SELECT COUNT(*)::int AS started, COUNT(*) FILTER (WHERE e.created_at < ${abandonedBefore} AND NOT EXISTS (
        SELECT 1 FROM operation_requests r WHERE r.actor_id=e.user_id AND r.request_id=e.attempt_id AND r.scope='parcel.create'
      ) AND NOT EXISTS (SELECT 1 FROM journey_events c WHERE c.user_id=e.user_id AND c.attempt_id=e.attempt_id AND c.event='creation_completed'))::int AS abandoned
      FROM journey_events e WHERE e.event='creation_started' AND e.created_at>=${since}`,
        // Mesurer un message de réponse réel, pas un simple changement de statut.
        prisma.$queryRaw`SELECT AVG(EXTRACT(EPOCH FROM (reply.at-start.at))/60)::float AS minutes, COUNT(*)::int AS sample
      FROM support_chat_conversations c
      JOIN LATERAL (SELECT MIN(created_at) AS at FROM support_chat_entries WHERE conversation_id=c.id AND from_support=false AND deleted_at IS NULL) start ON start.at>=${since}
      JOIN LATERAL (SELECT MIN(created_at) AS at FROM support_chat_entries WHERE conversation_id=c.id AND from_support=true AND deleted_at IS NULL AND created_at>=start.at) reply ON reply.at IS NOT NULL`,
      ]);
      res.set("Cache-Control", "private, no-store");
      return ok(res, {
        data: {
          quality: {
            since,
            created,
            delivered,
            overdue,
            payments: Object.fromEntries(
              payments.map((p) => [p.status, p._count._all]),
            ),
            tickets: Object.fromEntries(
              tickets.map((t) => [t.status, t._count._all]),
            ),
            creationAttempts: attempts[0],
            firstResponse: responseTime[0],
          },
        },
      });
    } catch (error) {
      req.log.error(
        {
          action: "quality.dashboard",
          errorName: error.name,
          errorCode: error.code,
          userId: req.user?.id,
          requestId: req.requestId,
        },
        "Quality metrics unavailable",
      );
      return fail(res, {
        status: 503,
        code: "QUALITY_UNAVAILABLE",
        message: "Indicateurs temporairement indisponibles",
      });
    }
  },
);
