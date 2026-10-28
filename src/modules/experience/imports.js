import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../../utils/errors.js";
const invalid = (message) => {
  throw new ValidationError([], message);
};

export function csvRows(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/)[0];
  const separator = first.includes(";")
    ? ";"
    : first.includes("\t")
      ? "\t"
      : ",";
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '"') {
      if (quoted && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === separator || char === "\n")) {
      row.push(cell.trim());
      cell = "";
      if (char === "\n") {
        rows.push(row);
        row = [];
      }
    } else if (char !== "\r" || quoted) cell += char;
    if (rows.length > 51 || row.length > 10 || cell.length > 3000)
      invalid("Fichier trop grand : 50 colis et 10 colonnes maximum");
  }
  if (quoted) invalid("Guillemet non fermé dans le CSV");
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some(Boolean));
}
export async function importPreview(buffer, filename) {
  let rows;
  if (/\.csv$/i.test(filename)) rows = csvRows(buffer.toString("utf8"));
  else if (/\.xlsx$/i.test(filename)) {
    // Contrôle avant décompression : un petit ZIP peut cacher un volume énorme.
    let total = 0,
      count = 0;
    unzipSync(buffer, {
      filter: (file) => {
        total += file.originalSize;
        count++;
        if (
          total > 10 * 1024 * 1024 ||
          file.originalSize > 5 * 1024 * 1024 ||
          count > 200
        )
          invalid("Classeur trop volumineux");
        if (/vbaProject|externalLinks/i.test(file.name))
          invalid("Utilisez un classeur simple, sans macro ni lien externe");
        return false;
      },
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    if (book.worksheets.length !== 1)
      invalid("Conservez une seule feuille dans le classeur");
    const sheet = book.worksheets[0];
    if (sheet.rowCount > 51 || sheet.columnCount > 10)
      invalid("50 colis et 10 colonnes maximum");
    rows = [];
    sheet.eachRow((row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (cell.formula || cell.type === ExcelJS.ValueType.Formula)
          invalid("Remplacez les formules par leurs valeurs avant import");
        values.push(cell.text.trim());
      });
      rows.push(values);
    });
  } else
    invalid(
      "Formats acceptés : CSV et XLSX. Convertissez les anciens fichiers XLS.",
    );
  if (rows.length < 2 || rows.length > 51)
    invalid("Le fichier doit contenir un en-tête puis 1 à 50 colis");
  const aliases = {
    nom: "receiverName",
    name: "receiverName",
    receivername: "receiverName",
    telephone: "receiverPhone",
    phone: "receiverPhone",
    receiverphone: "receiverPhone",
    description: "description",
    poids: "weight",
    weight: "weight",
    adresse: "receiverAddress",
    address: "receiverAddress",
    email: "receiverEmail",
  };
  const headers = rows[0].map(
    (h) =>
      aliases[
        h
          .normalize("NFD")
          .replace(/[\u0300-\u036f\s_]/g, "")
          .toLowerCase()
      ],
  );
  for (const field of [
    "receiverName",
    "receiverPhone",
    "description",
    "weight",
  ])
    if (!headers.includes(field)) invalid(`Colonne manquante : ${field}`);
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length)
    invalid("Une colonne est répétée");
  const errors = [],
    drafts = [];
  rows.slice(1).forEach((row, index) => {
    const data = Object.fromEntries(
      headers.map((h, i) => [h, row[i] ?? ""]).filter(([h]) => h),
    );
    const weight = Number(data.weight.replace(",", "."));
    const reasons = [];
    if (!data.receiverName || data.receiverName.length > 100)
      reasons.push("nom requis (100 caractères maximum)");
    if (
      !data.receiverPhone ||
      data.receiverPhone.length < 8 ||
      data.receiverPhone.length > 30
    )
      reasons.push("téléphone invalide");
    if (!data.description || data.description.length > 2000)
      reasons.push("description requise (2000 caractères maximum)");
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100000)
      reasons.push("poids positif requis");
    if (
      data.receiverEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.receiverEmail)
    )
      reasons.push("email invalide");
    if (data.receiverAddress?.length > 500) reasons.push("adresse trop longue");
    if (reasons.length)
      errors.push({ line: index + 2, message: reasons.join(", ") });
    else
      drafts.push({
        id: randomUUID(),
        label: data.receiverName,
        data: { ...data, weight },
      });
  });
  // Pas d'import partiel silencieux : toutes les lignes doivent être corrigées.
  return {
    drafts: errors.length ? [] : drafts,
    errors,
    count: rows.length - 1,
  };
}
