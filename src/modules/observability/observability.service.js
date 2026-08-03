import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { sanitizeForLog } from '../../config/logger.js';
import {
  InvalidObservabilityQueryError,
  ObservabilityUnavailableError
} from '../../utils/errors.js';

const MAX_RANGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_EXPORT_RANGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 60 * 60 * 1000;

export const OBSERVABILITY_SOURCES = ['api', 'postgres', 'caddy', 'frontend', 'docker'];

// Roles autorises a lire les journaux techniques sans restriction. Tout autre
// role passe par `redactEntryForSupport`.
export const OBSERVABILITY_FULL_ACCESS_ROLES = ['super_admin'];
export const OBSERVABILITY_LEVELS = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency'
];

const pinoSeverity = new Map([
  [10, 'debug'],
  [20, 'debug'],
  [30, 'info'],
  [40, 'warning'],
  [50, 'error'],
  [60, 'critical']
]);

const severityAliases = new Map([
  ['trace', 'debug'],
  ['debug', 'debug'],
  ['log', 'info'],
  ['info', 'info'],
  ['notice', 'notice'],
  ['warn', 'warning'],
  ['warning', 'warning'],
  ['error', 'error'],
  ['err', 'error'],
  ['fatal', 'critical'],
  ['critical', 'critical'],
  ['crit', 'critical'],
  ['alert', 'alert'],
  ['panic', 'emergency'],
  ['emergency', 'emergency'],
  ['emerg', 'emergency']
]);

const timestampNsByEntry = new WeakMap();

function invalid(path, message) {
  return new InvalidObservabilityQueryError('Filtres d observabilite invalides', [{ path, message }]);
}

function parseIsoDate(value, fallback, path) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid(path, 'Date ISO invalide');
  return date;
}

function parseCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !/^\d{16,20}$/.test(decoded.timestamp)
      || !/^[a-f0-9]{24}$/.test(decoded.id)
    ) throw new Error('invalid');
    return decoded;
  } catch {
    throw invalid('query.cursor', 'Curseur invalide');
  }
}

function parseLevels(value) {
  if (!value) return [];
  const levels = String(value).split(',').map((level) => level.trim().toLowerCase()).filter(Boolean);
  if (levels.length === 0 || levels.some((level) => !OBSERVABILITY_LEVELS.includes(level))) {
    throw invalid('query.levels', 'Niveau de journal invalide');
  }
  return [...new Set(levels)];
}

export function parseObservabilityQuery(query = {}, { exportMode = false } = {}) {
  const now = new Date();
  const to = parseIsoDate(query.to, now, 'query.to');
  const from = parseIsoDate(query.from, new Date(to.getTime() - DEFAULT_RANGE_MS), 'query.from');
  const maxRange = exportMode ? MAX_EXPORT_RANGE_MS : MAX_RANGE_MS;

  if (from >= to) throw invalid('query.from', 'La date de debut doit preceder la date de fin');
  if (to.getTime() - from.getTime() > maxRange) {
    throw invalid('query.from', `La periode ne peut pas depasser ${exportMode ? '24 heures' : '14 jours'}`);
  }
  if (to.getTime() > now.getTime() + 60_000) throw invalid('query.to', 'La date de fin est dans le futur');

  const source = query.source ? String(query.source).toLowerCase() : undefined;
  if (source && !OBSERVABILITY_SOURCES.includes(source)) {
    throw invalid('query.source', 'Source de journal invalide');
  }

  const q = query.q === undefined ? undefined : String(query.q).trim();
  if (q && (q.length < 2 || q.length > 200)) {
    throw invalid('query.q', 'La recherche doit contenir entre 2 et 200 caracteres');
  }

  const requestId = query.requestId === undefined ? undefined : String(query.requestId).trim();
  if (requestId && (requestId.length < 8 || requestId.length > 128)) {
    throw invalid('query.requestId', 'Request ID invalide');
  }

  const requestedLimit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 20 || requestedLimit > 200) {
    throw invalid('query.limit', 'La limite doit etre comprise entre 20 et 200');
  }

  const format = query.format === undefined ? 'csv' : String(query.format).toLowerCase();
  if (exportMode && !['csv', 'jsonl'].includes(format)) {
    throw invalid('query.format', 'Le format doit etre csv ou jsonl');
  }

  const cursor = exportMode ? null : parseCursor(query.cursor);
  if (cursor) {
    const cursorMs = Number(BigInt(cursor.timestamp) / 1_000_000n);
    if (!Number.isSafeInteger(cursorMs) || cursorMs < from.getTime() || cursorMs > to.getTime()) {
      throw invalid('query.cursor', 'Le curseur est hors de la periode demandee');
    }
  }

  return {
    source,
    levels: parseLevels(query.levels),
    q,
    requestId,
    from,
    to,
    limit: requestedLimit,
    cursor,
    format
  };
}

function escapeLogQlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
}

function sourceMatcher(source) {
  if (!source) return null;
  if (source === 'docker') return ['service', 'alloy|loki|prometheus|grafana|node-exporter|postgres-exporter|blackbox-exporter'];
  return ['service', escapeLogQlString(source)];
}

export function buildLogQuery(filters) {
  const labels = ['environment="production"'];
  const source = sourceMatcher(filters.source);
  if (source) {
    labels.push(source[1].includes('|') ? `${source[0]}=~"${source[1]}"` : `${source[0]}="${source[1]}"`);
  }
  if (filters.levels?.length) {
    labels.push(`severity=~"${filters.levels.map(escapeLogQlString).join('|')}"`);
  }

  let query = `{${labels.join(',')}}`;
  // La recherche reste un filtre litteral Loki. L'utilisateur ne peut fournir
  // ni selecteur de flux, ni pipeline LogQL, ni expression reguliere.
  if (filters.q) query += ` |= "${escapeLogQlString(filters.q)}"`;
  if (filters.requestId) {
    query += ` | json | requestId="${escapeLogQlString(filters.requestId)}"`;
  }
  return query;
}

function toNanoseconds(date) {
  return (BigInt(date.getTime()) * 1_000_000n).toString();
}

async function fetchJson(baseUrl, pathname, params) {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OBSERVABILITY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`upstream status ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new ObservabilityUnavailableError(
      error.name === 'AbortError'
        ? 'Le service d observabilite a expire'
        : 'Service d observabilite indisponible'
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseNestedJson(line) {
  let value = line;
  for (let depth = 0; depth < 2; depth += 1) {
    if (typeof value !== 'string') break;
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
    if (value && typeof value === 'object' && typeof value.log === 'string') value = value.log.trim();
  }
  return value && typeof value === 'object' ? value : { message: String(value) };
}

export function normalizeSeverity(value, numericLevel) {
  if (typeof value === 'number' && pinoSeverity.has(value)) return pinoSeverity.get(value);
  if (numericLevel !== undefined && pinoSeverity.has(Number(numericLevel))) return pinoSeverity.get(Number(numericLevel));
  return severityAliases.get(String(value || '').toLowerCase()) || 'info';
}

function timestampFromNanoseconds(value) {
  try {
    return new Date(Number(BigInt(value) / 1_000_000n)).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function cleanError(error) {
  if (!error) return undefined;
  if (typeof error === 'string') return { message: error };
  return {
    name: error.name || error.type,
    code: error.code,
    message: error.message,
    stack: error.stack
  };
}

function createEntry(timestamp, line, stream) {
  const parsed = parseNestedJson(line);
  const source = parsed.source || parsed.service || stream.service || 'docker';
  const severity = normalizeSeverity(parsed.severity || parsed.level_name || stream.severity, parsed.level);
  const message = parsed.message || parsed.msg || parsed.error?.message || parsed.err?.message || String(line);
  const id = createHash('sha256').update(`${timestamp}\0${source}\0${line}`).digest('hex').slice(0, 24);

  const knownKeys = new Set([
    'time', 'timestamp', 'level', 'level_name', 'severity', 'source', 'service', 'environment',
    'release', 'message', 'msg', 'requestId', 'route', 'path', 'method', 'statusCode',
    'status', 'durationMs', 'responseTime', 'userId', 'error', 'err', 'req', 'res'
  ]);
  const context = Object.fromEntries(Object.entries(parsed).filter(([key]) => !knownKeys.has(key)));

  const entry = sanitizeForLog({
    id,
    timestamp: timestampFromNanoseconds(timestamp),
    severity,
    source,
    environment: parsed.environment || stream.environment || 'production',
    message,
    requestId: parsed.requestId || parsed.req?.id,
    route: parsed.route || parsed.path || parsed.req?.url,
    method: parsed.method || parsed.req?.method,
    statusCode: parsed.statusCode || parsed.status || parsed.res?.statusCode,
    durationMs: parsed.durationMs || parsed.responseTime,
    userId: parsed.userId,
    error: cleanError(parsed.error || parsed.err),
    context
  });
  timestampNsByEntry.set(entry, timestamp);
  return entry;
}

export function normalizeLokiStreams(payload) {
  const streams = payload?.data?.resultType === 'streams' ? payload.data.result : [];
  const entries = streams.flatMap((result) =>
    (result.values || []).map(([timestamp, line]) => createEntry(timestamp, line, result.stream || {}))
  );
  return entries.sort((a, b) => {
    const timeOrder = Date.parse(b.timestamp) - Date.parse(a.timestamp);
    return timeOrder || b.id.localeCompare(a.id);
  });
}

function encodeCursor(entry) {
  const timestamp = timestampNsByEntry.get(entry) || toNanoseconds(new Date(entry.timestamp));
  return Buffer.from(JSON.stringify({ timestamp, id: entry.id }), 'utf8').toString('base64url');
}

function entryPrecedesCursor(entry, cursor) {
  if (!cursor) return true;
  const timestamp = timestampNsByEntry.get(entry) || toNanoseconds(new Date(entry.timestamp));
  return BigInt(timestamp) < BigInt(cursor.timestamp)
    || (timestamp === cursor.timestamp && entry.id < cursor.id);
}

async function queryLogs(filters, limit) {
  const end = filters.cursor
    ? new Date(Number(BigInt(filters.cursor.timestamp) / 1_000_000n))
    : filters.to;
  const payload = await fetchJson(env.LOKI_BASE_URL, '/loki/api/v1/query_range', {
    query: buildLogQuery(filters),
    start: toNanoseconds(filters.from),
    end: toNanoseconds(end),
    direction: 'backward',
    limit: filters.cursor ? Math.min(limit + 50, 10_000) : limit
  });
  return normalizeLokiStreams(payload).filter((entry) => entryPrecedesCursor(entry, filters.cursor));
}

/**
 * Vue restreinte destinee au support technique. Le support doit pouvoir
 * qualifier un incident (quoi, quand, ou, quelle requete) sans lire le detail
 * d'implementation : la stack, le contexte libre du logger et l'identifiant de
 * l'utilisateur concerne sont retires. La redaction s'applique apres la
 * pagination pour ne pas invalider le curseur, qui est calcule sur l'entree
 * complete.
 */
export function redactEntryForSupport(entry) {
  const { error, context, userId, ...visible } = entry;
  void context;
  void userId;
  return {
    ...visible,
    // Le type et le code d'erreur restent des informations de triage ; le
    // message et la stack peuvent, eux, transporter du contexte metier.
    error: error ? { name: error.name, code: error.code } : undefined,
    redacted: true
  };
}

export function redactEntriesForSupport(entries) {
  return entries.map(redactEntryForSupport);
}

export async function getLogs(filters) {
  const entries = await queryLogs(filters, filters.limit + 1);
  const logs = entries.slice(0, filters.limit);
  const hasMore = entries.length > filters.limit;
  return {
    logs,
    page: {
      limit: filters.limit,
      hasMore,
      nextCursor: hasMore && logs.length ? encodeCursor(logs.at(-1)) : null
    }
  };
}

function vectorCounts(payload, label) {
  if (payload?.data?.resultType !== 'vector') return {};
  return Object.fromEntries(
    payload.data.result.map((item) => [item.metric?.[label] || 'unknown', Number(item.value?.[1] || 0)])
  );
}

async function getLogCounts(filters, groupLabel) {
  const seconds = Math.max(1, Math.ceil((filters.to.getTime() - filters.from.getTime()) / 1000));
  const logQuery = buildLogQuery({ ...filters, levels: [], q: undefined, requestId: undefined });
  return fetchJson(env.LOKI_BASE_URL, '/loki/api/v1/query', {
    query: `sum by (${groupLabel}) (count_over_time(${logQuery}[${seconds}s]))`,
    time: filters.to.toISOString()
  });
}

export async function getServices() {
  const payload = await fetchJson(env.PROMETHEUS_BASE_URL, '/api/v1/query', {
    query: 'procolis_service_up{service=~"api|postgres|caddy|loki|alloy|prometheus"}'
  });
  if (payload.status !== 'success' || payload.data?.resultType !== 'vector') {
    throw new ObservabilityUnavailableError();
  }

  const expectedServices = ['api', 'postgres', 'caddy', 'loki', 'alloy', 'prometheus'];
  const statuses = new Map(payload.data.result.map((item) => [
    item.metric?.service || item.metric?.job || item.metric?.instance,
    Number(item.value?.[1]) === 1
  ]));
  return expectedServices.map((service) => ({
    service,
    status: statuses.get(service) ? 'healthy' : 'unavailable',
    checkedAt: new Date().toISOString()
  }));
}

export async function getSummary(filters) {
  const [byLevelPayload, bySourcePayload, latest, services] = await Promise.all([
    getLogCounts(filters, 'severity'),
    getLogCounts(filters, 'service'),
    queryLogs({ ...filters, limit: 1, cursor: null }, 1),
    getServices()
  ]);
  const byLevel = vectorCounts(byLevelPayload, 'severity');
  const bySource = vectorCounts(bySourcePayload, 'service');
  return {
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    total: Object.values(byLevel).reduce((sum, count) => sum + count, 0),
    byLevel,
    bySource,
    latestAt: latest[0]?.timestamp || null,
    services
  };
}

function csvCell(value) {
  let serialized = value === undefined || value === null
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Un journal peut commencer par une formule. Neutraliser ces prefixes evite
  // une execution lors de l'ouverture de l'export dans Excel ou LibreOffice.
  if (/^[=+\-@\t\r]/.test(serialized)) serialized = `'${serialized}`;
  return `"${serialized.replace(/"/g, '""')}"`;
}

export async function exportLogs(filters) {
  const logs = (await queryLogs({ ...filters, cursor: null }, 10_000)).slice(0, 10_000);
  if (filters.format === 'jsonl') {
    return {
      contentType: 'application/x-ndjson; charset=utf-8',
      extension: 'jsonl',
      content: `${logs.map((entry) => JSON.stringify(entry)).join('\n')}${logs.length ? '\n' : ''}`,
      count: logs.length
    };
  }

  const columns = [
    'timestamp', 'severity', 'source', 'message', 'requestId', 'route', 'method',
    'statusCode', 'durationMs', 'userId', 'error', 'context'
  ];
  const rows = [columns.map(csvCell).join(',')];
  for (const entry of logs) rows.push(columns.map((column) => csvCell(entry[column])).join(','));
  return {
    contentType: 'text/csv; charset=utf-8',
    extension: 'csv',
    content: `${rows.join('\n')}\n`,
    count: logs.length
  };
}
