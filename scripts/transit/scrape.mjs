/**
 * Scrape les lignes DDD (demdikk.sn) et AFTU (aftu-senegal.org).
 * Écrit data/transit-raw.json. Idempotent, relançable.
 *
 * Usage : node scripts/transit/scrape.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DATA_DIR = resolve(ROOT, 'data');
const CACHE_DIR = resolve(DATA_DIR, 'transit-cache');
const OUT_FILE = resolve(DATA_DIR, 'transit-raw.json');
const UA = 'Mozilla/5.0 Procolis-Seed/1.0 (contact: dev@procolis)';

async function fetchCached(url, cacheName) {
  const cachePath = resolve(CACHE_DIR, cacheName);
  if (existsSync(cachePath)) return readFile(cachePath, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const html = await res.text();
  await writeFile(cachePath, html);
  await sleep(500);
  return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// DDD : page unique avec accordéons. Chaque LIGNE = titre + bloc de <div>stop</div>.
export function parseDddSection(html, kind = 'urban') {
  const items = [];

  // Les marqueurs Elementor déterminent les sections réelles.
  const markers = [...html.matchAll(
    /<span[^>]*class="[^"]*elementor-alert-title[^"]*"[^>]*>(.*?)<\/span>/gi
  )];

  let urbanPos = -1;
  let suburbanPos = -1;

  for (const marker of markers) {
    const label = decode(marker[1]).trim().toUpperCase();
    if (label === 'LIGNES URBAINES') urbanPos = marker.index;
    if (label === 'LIGNES BANLIEUE') suburbanPos = marker.index;
  }

  // Index des contenus par identifiant Elementor.
  const contents = new Map();
  const contentRe =
    /<div[^>]*id="elementor-tab-content-(\d+)"[^>]*>([\s\S]*?<\/div>)\s*<\/div>\s*<\/div>/gi;

  for (const m of html.matchAll(contentRe)) {
    contents.set(m[1], m[2]);
  }

  // Chaque titre est associé uniquement au contenu portant le même ID.
  const titleRe =
    /<div[^>]*id="elementor-tab-title-(\d+)"[^>]*>([\s\S]*?)<\/div>/gi;

  for (const m of html.matchAll(titleRe)) {
    const id = m[1];
    const titleBlock = m[2];
    const titleMatch = titleBlock.match(
      /<a[^>]*class="[^"]*elementor-accordion-title[^"]*"[^>]*>(.*?)<\/a>/i
    );
    if (!titleMatch) continue;

    const title = decode(titleMatch[1]).trim();
    const lineMatch = title.match(
      /LIGNE\s+([0-9A-Z]+)\s*:\s*(.+?)\s*<-+>\s*(.+)/i
    );
    if (!lineMatch) continue;

    const content = contents.get(id);
    if (!content) continue;

    const stops = [...content.matchAll(/<div>([^<]+)<\/div>/g)]
      .map(x => decode(x[1]).replace(/^[\s–\-]+/, '').trim())
      .filter(x => x.length > 1 && x.length < 120);

    if (stops.length < 2) continue;

    let lineKind = kind;
    if (kind === null && urbanPos >= 0 && suburbanPos >= 0) {
      lineKind = m.index > suburbanPos ? 'suburban' : 'urban';
    }

    const [, number, from, to] = lineMatch;
    items.push({
      operator: 'DDD',
      kind: lineKind ?? 'urban',
      number: number.trim(),
      origin: from.trim(),
      destination: to.trim(),
      stops,
      source: 'https://demdikk.sn/reseau-urbain-dakar/',
      sourceRef: `elementor-tab-${id}`,
    });
  }

  return items;
}

async function scrapeDdd() {
  const html = await fetchCached(
    'https://demdikk.sn/reseau-urbain-dakar/',
    'ddd-main.html'
  );

  // null active la classification par marqueurs HTML.
  return parseDddSection(html, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// AFTU : index + sous-pages. Chaque sous-page porte les GPS start/finish.
async function scrapeAftu() {
  const index = await fetchCached('https://aftu-senegal.org/infos-pratiques/', 'aftu-main.html');
  const linkRe = /href="(https:\/\/aftu-senegal\.org\/map\/dakar-(?:urbain|banlieue)-ligne-[0-9A-Z]+\/)"/gi;
  const urls = [...new Set([...index.matchAll(linkRe)].map(m => m[1]))];
  const lines = [];
  for (const url of urls) {
    const slug = url.match(/ligne-([0-9A-Z]+)/i)?.[1];
    const kind = url.includes('banlieue') ? 'suburban' : 'urban';
    try {
      const html = await fetchCached(url, `aftu-${kind}-${slug}.html`);
      const parsed = parseAftuLine(html, slug, kind, url);
      if (parsed) lines.push(parsed);
      process.stdout.write(`AFTU ${kind} ligne ${slug} ✓\n`);
    } catch (e) {
      process.stdout.write(`AFTU ${kind} ligne ${slug} ✗ (${e.message})\n`);
    }
  }
  return lines;
}

export function parseAftuLine(html, number, kind = 'urban', url = '') {
  const geoMatch = html.match(/load_json\(\s*(\{[\s\S]*?\})\s*\);/);

  let start = null;
  let finish = null;
  const pointFeatures = [];

  if (geoMatch) {
    try {
      const geo = JSON.parse(geoMatch[1]);

      for (const f of geo.features ?? []) {
        if (f.geometry?.type !== 'Point') continue;

        const props = f.properties ?? {};
        const coords = f.geometry.coordinates ?? [];
        if (
          coords.length < 2 ||
          !Number.isFinite(coords[0]) ||
          !Number.isFinite(coords[1])
        ) continue;

        const point = {
          name: props.title?.trim() || null,
          lat: coords[1],
          lng: coords[0],
          type: props.type,
        };

        pointFeatures.push(point);

        if (props.type === 'start' && !start) start = point;
        if (props.type === 'finish') finish = point;
      }
    } catch {}
  }

  let inferredFinish = false;

  // Certaines pages AFTU typent par erreur le second terminus "start".
  if (
    !finish &&
    pointFeatures.length === 2 &&
    pointFeatures[0].type === 'start' &&
    pointFeatures[1].type === 'start' &&
    pointFeatures[0].name !== pointFeatures[1].name
  ) {
    finish = pointFeatures[1];
    inferredFinish = true;
  }

  const itiMatch = html.match(
    /<strong>ITINERAIRE<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/i
  );

  const route = itiMatch
    ? decode(itiMatch[1]).replace(/<[^>]+>/g, '').trim()
    : '';

  const landmarks = route
    ? route.split(/\s*–\s*|\s+-\s+/)
        .map(x => x.trim())
        .filter(x => x.length > 1 && x.length < 120)
    : [];

  // Certaines pages AFTU ont un point de départ sans titre.
  // On récupère son nom depuis le premier arrêt de l'itinéraire.
  if (start && !start.name && landmarks.length >= 2) {
    start.name = landmarks[0];
  }

  if (!start || !finish || !start.name || !finish.name) return null;

  const stops = landmarks.length >= 2
    ? [start.name, ...landmarks.slice(1, -1), finish.name]
    : [start.name, finish.name];

  const warnings = [];
  if (!route || landmarks.length < 2) {
    warnings.push('missing_text_itinerary');
  }
  if (inferredFinish) {
    warnings.push('finish_inferred_from_second_start_point');
  }

  return {
    operator: 'AFTU',
    kind,
    number,
    origin: start.name,
    destination: finish.name,
    stops,
    startCoords: { lat: start.lat, lng: start.lng },
    finishCoords: { lat: finish.lat, lng: finish.lng },
    source: url,
    extractionStatus: warnings.length ? 'partial' : 'complete',
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
function decode(s) {
  return s
    .replace(/&#8217;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…');
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  process.stdout.write('→ DDD\n');
  const ddd = await scrapeDdd();
  process.stdout.write(`DDD : ${ddd.length} lignes\n→ AFTU\n`);
  const aftu = await scrapeAftu();
  process.stdout.write(`AFTU : ${aftu.length} lignes\n`);
  const payload = { generatedAt: new Date().toISOString(), lines: [...ddd, ...aftu] };
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  process.stdout.write(`→ ${OUT_FILE} (${payload.lines.length} lignes au total)\n`);
}

// N'exécute le pipeline que si lancé directement (pas quand importé par les tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}
