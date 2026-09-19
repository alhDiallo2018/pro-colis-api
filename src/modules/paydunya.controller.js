import { createHash } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { ok, fail } from '../utils/api-response.js'
import { ValidationError, ForbiddenError, NotFoundError, normalizeError } from '../utils/errors.js'
import { sendNotificationEmail, sendNotificationSms, isBrevoConfigured } from '../utils/brevo.js'
import { calculateCommission, getCfaPerPoint, repayDebtFromPoints, repayDebtFromWallet } from '../utils/commission.js'
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

async function creditScore(tx, userId, points, token) {
  const cfaPerPoint = await getCfaPerPoint(tx)
  // La dette de commission est réglée en priorité sur les points achetés.
  const repayment = await repayDebtFromPoints(tx, { userId, points, cfaPerPoint })
  const netPoints = repayment.netPoints

  await tx.score.upsert({
    where: { userId },
    update: { points: { increment: netPoints }, totalEarned: { increment: netPoints }, lastUpdated: new Date() },
    create: { userId, points: netPoints, totalEarned: netPoints }
  })
  await tx.scoreTransaction.create({
    data: { userId, amount: points, type: 'purchase', source: 'paydunya', description: `Achat points via PayDunya (${token})`, metadata: { pointsRequested: points, netPoints, debtRepaid: repayment.debtRepaid } }
  })
  await tx.notification.create({
    data: {
      userId,
      type: 'score_credited',
      title: 'Points credites',
      body: `${netPoints} points ont ete ajoutes a votre compte via PayDunya.`,
      data: { points: netPoints, requested: points, debtRepaid: repayment.debtRepaid, token, source: 'paydunya' }
    }
  })
}

async function creditWallet(tx, userId, amount, token) {
  // 1. Crédit intégral sur le solde (la dette est réglée ensuite depuis le solde).
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

  // 2. La dette de commission est réglée en priorité depuis le solde crédité.
  const repayment = await repayDebtFromWallet(tx, { userId, amount })
  const netAmount = repayment.netAmount

  await tx.notification.create({
    data: {
      userId,
      type: 'wallet_recharged',
      title: 'Portefeuille recharge',
      body: `${netAmount} FCFA ont ete ajoutes a votre portefeuille via PayDunya.`,
      data: { amount: netAmount, requested: amount, debtRepaid: repayment.debtRepaid, token, source: 'paydunya' }
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

async function creditDriverForParcel(tx, parcel, token) {
  const parcelPrice = Number(parcel.price || parcel.totalAmount || 0)
  if (!parcelPrice || !parcel.assignedDriverId) return

  const commission = await calculateCommission(parcelPrice)
  const driverEarning = Math.max(0, parcelPrice - commission)

  if (driverEarning <= 0) return

  const wallet = await tx.wallet.upsert({
    where: { userId: parcel.assignedDriverId },
    update: { balance: { increment: driverEarning }, totalDeposited: { increment: driverEarning }, lastActivityAt: new Date(), lastDepositAt: new Date() },
    create: { userId: parcel.assignedDriverId, balance: driverEarning, totalDeposited: driverEarning, lastDepositAt: new Date(), lastActivityAt: new Date() }
  })
  await tx.walletTransaction.create({
    data: {
      walletUserId: parcel.assignedDriverId,
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
      userId: parcel.assignedDriverId,
      type: 'delivery_paid',
      title: 'Paiement recu',
      body: `+${driverEarning} FCFA pour le colis ${parcel.trackingNumber}. Commission: ${commission} FCFA.`,
      data: { parcelId: parcel.id, earning: driverEarning, commission }
    }
  })
  const admins = await tx.user.findMany({ where: { role: 'super_admin', status: 'active' }, select: { id: true } })
  await Promise.all(admins.map((a) =>
    tx.notification.create({
      data: {
        userId: a.id,
        type: 'admin_driver_credited',
        title: `PayDunya - ${parcel.trackingNumber}`,
        body: `Chauffeur credite (${driverEarning} FCFA). Commission: ${commission} FCFA.`,
        data: { parcelId: parcel.id, driverId: parcel.assignedDriverId, earning: driverEarning, commission }
      }
    })
  ))
}

export const createPaydunyaPayment = handle('paydunya.create', async (req, res) => {
  const config = await getPaydunyaConfig()
  if (!config) {
    throw new ValidationError([{ path: 'paydunya', message: 'PayDunya non configure' }])
  }

  const { type, parcelId, points, amount: rawAmount, debtId } = req.body
  const paymentType = type || 'parcel'
  if (!['parcel', 'score', 'wallet', 'penalty_debt'].includes(paymentType)) {
    throw new ValidationError([{ path: 'body.type', message: 'Type invalide (parcel, score, wallet, penalty_debt)' }])
  }

  let amount
  let description = ''
  let redirectPath = '/client/colis'
  // Métadonnées renvoyées telles quelles par PayDunya (confirm + IPN) : servent à
  // rattacher le paiement à l'utilisateur/colis et à la réconciliation.
  const customData = {
    type: paymentType,
    userId: req.user.id,
    mode: config.mode || 'test',
    initiatedAt: new Date().toISOString()
  }

  if (paymentType === 'parcel') {
    if (!parcelId) throw new ValidationError([{ path: 'body.parcelId', message: 'Colis requis' }])
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } })
    if (!parcel) throw new ValidationError([{ path: 'body.parcelId', message: 'Colis introuvable' }])
    if (parcel.paymentStatus === 'completed') {
      throw new ValidationError([{ path: 'body.parcelId', message: 'Ce colis est deja paye' }])
    }
    // Le montant exigé est celui du colis, recalculé côté serveur : le montant
    // envoyé par le client n'est jamais la source de vérité du paiement.
    amount = Number(parcel.totalAmount ?? parcel.price ?? 0)
    if (!(amount > 0)) {
      throw new ValidationError([{ path: 'body.parcelId', message: 'Montant du colis invalide' }])
    }
    customData.parcelId = parcelId
    customData.expectedAmount = amount
    description = `Paiement colis ${parcel.trackingNumber}`
    redirectPath = '/client/colis'
  } else if (paymentType === 'score') {
    const pts = number(points || 0)
    if (!(pts > 0)) throw new ValidationError([{ path: 'body.points', message: 'Points invalides' }])
    // Le prix des points est calculé côté serveur (config `score.cfaPerPoint`) :
    // jamais à partir d'un montant fourni par le client.
    const cfaPerPoint = await getCfaPerPoint(prisma)
    amount = Math.round(pts * cfaPerPoint)
    customData.points = pts
    customData.expectedAmount = amount
    description = `Achat de ${pts} points`
    redirectPath = '/driver/points'
  } else if (paymentType === 'wallet') {
    const amt = number(rawAmount)
    if (!(amt > 0)) throw new ValidationError([{ path: 'body.amount', message: 'Montant invalide' }])
    amount = amt
    description = `Recharge portefeuille ${amt} FCFA`
    redirectPath = '/driver/revenus'
  } else if (paymentType === 'penalty_debt') {
    if (!debtId) throw new ValidationError([{ path: 'body.debtId', message: 'Dette requise' }])
    const debt = await prisma.clientPenaltyDebt.findUnique({ where: { id: debtId } })
    if (!debt) throw new ValidationError([{ path: 'body.debtId', message: 'Dette introuvable' }])
    if (debt.userId !== req.user.id) throw new ForbiddenError('Cette dette ne vous appartient pas')
    const remaining = Number(debt.remaining)
    if (debt.status === 'paid' || remaining <= 0) {
      throw new ValidationError([{ path: 'body.debtId', message: 'Cette dette est déjà réglée' }])
    }
    // Règlement partiel OU intégral : le montant demandé est borné par le
    // reliquat recalculé côté serveur. Le client ne peut jamais dépasser le
    // montant restant, ni fixer un montant arbitraire depuis le frontend.
    const requested = number(rawAmount)
    amount = requested > 0 ? requested : remaining
    if (amount > remaining) {
      throw new ValidationError([{ path: 'body.amount', message: `Le paiement ne peut pas dépasser le montant restant (${remaining} FCFA)` }])
    }
    customData.debtId = debtId
    customData.expectedAmount = amount
    description = `Règlement pénalité d'annulation ${debt.reference} (${amount} FCFA)`
    redirectPath = '/client/colis'
  }

  const minAmount = env.PAYDUNYA_MIN_AMOUNT
  if (amount < minAmount) {
    throw new ValidationError([{ path: 'body.amount', message: `Le montant minimum est de ${minAmount} FCFA` }])
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
    message: 'Facture PayDunya creee',
    data: {
      token: result.token,
      paymentUrl: result.paymentUrl
    }
  })
})

export const confirmPaydunyaPayment = handle('paydunya.confirm', async (req, res) => {
  const config = await getPaydunyaConfig()
  if (!config) {
    throw new ValidationError([{ path: 'paydunya', message: 'PayDunya non configure' }])
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

export const paydunyaIpn = handle('paydunya.ipn', async (req, res) => {
  const { data } = req.body
  if (!data) throw new ValidationError([{ path: 'data', message: 'Donnees IPN manquantes' }])

  const config = await getPaydunyaConfig()
  const masterKey = config?.masterKey || ''

  // Sécurité : l'IPN DOIT être signé. Un hash absent OU invalide est rejeté —
  // sinon une requête forgée pourrait créditer un wallet / valider un colis.
  if (!masterKey || !data.hash || !verifyIpnHash(masterKey, data.hash)) {
    return fail(res, { status: 403, message: 'Signature IPN invalide ou manquante', code: 'FORBIDDEN' })
  }

  if (data.status === 'completed') {
    await processCompletedPayment(data, data.invoice?.token || '', req.log)
  }

  return ok(res, { message: 'IPN recu' })
})

function underpaymentError() {
  const err = new Error('Montant payé insuffisant')
  err.code = 'PAYDUNYA_UNDERPAYMENT'
  return err
}

function debtAlreadySettledError() {
  const err = new Error('Dette déjà réglée')
  err.code = 'DEBT_ALREADY_SETTLED'
  return err
}

export async function processCompletedPayment(result, token, reqLogger) {
  const raw = result.raw || result
  const cd = raw.custom_data || result.customData || {}
  const type = cd.type || 'parcel'
  const paidAmount = Math.round(Number(raw.invoice?.total_amount ?? raw.total_amount ?? result.amount ?? 0))
  const userId = cd.userId

  if (!token) {
    reqLogger?.warn?.({ type }, 'PayDunya: token manquant, complétion ignorée')
    return
  }
  if (!userId) {
    reqLogger?.warn?.({ type }, 'PayDunya: userId manquant dans custom_data, complétion ignorée')
    return
  }

  // Chemin rapide d'idempotence (lecture seule). La garantie réelle vient de la
  // contrainte unique sur `Payment.transactionId` posée dans la transaction.
  const existing = await prisma.payment.findUnique({ where: { transactionId: token } })
  if (existing) {
    reqLogger?.warn?.({ token }, 'PayDunya: duplicate completion ignored')
    return
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Sous-paiement : vérifié AVANT toute écriture, pour chaque flux dont le
      // montant attendu est connu côté serveur. Un montant insuffisant rejette
      // l'opération entière : aucun crédit, aucun statut « payé ».
      if (type === 'parcel' && cd.parcelId) {
        const parcel = await tx.parcel.findUnique({ where: { id: cd.parcelId } })
        if (!parcel) throw new NotFoundError('Colis introuvable')
        const expected = Number(parcel.totalAmount ?? parcel.price ?? 0)
        if (expected > 0 && paidAmount < expected) {
          reqLogger?.warn?.({ parcelId: cd.parcelId, paidAmount, expected }, 'PayDunya: sous-paiement colis rejeté')
          throw underpaymentError()
        }
      } else if (type === 'score' && cd.points) {
        const cfaPerPoint = await getCfaPerPoint(tx)
        const expected = Math.round(Number(cd.points) * cfaPerPoint)
        if (expected > 0 && paidAmount < expected) {
          reqLogger?.warn?.({ userId, paidAmount, expected, points: cd.points }, 'PayDunya: sous-paiement points rejeté')
          throw underpaymentError()
        }
      } else if (type === 'penalty_debt' && cd.debtId) {
        const debt = await tx.clientPenaltyDebt.findUnique({ where: { id: cd.debtId } })
        if (!debt) throw new NotFoundError('Dette introuvable')
        if (debt.status === 'paid' || Number(debt.remaining) <= 0) {
          reqLogger?.warn?.({ debtId: cd.debtId }, 'PayDunya: dette déjà réglée, règlement ignoré')
          throw debtAlreadySettledError()
        }
        // Sous-paiement : le client doit payer au moins le montant facturé
        // (`expectedAmount`, figé à la création). Le montant appliqué est de
        // toute façon borné au reliquat au moment du règlement.
        const expected = cd.expectedAmount != null ? Number(cd.expectedAmount) : Number(debt.remaining)
        if (expected > 0 && paidAmount < expected) {
          reqLogger?.warn?.({ debtId: cd.debtId, paidAmount, expected }, 'PayDunya: sous-paiement dette rejeté')
          throw underpaymentError()
        }
      }

      // Garde atomique d'idempotence : `transactionId` est unique. Un rejeu
      // concurrent lève P2002 et annule toutes les écritures de crédit.
      await tx.payment.create({
        data: {
          userId,
          parcelId: type === 'parcel' ? cd.parcelId || null : null,
          amount: paidAmount,
          currency: 'XOF',
          method: 'card',
          status: 'completed',
          transactionId: token,
          completedAt: new Date(),
          metadata: { source: 'paydunya', token, type, ...(cd.debtId ? { debtId: cd.debtId } : {}) }
        }
      })

      if (type === 'parcel' && cd.parcelId) {
        const parcel = await tx.parcel.findUnique({ where: { id: cd.parcelId } })
        await tx.parcel.updateMany({ where: { id: cd.parcelId }, data: { paymentStatus: 'completed' } })
        await sendNotification(userId, 'payment_completed', 'Paiement confirme',
          `Votre paiement de ${paidAmount} FCFA pour le colis a ete confirme.`, { parcelId: cd.parcelId, amount: paidAmount, token })

        if (parcel.status === 'delivered' && parcel.assignedDriverId) {
          await creditDriverForParcel(tx, parcel, token)
        }
        reqLogger?.info?.({ parcelId: cd.parcelId, amount: paidAmount, token }, 'PayDunya: parcel payment completed')
      } else if (type === 'score' && cd.points) {
        await creditScore(tx, userId, Number(cd.points), token)
        reqLogger?.info?.({ userId, points: cd.points }, 'PayDunya: score credited')
      } else if (type === 'wallet') {
        // Top-up libre : le wallet crédite le montant réellement payé, il n'y a
        // donc pas de « montant attendu » supérieur à vérifier.
        await creditWallet(tx, userId, paidAmount, token)
        reqLogger?.info?.({ userId, amount: paidAmount }, 'PayDunya: wallet credited')
      } else if (type === 'penalty_debt' && cd.debtId) {
        // Règlement partiel ou intégral de la pénalité client : aucune commission
        // chauffeur, aucun crédit wallet, aucune recette de livraison. Le reliquat
        // est recalculé côté serveur, ne peut jamais devenir négatif ni dépasser
        // le montant restant, et la garde conditionnelle rend chaque écriture
        // idempotente face à un rejeu IPN / une double facture.
        const debt = await tx.clientPenaltyDebt.findUnique({ where: { id: cd.debtId } })
        if (!debt) throw new NotFoundError('Dette introuvable')
        const applyAmount = Math.min(paidAmount, Number(debt.remaining))

        const decremented = await tx.clientPenaltyDebt.updateMany({
          where: { id: cd.debtId, remaining: { gte: applyAmount }, status: { not: 'paid' } },
          data: { remaining: { decrement: applyAmount } }
        })
        if (decremented.count === 0) throw debtAlreadySettledError()

        const updated = await tx.clientPenaltyDebt.findUnique({ where: { id: cd.debtId } })
        const nextRemaining = Number(updated.remaining)
        const finalStatus = nextRemaining === 0 ? 'paid' : 'partially_paid'
        await tx.clientPenaltyDebt.update({
          where: { id: cd.debtId },
          data: { status: finalStatus, settledAt: finalStatus === 'paid' ? new Date() : null }
        })

        await sendNotification(userId, 'client_penalty_debt_paid',
          finalStatus === 'paid' ? 'Pénalité réglée' : 'Paiement partiel reçu',
          finalStatus === 'paid'
            ? `Votre pénalité de ${applyAmount} FCFA a été réglée.`
            : `Un paiement de ${applyAmount} FCFA a été appliqué. Reste ${nextRemaining} FCFA.`,
          { debtId: cd.debtId, amount: applyAmount, remaining: nextRemaining, token })
        reqLogger?.info?.({ userId, debtId: cd.debtId, amount: applyAmount, remaining: nextRemaining }, 'PayDunya: penalty debt settled (partial or full)')
      } else {
        reqLogger?.warn?.({ type, cd }, 'PayDunya: unknown payment type or missing data')
      }
    })
  } catch (err) {
    if (err?.code === 'P2002') {
      reqLogger?.warn?.({ token }, 'PayDunya: doublon concurrent ignoré')
      return
    }
    if (err?.code === 'PAYDUNYA_UNDERPAYMENT') {
      // Sous-paiement : rien n'est crédité, aucune écriture persistée. Le rejeu
      // de la même transaction échouera de nouveau sans crédit.
      return
    }
    if (err?.code === 'DEBT_ALREADY_SETTLED') {
      // Dette déjà réglée par un autre règlement concurrent : le paiement en
      // double est annulé (rollback), aucun double règlement n'est persisté.
      reqLogger?.warn?.({ token }, 'PayDunya: dette déjà réglée, règlement ignoré')
      return
    }
    reqLogger?.error?.({ err, type, token }, 'PayDunya: processCompletedPayment failed')
  }
}

export const paydunyaReturn = handle('paydunya.return', async (req, res) => {
  const frontUrl = env.WEB_APP_URL
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

export const paydunyaCancel = (_req, res) => {
  const frontUrl = env.WEB_APP_URL
  return res.redirect(`${frontUrl}/client/colis?payment=cancelled`)
}

// --- Callback de déboursement (API PUSH) ---
// PayDunya notifie le statut final d'un retrait ; `hash` = SHA-512 de la MasterKey.
// Doc : https://developers.paydunya.com/doc/FR/api_deboursement
//
// PayDunya envoie ce callback en application/x-www-form-urlencoded avec les
// données regroupées sous la clé `data`. L'ancien format « champs à plat »
// (hash/status/token au niveau racine) reste accepté.
//
// IMPORTANT : la clé `data` n'est PAS nécessairement un JSON déjà décodé. En
// production, `JSON.parse(data)` a échoué (INVALID_JSON) car la valeur reçue
// par Express est encore encodée (percent-encoding, parfois en double passe)
// ou se présente comme une query-string form-urlencoded. On décode donc dans
// l'ordre le format attendu, sans jamais faire confiance au contenu reçu : le
// payload est normalisé AVANT la vérification de signature, et un `data` qui
// ne se laisse pas décoder en objet est rejeté en 400.
function tryParseJsonObject(value) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Décodage d'un composant form-urlencoded : percent-encoding + '+' → espace.
// Retourne null si la chaîne contient une séquence '%' invalide.
function decodeFormComponent(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, ' '))
  } catch {
    return null
  }
}

// Interprète `data` comme une query-string form-urlencoded (hash=...&status=...).
function parseFormQuery(value) {
  try {
    const params = new URLSearchParams(String(value))
    const obj = {}
    for (const [key, val] of params.entries()) {
      if (!(key in obj)) obj[key] = val
    }
    return obj
  } catch {
    return null
  }
}

function normalizeDisburseCallbackPayload(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const data = source.data

  if (data === undefined || data === null) {
    return { payload: source, error: null, format: 'flat' }
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    return { payload: data, error: null, format: 'object' }
  }

  if (typeof data !== 'string') {
    return { payload: null, error: 'INVALID_DATA', format: typeof data }
  }

  // 1. JSON directement lisible (objet déjà désérialisé côté serveur).
  const direct = tryParseJsonObject(data)
  if (direct) return { payload: direct, error: null, format: 'json' }

  // 2. JSON encodé en form-urlencoded (percent-encoding), puis éventuellement
  //    en double passe. C'est le cas réel observé en production.
  const once = decodeFormComponent(data)
  if (once !== null) {
    const onceParsed = tryParseJsonObject(once)
    if (onceParsed) return { payload: onceParsed, error: null, format: 'urlencoded-json' }
    const twice = decodeFormComponent(once)
    if (twice !== null) {
      const twiceParsed = tryParseJsonObject(twice)
      if (twiceParsed) return { payload: twiceParsed, error: null, format: 'double-urlencoded-json' }
    }
  }

  // 3. Query-string form-urlencoded directement sous `data` (hash=...&status=...).
  const query = parseFormQuery(data)
  if (query && typeof query === 'object' && query.hash !== undefined) {
    return { payload: query, error: null, format: 'query-string' }
  }

  return { payload: null, error: 'INVALID_JSON', format: 'unknown' }
}

export const paydunyaDisburseCallback = handle('paydunya.disburseCallback', async (req, res) => {
  const { verifyCallbackHash } = await import('../utils/paydunya-disburse.js')
  const { loadPaydunyaConfig } = await import('../utils/paydunya-config.js')
  const { finalizeWithdrawalSuccess, failWithdrawal } = await import('../utils/withdrawal-flow.js')

  const config = await loadPaydunyaConfig(true)
  const rawBody = req.body ?? {}
  const { payload: normalizedPayload, error: dataError, format: dataFormat } = normalizeDisburseCallbackPayload(rawBody)
  const payload = normalizedPayload ?? {}

  // --- DIAGNOSTIC TEMPORAIRE (à retirer après investigation) ---
  // Journalise uniquement le contenu NON-sensible du callback pour déterminer
  // la représentation exacte de `req.body.data` SANS en révéler la valeur.
  // Jamais de masterKey/privateKey/token/Authorization/cookies/credentials.
  // Le hash = SHA-512(masterKey) EST le secret du callback : on ne journalise
  // que sa longueur et le résultat de la comparaison, jamais sa valeur en clair.
  const hasData = rawBody.data !== undefined && rawBody.data !== null
  const rawDataString = typeof rawBody.data === 'string' ? rawBody.data : String(rawBody.data ?? '')
  const trimmedData = rawDataString.trim()
  const diagnosticBodyKeys = Object.keys(rawBody)
  const diagnosticContentType = String(req.get('content-type') ?? '')
  const diagnosticDataType = typeof rawBody.data
  const diagnosticDataKeys = hasData && !dataError ? Object.keys(payload) : null
  const diagnosticReceivedHashLength = String(payload.hash ?? '').length
  const diagnosticExpectedHashLength = createHash('sha512').update(config.masterKey).digest('hex').length
  const diagnosticHashMatches = verifyCallbackHash(payload.hash, config.masterKey)
  req.log?.info?.(
    {
      paydunyaDisburseCallbackDiagnostic: {
        requestId: req.requestId,
        contentType: diagnosticContentType,
        bodyKeys: diagnosticBodyKeys,
        dataType: diagnosticDataType,
        dataFormat,
        dataLength: rawDataString.length,
        dataFirstCharCode: rawDataString.length ? rawDataString.charCodeAt(0) : null,
        dataLastCharCode: rawDataString.length ? rawDataString.charCodeAt(rawDataString.length - 1) : null,
        dataFirstChar: rawDataString.length ? rawDataString[0] : null,
        dataLastChar: rawDataString.length ? rawDataString[rawDataString.length - 1] : null,
        dataLooksLikeJson:
          (trimmedData.startsWith('{') && trimmedData.endsWith('}')) ||
          (trimmedData.startsWith('[') && trimmedData.endsWith(']')),
        dataStartsWithPercentEncoding: rawDataString.startsWith('%'),
        dataStartsWithPlus: rawDataString.startsWith('+'),
        dataContainsPercent: rawDataString.includes('%'),
        dataContainsBraces: rawDataString.includes('{') || rawDataString.includes('}'),
        dataContainsHashKey: rawDataString.includes('hash'),
        dataKeys: diagnosticDataKeys,
        hashPresent: Boolean(payload.hash),
        hashReceivedLength: diagnosticReceivedHashLength,
        hashExpectedLength: diagnosticExpectedHashLength,
        hashMatches: diagnosticHashMatches,
        status: payload.status ?? null,
        withdrawMode: payload.withdraw_mode ?? null,
        amount: payload.amount ?? null,
        disburseId: payload.disburse_id ?? null,
        transactionId: payload.transaction_id ?? null,
        disburseTxId: payload.disburse_tx_id ?? null,
        updatedAt: payload.updated_at ?? null
      }
    },
    'PayDunya disburse callback diagnostic'
  )
  // --- FIN DIAGNOSTIC TEMPORAIRE ---

  if (dataError) {
    req.log?.warn?.({ requestId: req.requestId, dataError }, 'PayDunya disburse callback rejected: invalid data')
    return fail(res, { status: 400, message: 'Données callback PayDunya invalides', code: 'INVALID_CALLBACK_DATA' })
  }

  if (!verifyCallbackHash(payload.hash, config.masterKey)) {
    req.log?.warn?.({ requestId: req.requestId }, 'PayDunya disburse callback rejected: invalid hash')
    return fail(res, { status: 403, message: 'Signature invalide', code: 'FORBIDDEN' })
  }

  const token = String(payload.token ?? payload.disburse_invoice ?? '').trim()
  const withdrawal = token
    ? await prisma.withdrawal.findUnique({ where: { disburseToken: token } })
    : payload.disburse_id
      ? await prisma.withdrawal.findFirst({ where: { reference: String(payload.disburse_id) } })
      : null
  if (!withdrawal) return ok(res, { message: 'Transaction inconnue' })

  const status = String(payload.status ?? '').toLowerCase()
  if (status === 'success') {
    await finalizeWithdrawalSuccess(withdrawal.id, {
      transactionId: payload.transaction_id ?? null,
      providerRef: payload.disburse_tx_id ?? null
    })
  } else if (status === 'failed') {
    await failWithdrawal(withdrawal.id, 'Transaction refusée par l’opérateur (callback)')
  }
  return ok(res, { message: 'Callback traité' })
})

// --- Config PayDunya gérable par le super admin (SystemConfig "paydunya.*") ---
// Les clés sont des secrets financiers : masquées en lecture (4 derniers caractères).
const PAYDUNYA_CONFIG_FIELDS = ['masterKey', 'privateKey', 'token', 'mode', 'storeName', 'debitAccountNumber']
const PAYDUNYA_SECRET_FIELDS = ['masterKey', 'privateKey', 'token']

function maskSecret(value) {
  const v = String(value ?? '')
  if (!v) return ''
  return v.length <= 4 ? '****' : `****${v.slice(-4)}`
}

export const getPaydunyaAdminConfig = handle('paydunya.configGet', async (_req, res) => {
  const { loadPaydunyaConfig } = await import('../utils/paydunya-config.js')
  const cfg = await loadPaydunyaConfig(true)
  return ok(res, {
    message: 'Configuration PayDunya',
    data: {
      config: {
        masterKey: maskSecret(cfg.masterKey),
        privateKey: maskSecret(cfg.privateKey),
        token: maskSecret(cfg.token),
        mode: cfg.mode,
        storeName: cfg.storeName,
        debitAccountNumber: cfg.debitAccountNumber || '',
        configured: Boolean(cfg.masterKey && cfg.privateKey && cfg.token)
      }
    }
  })
})

export const updatePaydunyaAdminConfig = handle('paydunya.configUpdate', async (req, res) => {
  const { invalidatePaydunyaConfigCache, loadPaydunyaConfig } = await import('../utils/paydunya-config.js')

  const patch = {}
  for (const field of PAYDUNYA_CONFIG_FIELDS) {
    const value = req.body[field]
    if (value === undefined) continue
    // Une valeur masquée renvoyée telle quelle par l'écran admin est ignorée.
    if (PAYDUNYA_SECRET_FIELDS.includes(field) && String(value).startsWith('****')) continue
    patch[field] = String(value)
  }
  if (patch.mode && !['test', 'live'].includes(patch.mode)) {
    throw new ValidationError([{ path: 'body.mode', message: 'mode doit être "test" ou "live"' }])
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError([{ path: 'body', message: 'Au moins un paramètre requis' }])
  }

  await prisma.$transaction([
    ...Object.entries(patch).map(([field, value]) =>
      prisma.systemConfig.upsert({
        where: { key: `paydunya.${field}` },
        update: { value, updatedBy: req.user.id, updatedAt: new Date() },
        create: { key: `paydunya.${field}`, value, updatedBy: req.user.id }
      })
    ),
    prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'paydunya.configUpdate',
        entityType: 'system_config',
        afterData: { keys: Object.keys(patch) }, // jamais les valeurs en clair dans l'audit
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      }
    })
  ])

  invalidatePaydunyaConfigCache()
  const cfg = await loadPaydunyaConfig(true)
  return ok(res, {
    message: 'Configuration PayDunya mise à jour',
    data: {
      config: {
        masterKey: maskSecret(cfg.masterKey),
        privateKey: maskSecret(cfg.privateKey),
        token: maskSecret(cfg.token),
        mode: cfg.mode,
        storeName: cfg.storeName,
        debitAccountNumber: cfg.debitAccountNumber || '',
        configured: Boolean(cfg.masterKey && cfg.privateKey && cfg.token)
      }
    }
  })
})
