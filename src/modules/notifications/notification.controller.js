import { prisma } from '../../config/prisma.js';
import { ok, fail } from '../../utils/api-response.js';
import { getPagination, paginationMeta } from '../../utils/pagination.js';

export async function listNotifications(req, res) {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const where = { userId: req.user.id };
    const [notifications, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.notification.count({ where })
    ]);

    return ok(res, {
      message: 'Notifications',
      data: { data: notifications, notifications },
      meta: paginationMeta({ page, limit, total })
    });
  } catch (error) {
    req.log.error(
      { error, action: 'notification.list', userId: req.user?.id, requestId: req.requestId },
      'Failed to list notifications'
    );

    return fail(res, { status: 500, message: 'Impossible de charger les notifications' });
  }
}

export async function unreadCount(req, res) {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false }
    });

    return ok(res, {
      message: 'Nombre de notifications non lues',
      data: { count, unreadCount: count }
    });
  } catch (error) {
    req.log.error(
      { error, action: 'notification.unreadCount', userId: req.user?.id, requestId: req.requestId },
      'Failed to count unread notifications'
    );

    return fail(res, { status: 500, message: 'Impossible de compter les notifications' });
  }
}

export async function markAsRead(req, res) {
  try {
    const notification = await prisma.notification.updateMany({
      where: { id: req.params.notificationId, userId: req.user.id },
      data: { isRead: true, readAt: new Date() }
    });

    return ok(res, {
      message: 'Notification marquee comme lue',
      data: { updated: notification.count }
    });
  } catch (error) {
    req.log.error(
      {
        error,
        action: 'notification.markAsRead',
        notificationId: req.params.notificationId,
        userId: req.user?.id,
        requestId: req.requestId
      },
      'Failed to mark notification as read'
    );

    return fail(res, { status: 500, message: 'Impossible de mettre a jour la notification' });
  }
}

export async function markAllAsRead(req, res) {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true, readAt: new Date() }
    });

    return ok(res, {
      message: 'Notifications marquees comme lues',
      data: { updated: result.count }
    });
  } catch (error) {
    req.log.error(
      { error, action: 'notification.markAllAsRead', userId: req.user?.id, requestId: req.requestId },
      'Failed to mark all notifications as read'
    );

    return fail(res, { status: 500, message: 'Impossible de mettre a jour les notifications' });
  }
}

export async function deleteNotification(req, res) {
  try {
    await prisma.notification.deleteMany({
      where: { id: req.params.notificationId, userId: req.user.id }
    });

    return ok(res, {
      message: 'Notification supprimee',
      data: { deleted: true }
    });
  } catch (error) {
    req.log.error(
      {
        error,
        action: 'notification.delete',
        notificationId: req.params.notificationId,
        userId: req.user?.id,
        requestId: req.requestId
      },
      'Failed to delete notification'
    );

    return fail(res, { status: 500, message: 'Impossible de supprimer la notification' });
  }
}

export async function deleteAllNotifications(req, res) {
  try {
    const result = await prisma.notification.deleteMany({
      where: { userId: req.user.id }
    });

    return ok(res, {
      message: 'Notifications supprimees',
      data: { deleted: result.count }
    });
  } catch (error) {
    req.log.error(
      { error, action: 'notification.deleteAll', userId: req.user?.id, requestId: req.requestId },
      'Failed to delete all notifications'
    );

    return fail(res, { status: 500, message: 'Impossible de supprimer les notifications' });
  }
}

export async function getPreferences(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { notificationPreferences: true }
    });
    return ok(res, {
      message: 'Preferences de notification',
      data: { preferences: user?.notificationPreferences ?? {} }
    });
  } catch (error) {
    req.log.error(
      { error, action: 'notification.getPreferences', userId: req.user?.id, requestId: req.requestId },
      'Failed to load notification preferences'
    );
    return fail(res, { status: 500, message: 'Impossible de charger les preferences' });
  }
}

export async function updatePreferences(req, res) {
  try {
    const prefs = req.body?.preferences ?? req.body ?? {};
    // Accepte un objet (map type→canaux) OU un tableau ([{eventType, channels}]).
    if (prefs === null || typeof prefs !== 'object') {
      return fail(res, { status: 422, message: 'Preferences invalides', code: 'VALIDATION_ERROR' });
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { notificationPreferences: prefs },
      select: { notificationPreferences: true }
    });
    return ok(res, {
      message: 'Preferences mises a jour',
      data: { preferences: user.notificationPreferences ?? {} }
    });
  } catch (error) {
    req.log.error(
      { error, action: 'notification.updatePreferences', userId: req.user?.id, requestId: req.requestId },
      'Failed to update notification preferences'
    );
    return fail(res, { status: 500, message: 'Impossible de mettre a jour les preferences' });
  }
}
