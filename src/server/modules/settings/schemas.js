// @ts-check
/**
 * Validation des réglages et conversions pures (horaires, coordonnées). Testées.
 */
import { z } from 'zod';
import { normalizePhone } from '../booking/schemas.js';
import { checkbox } from '../agenda/schemas.js';
import { isLocalDate } from '../../lib/zoned-time.js';

export const bookingSettingsForm = z.object({
  minNoticeHours: z.coerce.number().int().min(0, 'Entre 0 et 720 h.').max(720, 'Entre 0 et 720 h.'),
  horizonDays: z.coerce
    .number()
    .int()
    .min(7, 'Entre 7 et 365 jours.')
    .max(365, 'Entre 7 et 365 jours.'),
  cancellationHours: z.coerce
    .number()
    .int()
    .min(0, 'Entre 0 et 336 h.')
    .max(336, 'Entre 0 et 336 h.'),
  slotStepMinutes: z.coerce
    .number()
    .int()
    .refine((v) => [15, 20, 30, 45, 60].includes(v), 'Choisissez 15, 20, 30, 45 ou 60 minutes.'),
  longServiceMinutes: z.coerce
    .number()
    .int()
    .min(60, 'Au moins 60 min.')
    .max(720, 'Au plus 720 min.'),
  manualValidation: checkbox,
  policyText: z.string().trim().min(20, 'Rédigez la politique en quelques phrases.').max(1500),
});

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM).')
  .or(z.literal(''));

export const WEEKDAYS = [
  [1, 'Lundi'],
  [2, 'Mardi'],
  [3, 'Mercredi'],
  [4, 'Jeudi'],
  [5, 'Vendredi'],
  [6, 'Samedi'],
  [7, 'Dimanche'],
];

/** Un jour = jusqu'à deux plages (matin, après-midi), champs d1o/d1c/d1o2/d1c2… */
export const hoursForm = z.object(
  Object.fromEntries(
    WEEKDAYS.flatMap(([n]) => [
      [`d${n}a`, time.optional()],
      [`d${n}b`, time.optional()],
      [`d${n}c`, time.optional()],
      [`d${n}d`, time.optional()],
    ]),
  ),
);

/**
 * Formulaire d'horaires → plages. Une plage incomplète ou inversée est une erreur.
 * @param {Record<string, string|undefined>} form
 * @returns {{ ranges: { weekday: number, opens: string, closes: string }[], errors: Record<string, string> }}
 */
export function parseHours(form) {
  /** @type {{ weekday: number, opens: string, closes: string }[]} */
  const ranges = [];
  /** @type {Record<string, string>} */
  const errors = {};
  for (const [n] of WEEKDAYS) {
    /** @type {{ opens: string, closes: string, key: string }[]} */
    const day = [];
    for (const [open, close] of [
      ['a', 'b'],
      ['c', 'd'],
    ]) {
      const o = form[`d${n}${open}`] ?? '';
      const c = form[`d${n}${close}`] ?? '';
      if (!o && !c) continue;
      if (!o || !c) {
        errors[`d${n}${open}`] = 'Indiquez l’ouverture et la fermeture.';
        continue;
      }
      if (c <= o) {
        errors[`d${n}${close}`] = 'La fermeture doit être après l’ouverture.';
        continue;
      }
      day.push({ opens: o, closes: c, key: `d${n}${close}` });
    }
    day.sort((x, y) => x.opens.localeCompare(y.opens));
    for (let i = 1; i < day.length; i += 1) {
      if (day[i].opens < day[i - 1].closes) errors[day[i].key] = 'Les deux plages se chevauchent.';
    }
    for (const r of day) ranges.push({ weekday: Number(n), opens: r.opens, closes: r.closes });
  }
  return { ranges, errors };
}

/** Plages → valeurs du formulaire. @param {{ weekday: number, opens: string, closes: string }[]} ranges */
export function hoursToValues(ranges) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const [n] of WEEKDAYS) {
    const day = ranges.filter((r) => r.weekday === n);
    if (day[0]) [values[`d${n}a`], values[`d${n}b`]] = [day[0].opens, day[0].closes];
    if (day[1]) [values[`d${n}c`], values[`d${n}d`]] = [day[1].opens, day[1].closes];
  }
  return values;
}

const dateField = z.string().refine(isLocalDate, 'Date invalide.');

export const closureForm = z
  .object({
    kind: z.enum(['closed', 'special_hours']),
    startsOn: dateField,
    endsOn: dateField.optional().transform((v) => v || undefined),
    opens: time.optional(),
    closes: time.optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .transform((v) => ({ ...v, endsOn: v.endsOn ?? v.startsOn }))
  .refine((v) => v.endsOn >= v.startsOn, {
    path: ['endsOn'],
    message: 'La fin doit être après le début.',
  })
  .refine((v) => v.kind === 'closed' || (v.opens && v.closes && v.closes > v.opens), {
    path: ['opens'],
    message: 'Indiquez des horaires valides (ouverture avant fermeture).',
  });

/** Lignes « Mardi – vendredi | 9h30 – 19h » → [{ days, time }]. @param {string} text */
export function parseHoursText(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => {
      const [days, ...rest] = line.split('|');
      return { days: days.trim(), time: rest.join('|').trim() || 'Fermé' };
    });
}

/** @param {{ days: string, time: string }[]} hours */
export const hoursToText = (hours) => hours.map((h) => `${h.days} | ${h.time}`).join('\n');

export const contactForm = z.object({
  street: z.string().trim().min(1, 'Indiquez l’adresse.').max(160),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'Code postal à 5 chiffres.'),
  city: z.string().trim().min(1, 'Indiquez la ville.').max(80),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v ?? '')
    .refine((v) => v === '' || normalizePhone(v) !== null, 'Numéro invalide.'),
  whatsapp: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v ?? '')
    .refine((v) => v === '' || normalizePhone(v) !== null, 'Numéro invalide.'),
  instagram: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v ?? '')
    .refine(
      (v) => v === '' || /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._/-]+$/.test(v),
      'Lien Instagram invalide (https://instagram.com/…).',
    ),
  hours: z
    .string()
    .max(600)
    .optional()
    .transform((v) => v ?? ''),
});
