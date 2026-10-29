import { parseShuttleCsv } from '../src/modules/trips/import.service.js';

describe('format CSV des itinéraires navette', () => {
  const parse = text => parseShuttleCsv(Buffer.from(text));
  test('BOM Excel, séparateur point-virgule et plusieurs lignes', () => {
    const result = parse('\uFEFFligne;zone;minutes\r\n45;Dakar;0\r\n45;Thiès;90\r\n46;Thiès;0\r\n46;Dakar;95');
    expect(result.map(r => r.lineNumber)).toEqual(['45', '46']);
    expect(result[0].stops[1]).toMatchObject({ zone: 'Thiès', offsetMinutes: 90, line: 3 });
  });
  test('guillemets et séparateurs dans les noms', () => {
    const routes = parse('lineNumber,zoneId,offsetMinutes\n45,"Dakar, Plateau",0\n45,Thiès,90');
    expect(routes[0].stops[0].zone).toBe('Dakar, Plateau');
  });
  test.each([
    ['ligne;zone;minutes\n45;Dakar;5\n45;Thiès;90', 'commencer à 0'],
    ['ligne;zone;minutes\n45;Dakar;0\n45;Thiès;0', 'augmenter'],
    ['ligne;zone;minutes\n45;Dakar;0\n45;Thiès;1.5', 'entière'],
    ['ligne;zone;minutes\n45;Dakar;0\n46;Thiès;90', 'commencer à 0'],
    ['ligne;zone;minutes\n45;Dakar;0\n45;Thiès;90;extra', 'trois colonnes'],
    ['ligne;ligne;minutes\n45;Dakar;0\n45;Thiès;90', 'Colonnes'],
    ['ligne;zone;minutes\n45;"Dakar;0\n45;Thiès;90', 'Guillemet'],
  ])('refuse un fichier incohérent sans le réparer silencieusement', (csv, message) => {
    expect(() => parse(csv)).toThrow(message);
  });
  test('refuse plus de 40 arrêts sur une seule ligne et un fichier trop volumineux', () => {
    expect(() => parse('ligne;zone;minutes\n' + Array.from({ length: 41 }, (_, i) => `45;zone${i};${i}`).join('\n'))).toThrow('40 arrêts');
    expect(() => parseShuttleCsv(Buffer.alloc(128 * 1024 + 1))).toThrow('128 Ko');
  });
});
