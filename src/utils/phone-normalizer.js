// Api/src/utils/phone-normalizer.js

/**
 * Normalise un numéro de téléphone en supprimant les caractères non numériques
 * et en extrayant le numéro local (sans indicatif pays).
 * 
 * Cette fonction est conçue pour être internationale et fonctionner avec
 * n'importe quel pays.
 * 
 * Exemples:
 * - "+221770000101" → "770000101"
 * - "+33612345678" → "612345678" (France)
 * - "+14155552671" → "4155552671" (USA)
 * - "00221770000101" → "770000101"
 * - "221770000101" → "770000101"
 * - "770000101" → "770000101"
 */
export function normalizePhone(phone) {
  if (!phone) return '';

  // Supprimer tous les caractères non numériques
  const digits = phone.replace(/\D/g, '');

  // Détecter l'indicatif pays
  // Si le numéro commence par un indicatif pays reconnu, on retire l'indicatif
  const countryCode = detectCountryCode(digits);

  if (countryCode && digits.length > countryCode.length) {
    // Retirer l'indicatif pays et retourner le numéro local
    return digits.slice(countryCode.length);
  }

  // Si aucun indicatif pays détecté, retourner tel quel
  return digits;
}

/**
 * Détecte l'indicatif pays à partir des premiers chiffres du numéro.
 * Retourne l'indicatif pays trouvé ou null.
 */
function detectCountryCode(digits) {
  // Liste des indicatifs pays (les plus courants)
  // Triés par longueur décroissante pour éviter les conflits
  const countryCodes = [
    // Afrique
    '221', // Sénégal
    '225', // Côte d'Ivoire
    '223', // Mali
    '224', // Guinée
    '222', // Mauritanie
    '226', // Burkina Faso
    '227', // Niger
    '228', // Togo
    '229', // Bénin
    '231', // Liberia
    '232', // Sierra Leone
    '233', // Ghana
    '234', // Nigeria
    '235', // Tchad
    '236', // République Centrafricaine
    '237', // Cameroun
    '238', // Cap-Vert
    '239', // Sao Tomé-et-Principe
    '240', // Guinée Équatoriale
    '241', // Gabon
    '242', // République du Congo
    '243', // République Démocratique du Congo
    '244', // Angola
    '245', // Guinée-Bissau
    '246', // Diego Garcia
    '248', // Seychelles
    '249', // Soudan
    '250', // Rwanda
    '251', // Éthiopie
    '252', // Somalie
    '253', // Djibouti
    '254', // Kenya
    '255', // Tanzanie
    '256', // Ouganda
    '257', // Burundi
    '258', // Mozambique
    '260', // Zambie
    '261', // Madagascar
    '262', // Réunion
    '263', // Zimbabwe
    '264', // Namibie
    '265', // Malawi
    '266', // Lesotho
    '267', // Botswana
    '268', // Eswatini
    '269', // Comores
    '27', // Afrique du Sud
    '290', // Sainte-Hélène
    '291', // Érythrée
    '297', // Aruba
    '298', // Îles Féroé
    '299', // Groenland

    // Europe
    '30', // Grèce
    '31', // Pays-Bas
    '32', // Belgique
    '33', // France
    '34', // Espagne
    '36', // Hongrie
    '39', // Italie
    '40', // Roumanie
    '41', // Suisse
    '43', // Autriche
    '44', // Royaume-Uni
    '45', // Danemark
    '46', // Suède
    '47', // Norvège
    '48', // Pologne
    '49', // Allemagne

    // Amérique du Nord
    '1', // USA / Canada

    // Amérique Centrale & Caraïbes
    '501', // Belize
    '502', // Guatemala
    '503', // Salvador
    '504', // Honduras
    '505', // Nicaragua
    '506', // Costa Rica
    '507', // Panama
    '508', // Saint-Pierre-et-Miquelon
    '509', // Haïti

    // Amérique du Sud
    '54', // Argentine
    '55', // Brésil
    '56', // Chili
    '57', // Colombie
    '58', // Venezuela
    '591', // Bolivie
    '592', // Guyana
    '593', // Équateur
    '595', // Paraguay
    '596', // Martinique
    '597', // Suriname
    '598', // Uruguay
    '599', // Antilles Néerlandaises

    // Asie
    '60', // Malaisie
    '61', // Australie
    '62', // Indonésie
    '63', // Philippines
    '64', // Nouvelle-Zélande
    '65', // Singapour
    '66', // Thaïlande
    '7', // Russie / Kazakhstan
    '81', // Japon
    '82', // Corée du Sud
    '84', // Viêt Nam
    '85', // Corée du Nord
    '86', // Chine
    '90', // Turquie
    '91', // Inde
    '92', // Pakistan
    '93', // Afghanistan
    '94', // Sri Lanka
    '95', // Myanmar
    '98', // Iran

    // Moyen-Orient
    '961', // Liban
    '962', // Jordanie
    '963', // Syrie
    '964', // Irak
    '965', // Koweït
    '966', // Arabie Saoudite
    '967', // Yémen
    '968', // Oman
    '970', // Palestine
    '971', // Émirats Arabes Unis
    '972', // Israël
    '973', // Bahreïn
    '974', // Qatar
    '975', // Bhoutan
    '976', // Mongolie
    '977', // Népal
    '992', // Tadjikistan
    '993', // Turkménistan
    '994', // Azerbaïdjan
    '995', // Géorgie
    '996', // Kirghizistan
    '998', // Ouzbékistan
  ];

  // Trier par longueur décroissante pour détecter les codes les plus longs d'abord
  const sortedCodes = countryCodes.sort((a, b) => b.length - a.length);

  for (const code of sortedCodes) {
    if (digits.startsWith(code)) {
      return code;
    }
  }

  return null;
}

/**
 * Génère toutes les variantes possibles d'un numéro de téléphone
 * pour une recherche en base de données qui couvre tous les formats.
 * 
 * Cette version est dynamique et fonctionne pour n'importe quel pays.
 * 
 * Exemple avec "770000101" (Sénégal):
 * - "770000101" (format local)
 * - "221770000101" (format international sans +)
 * - "+221770000101" (format international avec +)
 * - "00221770000101" (format alternatif)
 * 
 * Exemple avec "612345678" (France):
 * - "612345678" (format local)
 * - "33612345678" (format international sans +)
 * - "+33612345678" (format international avec +)
 * - "0033612345678" (format alternatif)
 */
export function phoneSearchVariants(phone) {
  if (!phone) return [];

  const normalized = normalizePhone(phone);
  const variants = new Set();

  // Format local
  variants.add(normalized);

  // Détecter l'indicatif pays à partir du numéro complet original
  // pour créer des variantes internationales
  const digits = phone.replace(/\D/g, '');
  const countryCode = detectCountryCode(digits);

  if (countryCode) {
    // Format international sans +
    variants.add(`${countryCode}${normalized}`);

    // Format international avec +
    variants.add(`+${countryCode}${normalized}`);

    // Format alternatif (00 + code pays)
    variants.add(`00${countryCode}${normalized}`);
  } else {
    // Si aucun indicatif pays détecté, essayer de déterminer à partir du numéro
    // Si le numéro commence par +, extraire le code pays
    if (phone.startsWith('+')) {
      const withoutPlus = phone.slice(1).replace(/\D/g, '');
      const detectedCode = detectCountryCode(withoutPlus);
      if (detectedCode) {
        variants.add(`${detectedCode}${normalized}`);
        variants.add(`+${detectedCode}${normalized}`);
        variants.add(`00${detectedCode}${normalized}`);
      }
    }

    // Si le numéro commence par 00, extraire le code pays
    if (phone.startsWith('00')) {
      const without00 = phone.slice(2).replace(/\D/g, '');
      const detectedCode = detectCountryCode(without00);
      if (detectedCode) {
        variants.add(`${detectedCode}${normalized}`);
        variants.add(`+${detectedCode}${normalized}`);
        variants.add(`00${detectedCode}${normalized}`);
      }
    }
  }

  return Array.from(variants);
}

/**
 * Compare deux numéros de téléphone en les normalisant d'abord.
 * Retourne true si les numéros correspondent après normalisation.
 * 
 * Cette version est dynamique et fonctionne pour n'importe quel pays.
 */
export function phonesMatch(phone1, phone2) {
  if (!phone1 || !phone2) return false;

  const normalized1 = normalizePhone(phone1);
  const normalized2 = normalizePhone(phone2);

  return normalized1 === normalized2;
}

/**
 * Extrait l'indicatif pays d'un numéro de téléphone.
 * Retourne l'indicatif pays ou null.
 */
export function extractCountryCode(phone) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, '');
  return detectCountryCode(digits);
}

/**
 * Valide un numéro de téléphone international.
 * Vérifie que le numéro contient au moins un indicatif pays valide.
 */
export function isValidInternationalPhone(phone) {
  if (!phone) return false;

  const digits = phone.replace(/\D/g, '');
  const countryCode = detectCountryCode(digits);

  // Un numéro international valide doit avoir :
  // - Un indicatif pays détecté
  // - Au moins 5 chiffres au total (code pays + numéro local)
  if (countryCode && digits.length >= 5) {
    return true;
  }

  return false;
}

/**
 * Formate un numéro de téléphone dans un format lisible.
 * Exemple: "+221 77 000 01 01"
 */
export function formatPhone(phone) {
  if (!phone) return '';

  const normalized = normalizePhone(phone);
  const countryCode = extractCountryCode(phone);

  if (!countryCode) return phone;

  // Formater en groupes de 2 chiffres pour le numéro local
  const localNumber = normalized;
  const groups = localNumber.match(/.{1,2}/g) || [];

  return `+${countryCode} ${groups.join(' ')}`;
}

/**
 * Version simplifiée de normalizePhone pour les cas où on veut
 * juste nettoyer les caractères non numériques sans retirer l'indicatif.
 */
export function cleanPhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}