// @ts-check
/**
 * Ordre des listes (prestations, catégories, photos…) : fonction pure, testée.
 */

/**
 * Déplace un identifiant d'un cran. Hors limites : liste inchangée.
 * @template T
 * @param {T[]} ids
 * @param {T} id
 * @param {'up'|'down'} direction
 * @returns {T[]}
 */
export function moveInList(ids, id, direction) {
  const index = ids.indexOf(id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Nouvel ordre d'un sous-ensemble (glisser-déposer d'un groupe) fusionné dans la liste complète :
 * les éléments hors groupe gardent leur place relative.
 * @param {number[]} all  tous les identifiants, dans l'ordre actuel
 * @param {number[]} reordered  les identifiants du groupe, dans le nouvel ordre
 * @returns {number[]|null}  null si `reordered` n'est pas un sous-ensemble exact de `all`
 */
export function mergeOrder(all, reordered) {
  const set = new Set(reordered);
  if (set.size !== reordered.length || reordered.some((id) => !all.includes(id))) return null;
  const queue = [...reordered];
  return all.map((id) => (set.has(id) ? /** @type {number} */ (queue.shift()) : id));
}
