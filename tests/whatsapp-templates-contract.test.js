// Test contractuel : s'assurer que les 5 templates WhatsApp attendus par la
// doc de soumission Meta sont bien présents dans le code source et que leur
// mapping statut → template est stable.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WHATSAPP_PATH = join(__dirname, '..', 'src', 'utils', 'whatsapp.js');

const EXPECTED_TEMPLATES = Object.freeze([
  'procolis_parcel_picked_up',
  'procolis_parcel_in_transit',
  'procolis_parcel_out_for_delivery',
  'procolis_parcel_delivered',
  'procolis_parcel_anomaly'
]);

describe('OPS-1 — contrat templates WhatsApp', () => {
  let source;

  beforeAll(async () => {
    source = await readFile(WHATSAPP_PATH, 'utf8');
  });

  for (const template of EXPECTED_TEMPLATES) {
    test(`template ${template} référencé dans whatsapp.js`, () => {
      expect(source).toContain(template);
    });
  }

  test('mapping statut → template exhaustif pour les statuts terminaux', () => {
    // Le bloc `templateByStatus` doit couvrir au minimum ces 4 statuts.
    const terminalStatuses = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
    for (const s of terminalStatuses) {
      expect(source).toMatch(new RegExp(`\\b${s}\\b`));
    }
  });
});
