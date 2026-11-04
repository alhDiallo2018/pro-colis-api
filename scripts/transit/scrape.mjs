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
  // Deux passes indépendantes : (1) titres, (2) contenus. Appariement par ordre d'apparition,
  // car id tab-title et id tab-content partagent le même suffixe numérique.
  const items = [];
  // Les titres contiennent du texte avec `<-->` : on autorise `<` dans la capture.
  const titles = [...html.matchAll(/<a class="elementor-accordion-title"[^>]*>(.*?)<\/a>/g)]
    .map(m => decode(m[1]).trim());
  // Le contenu est enveloppé de 3 `</div>` à fermer (outer tab-content > wrapper > last stop).
  const contents = [...html.matchAll(/<div[^>]*id="elementor-tab-content-\d+"[^>]*>([\s\S]*?<\/div>)\s*<\/div>\s*<\/div>/g)]
    .map(m => m[1]);
  const n = Math.min(titles.length, contents.length);
  for (let i = 0; i < n; i++) {
    const match = titles[i].match(/LIGNE\s+([0-9A-Z]+)\s*:\s*(.+?)\s*<-+>\s*(.+)/i);
    if (!match) continue;
    const [, number, from, to] = match;
    const stops = [...contents[i].matchAll(/<div>([^<]+)<\/div>/g)]
      .map(s => decode(s[1]).replace(/^[\s–\-]+/, '').trim())
      .filter(s => s.length > 1 && s.length < 120);
    if (stops.length < 2) continue;
    items.push({
      operator: 'DDD',
      kind,
      number: number.trim(),
      origin: from.trim(),
      destination: to.trim(),
      stops,
      source: 'https://demdikk.sn/reseau-urbain-dakar/',
    });
  }
  return items;
}

async function scrapeDdd() {
  const html = await fetchCached('https://demdikk.sn/reseau-urbain-dakar/', 'ddd-main.html');
  // Le document a deux sections (urbain / banlieue). On les parse ensemble puis on marque.
  // La séparation visuelle "LIGNES BANLIEUE" dans le markup n'est pas structurelle,
  // on marque comme "urban" par défaut, l'opérateur ne distingue pas dans la BDD.
  return parseDddSection(html, 'urban');
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
  // 1) Start / finish : extraits du GeoJSON embarqué dans load_json(...).
  const geoMatch = html.match(/load_json\(\s*(\{[\s\S]*?\})\s*\);/);
  let start = null, finish = null;
  if (geoMatch) {
    try {
      const geo = JSON.parse(geoMatch[1]);
      for (const f of geo.features ?? []) {
        if (f.properties?.type === 'start') {
          start = { name: f.properties.title, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
        } else if (f.properties?.type === 'finish') {
          finish = { name: f.properties.title, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
        }
      }
    } catch {}
  }
  // 2) Itinéraire texte : liste des rues/repères entre terminus.
  const itiMatch = html.match(/<strong>ITINERAIRE<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/i);
  const route = itiMatch ? decode(itiMatch[1]).replace(/<[^>]+>/g, '').trim() : '';
  const landmarks = route
    .split(/\s*[-–]\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && s.length < 120);

  if (!start || !finish || landmarks.length < 2) return null;
  const stops = [start.name, ...landmarks.slice(1, -1), finish.name];
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
