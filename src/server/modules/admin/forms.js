// @ts-check
/**
 * Descriptions de champs pour les formulaires génériques de l'admin (template `admin/formulaire`).
 * @typedef {object} FieldSpec
 * @property {string} [name] @property {string} [label] @property {string} [type] @property {string} [hint]
 * @property {boolean} [required] @property {boolean} [checked] @property {'check'} [kind]
 * @property {Array<{ value: string|number, label: string }>} [options]
 * @property {number} [rows] @property {number} [maxlength] @property {string} [inputmode]
 * @property {string} [legend] @property {FieldSpec[]} [row]
 * @property {number} [min] @property {number} [max] @property {number} [step]
 * @property {string} [autocomplete] @property {string} [pattern] @property {string} [idPrefix]
 */

/**
 * @param {string} name @param {string} label @param {Partial<FieldSpec>} [rest]
 * @returns {FieldSpec}
 */
export const field = (name, label, rest = {}) => ({ name, label, ...rest });

/** @param {string} name @param {string} label @param {Partial<FieldSpec>} [rest] @returns {FieldSpec} */
export const check = (name, label, rest = {}) => ({ name, label, kind: 'check', ...rest });

/** @param {...FieldSpec} fields @returns {FieldSpec} */
export const row = (...fields) => ({ row: fields });

/** @param {string} legend @returns {FieldSpec} */
export const legend = (legend) => ({ legend });

/**
 * Valeurs d'un formulaire à partir d'un objet : tout en chaîne, booléens en « 1 » ou absents.
 * @param {Record<string, unknown>} data
 */
export function toValues(data) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === true) out[key] = '1';
    else if (value === false || value == null) continue;
    else out[key] = String(value);
  }
  return out;
}
