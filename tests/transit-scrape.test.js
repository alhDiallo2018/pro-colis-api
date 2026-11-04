import { parseDddSection, parseAftuLine } from '../scripts/transit/scrape.mjs';

describe('parsers de scraping DDD / AFTU', () => {
  describe('parseDddSection', () => {
    test('extrait le numéro, origine, destination et arrêts d\'une ligne DDD', () => {
      const html = `
<div class="elementor-accordion-item">
  <div id="elementor-tab-title-1">
    <a class="elementor-accordion-title" tabindex="0">LIGNE 1 : PARCELLES ASSAINIES <--> PLACE LECLERC</a>
  </div>
  <div id="elementor-tab-content-1" class="elementor-tab-content">
    <div>
      <div>Terminus Parcelles</div>
      <div>– Sapeur Pompiers</div>
      <div>– Marché Grand Médine</div>
      <div>– Terminus Leclerc</div>
    </div>
  </div>
</div>`;
      const lines = parseDddSection(html);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        operator: 'DDD', number: '1',
        origin: 'PARCELLES ASSAINIES', destination: 'PLACE LECLERC',
      });
      expect(lines[0].stops).toEqual([
        'Terminus Parcelles', 'Sapeur Pompiers', 'Marché Grand Médine', 'Terminus Leclerc',
      ]);
    });

    test('ignore un titre qui n\'est pas une ligne numérotée', () => {
      const html = `
<div><a class="elementor-accordion-title">LIGNE TAF TAF</a></div>
<div id="elementor-tab-content-1"><div><div>stop a</div><div>stop b</div></div></div>`;
      expect(parseDddSection(html)).toHaveLength(0);
    });

    test('exige au moins deux arrêts', () => {
      const html = `
<a class="elementor-accordion-title">LIGNE 5 : A <--> B</a>
<div id="elementor-tab-content-1"><div><div>Un seul arrêt</div></div></div>`;
      expect(parseDddSection(html)).toHaveLength(0);
    });
  });

  describe('parseAftuLine', () => {
    test('extrait start/finish depuis le GeoJSON embarqué et l\'itinéraire texte', () => {
      const html = `
waymark_viewer.load_json({"type":"FeatureCollection","features":[
  {"geometry":{"type":"Point","coordinates":[-17.44108,14.668913]},"type":"Feature","properties":{"type":"start","title":"Terminus Gare de Lat-Dior"}},
  {"geometry":{"type":"Point","coordinates":[-17.449728,14.745109]},"type":"Feature","properties":{"type":"finish","title":"TERMINUS ESPACE HLM GD MEDINE"}}
]});
<strong>ITINERAIRE</strong></p>
<p>TERMINUS GARE LAT DIOR - RUE SANDINIERY - AVENUE BOURGUIBA - TERMINUS ESPACE HLM GD MEDINE</p>`;
      const line = parseAftuLine(html, '1');
      expect(line).toMatchObject({
        operator: 'AFTU', number: '1',
        origin: 'Terminus Gare de Lat-Dior',
        destination: 'TERMINUS ESPACE HLM GD MEDINE',
        startCoords: { lat: 14.668913, lng: -17.44108 },
        finishCoords: { lat: 14.745109, lng: -17.449728 },
      });
      // Le premier et dernier arrêt viennent du GeoJSON, les intermédiaires du texte.
      expect(line.stops[0]).toBe('Terminus Gare de Lat-Dior');
      expect(line.stops.at(-1)).toBe('TERMINUS ESPACE HLM GD MEDINE');
      expect(line.stops).toContain('RUE SANDINIERY');
    });

    test('renvoie null si le GeoJSON ou l\'itinéraire texte manquent', () => {
      expect(parseAftuLine('<html>rien</html>', '42')).toBeNull();
    });
  });
});
