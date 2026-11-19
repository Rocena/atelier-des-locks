// @ts-check
/**
 * Validation et conversions des formulaires du catalogue (admin).
 * Fonctions pures testées : montants en euros ↔ centimes, slugs, texte long ↔ sections.
 */
import { z } from 'zod';
import { checkbox } from '../agenda/schemas.js';

/** « Création de locks » → « creation-de-locks ». @param {string} text */
export function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * « 85 », « 85,5 » ou « 85.50 » → centimes. Vide → null. Invalide → NaN.
 * @param {string|undefined} text
 */
export function eurosToCents(text) {
  const clean = (text ?? '').trim().replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (clean === '') return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  return Math.round(Number(clean) * 100);
}

/** @param {number|null} cents */
export const centsToEuros = (cents) => (cents == null ? '' : String(cents / 100).replace('.', ','));

/**
 * Texte long → sections [{ title, paragraphs }]. Une ligne « ## Titre » ouvre une section ;
 * une ligne vide sépare deux paragraphes.
 * @param {string|undefined} text
 */
export function parseBody(text) {
  /** @type {{ title: string|null, paragraphs: string[] }[]} */
  const sections = [];
  /** @type {{ title: string|null, paragraphs: string[] }} */
  let current = { title: null, paragraphs: [] };
  for (const block of (text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const heading = /^##\s+(.+)\n?([\s\S]*)$/.exec(trimmed);
    if (heading) {
      if (current.title !== null || current.paragraphs.length) sections.push(current);
      current = { title: heading[1].trim(), paragraphs: [] };
      if (heading[2].trim()) current.paragraphs.push(heading[2].trim().replace(/\n/g, ' '));
    } else {
      current.paragraphs.push(trimmed.replace(/\n/g, ' '));
    }
  }
  if (current.title !== null || current.paragraphs.length) sections.push(current);
  return sections;
}

/** @param {{ title: string|null, paragraphs: string[] }[]} body */
export function bodyToText(body) {
  return (body ?? [])
    .map((s) => [s.title ? `## ${s.title}` : null, ...s.paragraphs].filter(Boolean).join('\n\n'))
    .join('\n\n');
}

/** Une ligne par élément (avantages, points de vigilance). @param {string|undefined} text */
export const parseLines = (text) =>
  (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);

const text = (
  /** @type {number} */ max,
  /** @type {string} */ message = 'Ce champ est obligatoire.',
) => z.string().trim().min(1, message).max(max);
const optionalSlug = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((v) => (v ? slugify(v) : ''));

const money = (/** @type {string} */ label) =>
  z
    .string()
    .optional()
    .transform((v) => eurosToCents(v))
    .refine(
      (v) => v === null || Number.isFinite(v),
      `${label} : montant invalide (ex. 85 ou 85,50).`,
    );

const minutes = (/** @type {number} */ max) => z.coerce.number().int().min(0).max(max);

export const categoryForm = z.object({
  name: text(80, 'Indiquez le nom.'),
  slug: optionalSlug,
  headline: text(200, 'Indiquez le titre de la page.'),
  summary: text(400, 'Indiquez le résumé.'),
  intro: text(2000, 'Indiquez le texte d’introduction.'),
  mediaLabel: text(120, 'Indiquez le libellé du visuel.'),
  active: checkbox,
});

export const serviceForm = z
  .object({
    name: text(120, 'Indiquez le nom.'),
    slug: optionalSlug,
    categoryId: z.preprocess(
      (v) => (v === '' || v === undefined ? null : v),
      z.coerce.number().int().positive().nullable(),
    ),
    summary: text(400, 'Indiquez la description courte.'),
    body: z.string().max(12000).optional(),
    durationMin: z.coerce.number().int().min(5, 'Durée minimale : 5 min.').max(1440),
    durationMax: z.coerce.number().int().min(5, 'Durée maximale : 5 min.').max(1440),
    bufferAfter: minutes(240).default(0),
    price: money('Prix'),
    priceFrom: checkbox,
    onQuote: checkbox,
    active: checkbox,
    bookableOnline: checkbox,
    allergyTest: checkbox,
    featured: checkbox,
    confirmed: checkbox,
  })
  .refine((v) => v.durationMax >= v.durationMin, {
    path: ['durationMax'],
    message: 'La durée maximale doit être au moins égale à la durée minimale.',
  })
  .refine((v) => v.onQuote || v.price !== null, {
    path: ['price'],
    message: 'Indiquez un prix, ou cochez « sur devis ».',
  });

export const optionForm = z.object({
  label: text(80, 'Indiquez le nom de l’option.'),
  price: money('Prix').transform((v) => v ?? 0),
  extraMinutes: minutes(480).default(0),
  active: checkbox,
});

export const methodForm = z.object({
  name: text(80, 'Indiquez le nom.'),
  slug: optionalSlug,
  aka: z.string().trim().max(120).default(''),
  family: z.enum(['installation', 'maintenance', 'both']),
  featured: checkbox,
  summary: text(600, 'Indiquez le résumé.'),
  principle: text(2000, 'Indiquez le principe.'),
  idealFor: text(600, 'Indiquez pour qui c’est idéal.'),
  durationLabel: text(80, 'Indiquez la durée (ex. 3 à 5 h).'),
  maturation: text(600, 'Indiquez la maturation.'),
  maintenance: text(600, 'Indiquez l’entretien.'),
  pros: z.string().max(2000).optional().transform(parseLines),
  watchouts: z.string().max(2000).optional().transform(parseLines),
});

/** Ordre reçu du glisser-déposer : liste d'identifiants. */
export const reorderBody = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
});

export const moveBody = z.object({ direction: z.enum(['up', 'down']) });
