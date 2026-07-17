import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { ok, fail } from '../utils/api-response.js'
import { ValidationError, normalizeError } from '../utils/errors.js'
import { sendNotificationEmail, sendNotificationSms, isBrevoConfigured } from '../utils/brevo.js'
import {
  createInvoice as paydunyaCreateInvoice,
  confirmInvoice as paydunyaConfirmInvoice,
  verifyIpnHash
} from '../utils/paydunya.js'

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res)
    } catch (error) {
      const normalized = normalizeError(error)
      req.log?.error?.(
        { error, action, userId: req.user?.id, requestId: req.requestId },
        `PayDunya endpoint failed: ${action}`
      )
      return fail(res, {
        status: normalized?.statusCode || 500,
        message:
          normalized?.publicMessage ||
          (env.NODE_ENV === 'production' ? 'Erreur paiement' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || []
      })
    }
  }
}

function number(val, fallback = 0) {
  if (val === undefined || val === null || val === '') return fallback
  return Number(val)
}

async function getPaydunyaConfig() {
  if (env.PAYDUNYA_MASTER_KEY && env.PAYDUNYA_PRIVATE_KEY && env.PAYDUNYA_TOKEN) {
    return {
      masterKey: env.PAYDUNYA_MASTER_KEY,
      privateKey: env.PAYDUNYA_PRIVATE_KEY,
      token: env.PAYDUNYA_TOKEN,
      mode: env.PAYDUNYA_MODE || 'test'
    }
  }

  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: 'paydunya.' } }
  })
  const cfg = {}
  for (const row of rows) cfg[row.key] = row.value

  if (cfg['paydunya.masterKey'] && cfg['paydunya.privateKey'] && cfg['paydunya.token']) {
    return {
      masterKey: cfg['paydunya.masterKey'],
      privateKey: cfg['paydunya.privateKey'],
      token: cfg['paydunya.token'],
      mode: cfg['paydunya.mode'] || 'test'
    }
  }

  return null
}

async function creditScore(userId, points, token) {
  await prisma.$transaction(async (tx) => {
    await tx.score.upsert({
      where: { userId },
      update: { points: { increment: points }, totalEarned: { increment: points }, lastUpdated: new Date() },
      create: { userId, points, totalEarned: points }
    })
    await tx.scoreTransaction.create({
      data: { userId, amount: points, type: 'purchase', description: `Achat points via PayDunya (${token})` }
    })
    await tx.notification.create({
      data: {
        userId,
        type: 'score_credited',
        title: 'Points crédités',
        body: `${points} points ont été ajoutés à votre compte via PayDunya.`,
        data: { points, token, source: 'paydunya' }
      }
    })
  })
}

async function creditWallet(userId, amount, token) {
  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      update: { balance: { increment: amount }, totalDeposited: { increment: amount }, lastActivityAt: new Date(), lastDepositAt: new Date() },
      create: { userId, balance: amount, totalDeposited: amount, lastDepositAt: new Date(), lastActivityAt: new Date() }
    })
    await tx.walletTransaction.create({
      data: {
        walletUserId: userId,
        type: 'deposit',
        amount,
        balanceBefore: number(wallet.balance) - amount,
        balanceAfter: number(wallet.balance),
        description: `Recharge via PayDunya (${token})`,
        origin: 'paydunya',
        status: 'completed'
      }
    })
    await tx.notification.create({
      data: {
        userId,
        type: 'wallet_recharged',
        title: 'Portefeuille rechargé',
        body: `${amount} FCFA ont été ajoutés à votre portefeuille via PayDunya.`,
        data: { amount, token, source: 'paydunya' }
      }
    })
  })
}

async function createPaymentRecord(userId, parcelId, amount, token) {
  await prisma.payment.create({
    data: {
      userId,
      parcelId: parcelId || null,
      amount,
      currency: 'XOF',
      method: 'card',
      status: 'completed',
      transactionId: token,
      completedAt: new Date(),
      metadata: { source: 'paydunya', token }
    }
  })
}

async function sendNotification(userId, type, title, body, data = {}) {
  await prisma.notification.create({
    data: { userId, type, title, body, data }
  });

  if (isBrevoConfigured()) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phone: true }
    });
    if (user) {
      if (user.email) {
        sendNotificationEmail({ email: user.email, subject: title, message: body }).catch(() => {});
      }
      if (user.phone) {
        const smsContent = body.length > 300 ? `${title}: ${body.substring(0, 300)}...` : `${title}: ${body}`;
        sendNotificationSms({ phone: user.phone, message: smsContent, tag: type }).catch(() => {});
      }
    }
  }
}

async function creditDriverForParcel(parcel, token) {
  const parcelPrice = Number(parcel.price || parcel.totalAmount || 0)
  if (!parcelPrice || !parcel.driverId) return

  const commissionConfigs = await prisma.commissionConfig.findMany({ where: { isActive: true } })
  const commissionCfg = commissionConfigs.find((c) => c.profile === 'local') || commissionConfigs[0]
  let commission = 0
  if (commissionCfg) {
    const pct = Number(commissionCfg.percentage)
    const min = Number(commissionCfg.minAmount)
    const max = Number(commissionCfg.maxAmount)
    commission = Math.max(min, Math.min(Math.round((pct * parcelPrice) / 100), max))
  }
  const driverEarning = Math.max(0, parcelPrice - commission)

  if (driverEarning <= 0) return

  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId: parcel.driverId },
      update: { balance: { increment: driverEarning }, totalDeposited: { increment: driverEarning }, lastActivityAt: new Date(), lastDepositAt: new Date() },
      create: { userId: parcel.driverId, balance: driverEarning, totalDeposited: driverEarning, lastDepositAt: new Date(), lastActivityAt: new Date() }
    })
    await tx.walletTransaction.create({
      data: {
        walletUserId: parcel.driverId,
        type: 'deposit',
        amount: driverEarning,
        balanceBefore: Number(wallet.balance) - driverEarning,
        balanceAfter: Number(wallet.balance),
        parcelId: parcel.id,
        description: `Gain colis ${parcel.trackingNumber} (${driverEarning} FCFA, comm. ${commission} FCFA)`,
        origin: 'delivery',
        status: 'completed'
      }
    })
    await tx.notification.create({
      data: {
        userId: parcel.driverId,
        type: 'delivery_paid',
        title: 'Paiement reçu',
        body: `+${driverEarning} FCFA pour le colis ${parcel.trackingNumber}. Commission: ${commission} FCFA.`,
        data: { parcelId: parcel.id, earning: driverEarning, commission }
      }
    })
    // Notifier les admins
    const admins = await tx.user.findMany({ where: { role: 'super_admin', status: 'active' }, select: { id: true } })
    await Promise.all(admins.map((a) =>
      tx.notification.create({
        data: {
          userId: a.id,
          type: 'admin_driver_credited',
          title: `PayDunya - ${parcel.trackingNumber}`,
          body: `Chauffeur crédité (${driverEarning} FCFA). Commission: ${commission} FCFA.`,
          data: { parcelId: parcel.id, driverId: parcel.driverId, earning: driverEarning, commission }
        }
      })
    ))
  })
}

/**
 * POST /payments/paydunya/create
 * Crée une facture PayDunya. type = parcel | score | wallet
 */
export const createPaydunyaPayment = handle('paydunya.create', async (req, res) => {
  const config = await getPaydunyaConfig()
  if (!config) {
    throw new ValidationError([{ path: 'paydunya', message: 'PayDunya non configuré' }])
  }

  const { type, parcelId, points, amount: rawAmount } = req.body
  const paymentType = type || 'parcel'
  const amount = number(rawAmount || points || req.body.amount || 0)

  if (amount <= 0) throw new ValidationError([{ path: 'body.amount', message: 'Montant invalide' }])
  if (!['parcel', 'score', 'wallet'].includes(paymentType)) {
    throw new ValidationError([{ path: 'body.type', message: 'Type invalide (parcel, score, wallet)' }])
  }

  let description = ''
  let redirectPath = '/client/colis'
  const customData = { type: paymentType, userId: req.user.id }

  if (paymentType === 'parcel') {
    if (!parcelId) throw new ValidationError([{ path: 'body.parcelId', message: 'Colis requis' }])
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } })
    if (!parcel) throw new ValidationError([{ path: 'body.parcelId', message: 'Colis introuvable' }])
    if (parcel.paymentStatus === 'completed') {
      throw new ValidationError([{ path: 'body.parcelId', message: 'Ce colis est déjà payé' }])
    }
    customData.parcelId = parcelId
    description = `Paiement colis ${parcel.trackingNumber}`
    redirectPath = '/client/colis'
  } else if (paymentType === 'score') {
    const pts = number(points || amount || 0)
    if (pts <= 0) throw new ValidationError([{ path: 'body.points', message: 'Points invalides' }])
    customData.points = pts
    description = `Achat de ${pts} points`
    redirectPath = '/driver/points'
  } else if (paymentType === 'wallet') {
    const amt = number(amount)
    if (amt <= 0) throw new ValidationError([{ path: 'body.amount', message: 'Montant invalide' }])
    description = `Recharge portefeuille ${amt} FCFA`
    redirectPath = '/driver/revenus'
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } })
  const baseUrl = env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`

  const result = await paydunyaCreateInvoice({
    amount,
    description,
    customerName: user?.fullName || req.user.fullName,
    customerEmail: user?.email || null,
    customerPhone: user?.phone || req.user.phone,
    returnUrl: `${baseUrl}/api/v1/payments/paydunya/return`,
    cancelUrl: `${baseUrl}/api/v1/payments/paydunya/cancel`,
    callbackUrl: `${baseUrl}/api/v1/payments/paydunya/ipn`,
    customData
  })

  return ok(res, {
    status: 201,
    message: 'Facture PayDunya créée',
    data: {
      token: result.token,
      paymentUrl: result.paymentUrl
    }
  })
})

/**
 * GET /payments/paydunya/confirm/:token
 */
export const confirmPaydunyaPayment = handle('paydunya.confirm', async (req, res) => {
  const config = await getPaydunyaConfig()
  if (!config) {
    throw new ValidationError([{ path: 'paydunya', message: 'PayDunya non configuré' }])
  }

  const { token } = req.params
  if (!token) throw new ValidationError([{ path: 'token', message: 'Token requis' }])

  const result = await paydunyaConfirmInvoice(token)
  if (result.status === 'completed') await processCompletedPayment(result, token, req.log)

  return ok(res, {
    message: 'Statut paiement',
    data: { token, status: result.status, amount: result.amount, receiptUrl: result.receiptUrl, customer: result.customer }
  })
})

/**
 * POST /payments/paydunya/ipn — Callback IPN (public)
 */
export const paydunyaIpn = handle('paydunya.ipn', async (req, res) => {
  const { data } = req.body
  if (!data) throw new ValidationError([{ path: 'data', message: 'Données IPN manquantes' }])

  const config = await getPaydunyaConfig()
  const masterKey = config?.masterKey || ''

  if (data.hash && !verifyIpnHash(masterKey, data.hash)) {
    return fail(res, { status: 403, message: 'Hash invalide', code: 'FORBIDDEN' })
  }

  if (data.status === 'completed') {
    await processCompletedPayment(data, data.invoice?.token || '', req.log)
  }

  return ok(res, { message: 'IPN reçu' })
})

/**
 * Traite un paiement complété : crédite score, wallet, ou marque le colis payé.
 */
async function processCompletedPayment(result, token, reqLogger) {
  const raw = result.raw || result
  const cd = raw.custom_data || result.customData || {}
  const type = cd.type || 'parcel'
  const amount = Number(raw.invoice?.total_amount || raw.total_amount || result.amount || 0)
  const userId = cd.userId

  try {
    if (type === 'parcel' && cd.parcelId) {
      const parcel = await prisma.parcel.findUnique({ where: { id: cd.parcelId } })
      if (!parcel) return reqLogger?.warn?.({ parcelId: cd.parcelId }, 'PayDunya: parcel not found')

      await prisma.parcel.updateMany({
        where: { id: cd.parcelId },
        data: { paymentStatus: 'completed' }
      })
      if (userId) {
        await createPaymentRecord(userId, cd.parcelId, amount, token)
        await sendNotification(userId, 'payment_completed', 'Paiement confirmé',
          `Votre paiement de ${amount} FCFA pour le colis a été confirmé.`, { parcelId: cd.parcelId, amount, token })
      }

      // Si le colis est déjà livré, créditer le chauffeur
      if (parcel.status === 'delivered' && parcel.driverId) {
        await creditDriverForParcel(parcel, token)
      }

      reqLogger?.info?.({ parcelId: cd.parcelId, amount, token }, 'PayDunya: parcel payment completed')
    } else if (type === 'score' && userId && cd.points) {
      await creditScore(userId, Number(cd.points), token)
      reqLogger?.info?.({ userId, points: cd.points }, 'PayDunya: score credited')
    } else if (type === 'wallet' && userId) {
      await creditWallet(userId, amount, token)
      reqLogger?.info?.({ userId, amount }, 'PayDunya: wallet credited')
    } else {
      reqLogger?.warn?.({ type, cd }, 'PayDunya: unknown payment type or missing data')
    }
  } catch (err) {
    reqLogger?.error?.({ err, type, token }, 'PayDunya: processCompletedPayment failed')
  }
}

/**
 * GET /payments/paydunya/return — page de retour après paiement
 */
export const paydunyaReturn = handle('paydunya.return', async (req, res) => {
  const frontUrl = env.CORS_ORIGIN === '*' ? 'http://localhost:5173' : (env.CORS_ORIGIN || '').split(',')[0]
  const { token } = req.query

  if (!token) {
    return res.redirect(`${frontUrl}/client/colis?payment=cancelled`)
  }

  try {
    const result = await paydunyaConfirmInvoice(token)
    const cd = result.raw?.custom_data || result.customData || {}
    const type = cd.type || 'parcel'

    if (result.status === 'completed') {
      await processCompletedPayment(result, token, req.log)

      if (type === 'parcel' && cd.parcelId) {
        return res.redirect(`${frontUrl}/client/colis/${cd.parcelId}?payment=success`)
      }
      const paths = { score: '/driver/points', wallet: '/driver/points' }
      return res.redirect(`${frontUrl}${paths[type] || '/client/colis'}?payment=success&token=${token}`)
    }
  } catch (err) {
    req.log?.error?.({ err, token }, 'PayDunya return: confirm failed')
  }

  return res.redirect(`${frontUrl}/client/colis?payment=pending&token=${token}`)
})

/**
 * GET /payments/paydunya/cancel
 */
export const paydunyaCancel = (_req, res) => {
  const frontUrl = env.CORS_ORIGIN === '*' ? 'http://localhost:5173' : (env.CORS_ORIGIN || '').split(',')[0]
  return res.redirect(`${frontUrl}/client/colis?payment=cancelled`)
}
