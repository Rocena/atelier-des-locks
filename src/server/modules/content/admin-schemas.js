// @ts-check
/**
 * Validation des formulaires de contenu (admin) et conversions pures. Testées.
 */
import { z } from 'zod';
import { checkbox } from '../agenda/schemas.js';
import { isLocalDate } from '../../lib/zoned-time.js';

const text = (/** @type {number} */ max, /** @type {string} */ message) =>
  z.string().trim().min(1, message).max(max);

/** Lien interne (« /le-salon ») ou externe en https. */
const link = z
  .string()
  .trim()
  .max(300)
  .refine(
    (v) => v === '' || /^\/(?!\/)[A-Za-z0-9\-._~/?=&#%]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v),
    'Lien interne (/page) ou https://…',
  );

export const announcementForm = z.object({
  enabled: checkbox,
  text: text(200, 'Écrivez le message du bandeau.'),
  linkLabel: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v ?? ''),
  href: link.optional().transform((v) => v ?? ''),
});

/**
 * Identifiant du bandeau : change quand le message change, pour le ré-afficher aux visiteuses qui
 * l'avaient fermé. @param {string} text @param {string} href @param {string|undefined} previousId @param {{ text?: string, href?: string }|undefined} previous
 */
export function announcementId(text, href, previousId, previous) {
  if (previousId && previous?.text === text && previous?.href === href) return previousId;
  return `a${Date.now().toString(36)}`;
}

export const presentationForm = z.object({
  clients: z.coerce.number().int().min(0).max(100000),
  yearsOfPractice: z.coerce.number().int().min(0).max(80),
  firstName: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v ?? ''),
  displayName: text(80, 'Indiquez le nom affiché.'),
  role: text(80, 'Indiquez la fonction.'),
});

export const faqForm = z.object({
  groupId: z.coerce.number().int().positive(),
  question: text(300, 'Écrivez la question.'),
  answer: text(3000, 'Écrivez la réponse.'),
});

/** Temps de lecture : 200 mots par minute, au moins 1. @param {{ paragraphs: string[], title: string|null }[]} sections */
export function readingMinutes(sections) {
  const words = sections
    .flatMap((s) => [s.title ?? '', ...s.paragraphs])
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export const articleForm = z
  .object({
    title: text(200, 'Écrivez le titre.'),
    slug: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((v) => v ?? ''),
    excerpt: text(400, 'Écrivez le résumé.'),
    body: z.string().trim().min(1, 'Écrivez l’article.').max(40000),
    status: z.enum(['draft', 'published']),
    publishedOn: z
      .string()
      .optional()
      .transform((v) => v || undefined),
  })
  .refine((v) => v.publishedOn === undefined || isLocalDate(v.publishedOn), {
    path: ['publishedOn'],
    message: 'Date invalide.',
  });

export const MAX_STAGES = 8;

/**
 * Étapes de la vie d'une loc : lignes name{i}/period{i}/text{i}. Une ligne sans nom est ignorée.
 * @param {Record<string, string|undefined>} form
 * @returns {{ stages: { name: string, period: string, text: string }[], errors: Record<string, string> }}
 */
export function parseStages(form) {
  /** @type {{ name: string, period: string, text: string }[]} */
  const stages = [];
  /** @type {Record<string, string>} */
  const errors = {};
  for (let i = 1; i <= MAX_STAGES; i += 1) {
    const name = (form[`name${i}`] ?? '').trim();
    const period = (form[`period${i}`] ?? '').trim();
    const body = (form[`text${i}`] ?? '').trim();
    if (!name && !period && !body) continue;
    if (!name) errors[`name${i}`] = 'Donnez un nom à cette étape.';
    else if (!body) errors[`text${i}`] = 'Décrivez cette étape.';
    else
      stages.push({
        name: name.slice(0, 80),
        period: period.slice(0, 80),
        text: body.slice(0, 600),
      });
  }
  if (stages.length === 0 && Object.keys(errors).length === 0)
    errors.name1 = 'Gardez au moins une étape.';
  return { stages, errors };
}

/** @param {{ name: string, period: string, text: string }[]} stages */
export function stagesToValues(stages) {
  /** @type {Record<string, string>} */
  const values = {};
  stages.forEach((s, i) => {
    values[`name${i + 1}`] = s.name;
    values[`period${i + 1}`] = s.period;
    values[`text${i + 1}`] = s.text;
  });
  return values;
}
