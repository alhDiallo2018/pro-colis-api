import { prisma } from '../../config/prisma.js';
import { ok, fail } from '../../utils/api-response.js';
import { getPagination, paginationMeta } from '../../utils/pagination.js';

export async function listPublicGarages(req, res) {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const [garages, total] = await prisma.$transaction([
      prisma.garage.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ city: 'asc' }, { name: 'asc' }],
        skip,
        take: limit
      }),
      prisma.garage.count({ where: { isActive: true, deletedAt: null } })
    ]);

    return ok(res, {
      message: 'Zones actives',
      data: { data: garages, garages },
      meta: paginationMeta({ page, limit, total })
    });
  } catch (error) {
    req.log.error(
      {
        error,
        action: 'garage.listPublic',
        requestId: req.requestId
      },
      'Failed to list public garages'
    );

    return fail(res, {
      status: 500,
      message: 'Impossible de charger les zones'
    });
  }
}
