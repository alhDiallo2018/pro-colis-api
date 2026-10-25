/** Même recherche pour les listes et les sélecteurs de destinataires.
 * Les mots peuvent être saisis dans un ordre différent ; un numéro formaté
 * (+221 77 123 45 67) est comparé à sa version normalisée en base.
 */
export function userSearchWhere(raw) {
  const search = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
  if (!search) return {};
  const words = search.split(/\s+/).filter(Boolean).slice(0, 10);
  const or = [
    { AND: words.map(word => ({ fullName: { contains: word, mode: 'insensitive' } })) },
    { email: { contains: search, mode: 'insensitive' } }
  ];
  if (/^[+\d\s().-]+$/.test(search)) {
    const digits = search.replace(/\D/g, '').replace(/^00/, '');
    if (digits) or.push({ phone: { contains: digits } });
  }
  return { OR: or };
}
