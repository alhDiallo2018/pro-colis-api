import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { loadPaydunyaConfig, paydunyaConfigSnapshot } from './paydunya-config.js'

const SANDBOX_API = 'https://app.paydunya.com/sandbox-api/v1'
const PROD_API = 'https://app.paydunya.com/api/v1'

// La config en base (gérable par l'admin) prime sur l'env — chargeur partagé.
async function getConfig() {
  return loadPaydunyaConfig()
}

async function api(config, method, path, body) {
  const baseUrl = config.mode === 'live' ? PROD_API : SANDBOX_API
  const url = `${baseUrl}${path}`

  const headers = {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': config.masterKey,
    'PAYDUNYA-PRIVATE-KEY': config.privateKey,
    'PAYDUNYA-TOKEN': config.token
  }

  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ response_text: `HTTP ${res.status}` }))
    throw new Error(err.response_text || err.message || `Erreur PayDunya HTTP ${res.status}`)
  }

  return res.json()
}

/**
 * Crée une facture de paiement PayDunya (mode PAR - redirection).
 * Retourne l'URL de paiement et le token.
 */
export async function createInvoice({
  amount,
  description,
  customerName,
  customerEmail,
  customerPhone,
  returnUrl,
  cancelUrl,
  callbackUrl,
  customData,
  channels
}) {
  const config = await getConfig()

  const data = {
    invoice: {
      total_amount: Math.round(amount),
      description: description || `Paiement de ${amount} FCFA`
    },
    store: {
      name: paydunyaConfigSnapshot().storeName
    },
    actions: {}
  }

  if (customerName || customerEmail || customerPhone) {
    data.invoice.customer = {}
    if (customerName) data.invoice.customer.name = customerName
    if (customerEmail) data.invoice.customer.email = customerEmail
    if (customerPhone) data.invoice.customer.phone = customerPhone
  }

  if (returnUrl) data.actions.return_url = returnUrl
  if (cancelUrl) data.actions.cancel_url = cancelUrl
  if (callbackUrl) data.actions.callback_url = callbackUrl
  if (customData) data.custom_data = customData
  if (channels) data.invoice.channels = channels

  const result = await api(config, 'POST', '/checkout-invoice/create', data)

  if (result.response_code !== '00') {
    throw new Error(result.response_text || 'Échec de création de la facture PayDunya')
  }

  return {
    token: result.token,
    paymentUrl: result.response_text
  }
}

/**
 * Vérifie le statut d'un paiement par son token.
 * Retourne les détails complets du paiement.
 */
export async function confirmInvoice(token) {
  const config = await getConfig()

  const result = await api(config, 'GET', `/checkout-invoice/confirm/${token}`)

  if (result.response_code !== '00') {
    throw new Error(result.response_text || 'Transaction introuvable')
  }

  return {
    status: result.status,
    amount: result.invoice?.total_amount,
    description: result.invoice?.description,
    customer: result.customer,
    receiptUrl: result.receipt_url,
    mode: result.mode,
    failReason: result.fail_reason || null,
    customData: result.custom_data || {},
    raw: result
  }
}

/**
 * Vérifie qu'un callback IPN provient bien de PayDunya.
 * Le hash reçu doit correspondre au SHA-512 de la masterKey.
 */
export function verifyIpnHash(masterKey, hash) {
  const expected = createHash('sha512').update(masterKey).digest('hex')
  return expected === hash
}

/**
 * Calcule le hash de la masterKey pour l'envoyer à PayDunya.
 */
export function getMasterKeyHash(masterKey) {
  return createHash('sha512').update(masterKey).digest('hex')
}
