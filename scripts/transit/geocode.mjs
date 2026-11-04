/**
 * Dédup les arrêts DDD + AFTU, géocode via Nominatim (1.1 s/req), produit zones-seed.json.
 *
 * - Les arrêts AFTU "start"/"finish" ont déjà leurs coordonnées : on les réutilise.
 * - Les autres passent par Nominatim. Cache persistant pour reprise après interruption.
 * - Un arrêt sans géocodage valide reçoit lat/lng du centre de Dakar + status 'pending'.
 *
 * Usage : node scripts/transit/geocode.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const RAW = resolve(ROOT, 'data/transit-raw.json');
const CACHE = resolve(ROOT, 'data/geocode-cache.json');
const OUT = resolve(ROOT, 'data/zones-seed.json');
const UA = 'Procolis-Seed/1.0 (contact: dev@procolis)';
const DAKAR = { lat: 14.6928, lng: -17.4467 };
const NOMINATIM_DELAY_MS = 1100;

const slug = (s) =>
  (typeof s === 'string' ? s : '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function loadJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}

async function geocode(query, cache) {
  if (cache[query] !== undefined) return cache[query];
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: `${query}, Dakar, Sénégal`, format: 'json', limit: '1', countrycodes: 'sn',
  })}`;
  await sleep(NOMINATIM_DELAY_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) { cache[query] = null; return null; }
    const arr = await res.json();
    const hit = arr[0] ? { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) } : null;
    cache[query] = hit;
    return hit;
  } catch {
    cache[query] = null;
    return null;
  }
}

async function main() {
  const raw = await loadJson(RAW);
  if (!raw) throw new Error('data/transit-raw.json manquant : lance scrape.mjs d’abord');
  const cache = await loadJson(CACHE, {});

  // 1) Index des coordonnées AFTU connues (start/finish).
  const known = new Map();
  for (const line of raw.lines) {
    if (line.startCoords) known.set(slug(line.origin), line.startCoords);
    if (line.finishCoords) known.set(slug(line.destination), line.finishCoords);
  }

  // 2) Déduplication des arrêts (slug comme clé canonique).
  const stops = new Map();
  for (const line of raw.lines) {
    for (const name of line.stops) {
      const key = slug(name);
      if (!key) continue;
      if (!stops.has(key)) stops.set(key, { key, name, operators: new Set([line.operator]) });
      else stops.get(key).operators.add(line.operator);
    }
  }
  process.stdout.write(`Arrêts uniques : ${stops.size}\n`);

  // 3) Géocodage : connus d'abord, puis Nominatim, puis fallback Dakar.
  const zones = [];
  let geocoded = 0, cached = 0, fallback = 0;
  for (const [key, stop] of stops) {
    let coords = known.get(key);
    let status = coords ? 'approved' : null;
    let source = coords ? 'aftu-gps' : null;
    if (!coords) {
      const wasCached = cache[stop.name] !== undefined;
      const hit = await geocode(stop.name, cache);
      if (hit) { coords = hit; status = 'approved'; source = 'nominatim'; wasCached ? cached++ : geocoded++; }
    }
    if (!coords) { coords = DAKAR; status = 'pending'; source = 'fallback-dakar'; fallback++; }
    zones.push({
      key, name: stop.name,
      latitude: coords.lat, longitude: coords.lng,
      city: 'Dakar', region: 'Dakar', country: 'Sénégal',
      status, source,
      operators: [...stop.operators],
    });
    if ((geocoded + cached + fallback) % 25 === 0) {
      await writeFile(CACHE, JSON.stringify(cache, null, 2));
      process.stdout.write(`  … ${geocoded} géocodés / ${cached} cache / ${fallback} fallback\n`);
    }
  }
  await writeFile(CACHE, JSON.stringify(cache, null, 2));
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), zones }, null, 2));
  process.stdout.write(`→ ${OUT}\n   ${zones.length} zones (${geocoded + cached} géocodées, ${fallback} fallback)\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
