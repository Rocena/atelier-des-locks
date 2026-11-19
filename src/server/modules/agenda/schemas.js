// @ts-check
/**
 * Validation Zod des entrées de l'agenda (§13 : toute entrée est validée côté serveur).
 */
import { z } from 'zod';
import { normalizePhone } from '../booking/schemas.js';
import { isLocalDate } from '../../lib/zoned-time.js';

/** Case à cocher HTML : présente (« 1 », « on ») ou absente. */
export const checkbox = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'on' || v === 'true' || v === '1');

const localDate = z.string().refine(isLocalDate, 'Date invalide.');
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM).');
const optionalText = (/** @type {number} */ max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

export const agendaQuery = z.object({
  vue: z.enum(['jour', 'semaine', 'liste']).default('jour').catch('jour'),
  date: localDate.optional().catch(undefined),
});

/** Identifiants numériques passés dans l'URL. */
export const idParams = z.object({ id: z.coerce.number().int().positive() });
export const uuidParams = z.object({ id: z.uuid() });

const optionIds = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
  .transform((list) => list.map(Number))
  .refine(
    (list) => list.length <= 20 && list.every((n) => Number.isInteger(n) && n > 0),
    'Options invalides.',
  );

export const manualForm = z
  .object({
    firstName: z.string().trim().min(1, 'Indiquez le prénom.').max(80),
    lastName: z.string().trim().min(1, 'Indiquez le nom.').max(80),
    email: z
      .string()
      .trim()
      .max(254)
      .optional()
      .transform((v) => v?.toLowerCase() || undefined)
      .refine(
        (v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        'Adresse email invalide.',
      ),
    phone: z
      .string()
      .trim()
      .max(30)
      .optional()
      .transform((v) => v || undefined)
      .refine(
        (v) => v === undefined || normalizePhone(v) !== null,
        'Numéro de téléphone invalide.',
      ),
    service: z.string().min(1, 'Choisissez une prestation.').max(80),
    options: optionIds,
    date: localDate,
    time: localTime,
    staffId: z.coerce.number().int().positive().optional().catch(undefined),
    completed: checkbox,
    notify: checkbox,
    notes: optionalText(2000),
    internalNotes: optionalText(2000),
  })
  .refine((v) => v.email || v.phone, {
    path: ['phone'],
    message: 'Indiquez au moins un téléphone ou un email.',
  });

export const statusForm = z.object({
  status: z.enum(['pending', 'confirmed', 'completed', 'no_show', 'cancelled_by_salon']),
  reason: optionalText(500),
  notify: checkbox,
});

export const notesForm = z.object({ notes: optionalText(4000) });

/**
 * Déplacement : soit un instant (ISO 8601, choix d'un créneau), soit un jour et une heure
 * locaux (glisser-déposer). Le serveur convertit les heures locales en instant.
 */
export const moveForm = z
  .object({
    startsAt: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
        'Date invalide.',
      )
      .transform((v) => new Date(v))
      .refine((d) => !Number.isNaN(d.getTime()), 'Date invalide.')
      .optional(),
    date: localDate.optional(),
    time: localTime.optional(),
    notify: checkbox,
  })
  .refine((v) => v.startsAt || (v.date && v.time), { message: 'Indiquez le nouveau créneau.' });

export const slotsQuery = z.object({ date: localDate.optional().catch(undefined) });

export const blockForm = z
  .object({
    date: localDate,
    startTime: localTime,
    endTime: localTime,
    reason: optionalText(200),
    staffId: z.coerce.number().int().positive().optional().catch(undefined),
  })
  .refine((v) => v.endTime > v.startTime, {
    path: ['endTime'],
    message: 'La fin doit être après le début.',
  });
