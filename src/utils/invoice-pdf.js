/**
 * Générateur de PDF minimaliste pour les relevés mensuels B2B.
 *
 * Pas de dépendance externe : on produit un PDF 1.4 à la main, avec un seul
 * objet page et une police standard (Helvetica, intégrée dans tous les
 * lecteurs PDF). Suffisant pour un relevé texte — si un rendu plus riche
 * devient nécessaire (logo, tableaux), passer à `pdfkit` ou `puppeteer`.
 *
 * Les caractères sortent en WinAnsiEncoding (compatible Latin-1) : les
 * accents français s'affichent correctement. Les parenthèses et backslash
 * sont échappés pour respecter la syntaxe PDF des chaînes littérales.
 */

const FONT_WIDTH_UNITS_PER_EM = 1000;
const HELVETICA_AVG_WIDTH = 500;

function toWinAnsi(str) {
  // Latin-1 code points ≤ 0xFF passent tels quels dans WinAnsi. Au-delà, on
  // remplace par '?' pour éviter un PDF mal formé.
  const bytes = [];
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code <= 0xff) {
      bytes.push(code);
    } else {
      bytes.push(0x3f);
    }
  }
  return Buffer.from(bytes);
}

function escapePdfText(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Compose un PDF à partir d'une liste de lignes texte.
 *
 * @param {{ title?: string, lines: string[] }} options
 * @returns {Buffer}
 */
export function buildTextPdf({ title, lines }) {
  const safeLines = [];
  if (title) safeLines.push({ text: title, size: 18, bold: true });
  safeLines.push({ text: '', size: 12 });
  for (const line of lines ?? []) {
    safeLines.push({ text: String(line ?? ''), size: 11 });
  }

  // Construction du flux de contenu (BT ... ET). Positionnement en 72 ppi.
  // MediaBox A4 portrait : 595 x 842 points. On commence en haut à 800.
  let y = 800;
  const contentChunks = [];
  for (const row of safeLines) {
    const font = row.bold ? '/F2' : '/F1';
    const size = row.size ?? 11;
    const safe = escapePdfText(row.text);
    contentChunks.push(`BT ${font} ${size} Tf 50 ${y} Td (${safe}) Tj ET\n`);
    y -= size + 4;
  }
  const streamBody = contentChunks.join('');
  const streamBytes = toWinAnsi(streamBody);

  // Objets PDF.
  const objects = [];
  const push = (body) => {
    const id = objects.length + 1;
    objects.push({ id, body });
    return id;
  };

  const fontRegularId = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBoldId = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const streamId = objects.length + 1;
  // Le stream contient des bytes binaires : on le concatène après l'en-tête de l'objet.
  objects.push({
    id: streamId,
    body: `<< /Length ${streamBytes.length} >>\nstream\n`,
    stream: streamBytes,
    streamSuffix: '\nendstream'
  });
  const resourcesBody = `<< /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >>`;
  const pageId = push(
    `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 595 842] /Contents ${streamId} 0 R /Resources ${resourcesBody} >>`
  );
  const pagesId = push(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  const catalogId = push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  // Rebind Pages parent → remplace '0 0 R' dans l'objet page.
  const pageIndex = objects.findIndex((o) => o.id === pageId);
  objects[pageIndex] = {
    id: pageId,
    body: objects[pageIndex].body.replace(
      '/Parent 0 0 R',
      `/Parent ${pagesId} 0 R`
    )
  };

  // Sérialisation binaire sûre.
  const chunks = [];
  chunks.push(Buffer.from('%PDF-1.4\n%\xC2\xA5\xC2\xB1\xC3\xAB\n', 'binary'));
  const offsets = [];
  for (const obj of objects) {
    offsets.push(getTotalLength(chunks));
    chunks.push(Buffer.from(`${obj.id} 0 obj\n`, 'binary'));
    chunks.push(Buffer.from(obj.body, 'binary'));
    if (obj.stream) {
      chunks.push(obj.stream);
      chunks.push(Buffer.from(obj.streamSuffix, 'binary'));
    }
    chunks.push(Buffer.from('\nendobj\n', 'binary'));
  }
  const xrefOffset = getTotalLength(chunks);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  chunks.push(Buffer.from(xref, 'binary'));
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
      'binary'
    )
  );
  return Buffer.concat(chunks);
}

function getTotalLength(chunks) {
  return chunks.reduce((n, c) => n + c.length, 0);
}

/**
 * Suggère la largeur d'une chaîne dans la police courante pour tronquer un
 * libellé qui déborderait de la page.
 */
export function suggestTruncate(str, maxWidthPoints = 500, fontSize = 11) {
  const avg = (fontSize * HELVETICA_AVG_WIDTH) / FONT_WIDTH_UNITS_PER_EM;
  const max = Math.max(4, Math.floor(maxWidthPoints / avg));
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
}
