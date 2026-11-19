// @ts-check
/**
 * Validation Zod des entrées de la réservation (§13 : toute entrée est validée côté serveur).
 */
import { z } from 'zod';
import { isLocalDate } from '../../lib/zoned-time.js';
import { TOKEN_RE } from './tokens.js';

/** États des cheveux proposés à l'étape 3 (clé stockée → libellé affiché). */
export const HAIR_STATES = /** @type {const} */ ({
  natural: 'Cheveux naturels, pas encore de locks',
  young_locks: 'Locks de moins d’un an',
  mature_locks: 'Locks installées depuis plus d’un an',
  damaged_locks: 'Locks fragilisées ou à réparer',
  relaxed: 'Cheveux défrisés, colorés ou traités',
  unsure: 'Je ne sais pas',
});

/**
 * Normalise un numéro français ou international en E.164 (« +33612345678 »).
 * Accepte espaces, points, tirets, parenthèses, préfixe 00. Renvoie null si invalide.
 * @param {string} raw
 */
export function normalizePhone(raw) {
  let value = String(raw)
    .trim()
    .replace(/[\s.\-()/]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(value)) value = `+33${value.slice(1)}`;
  if (value.startsWith('+330')) value = `+33${value.slice(4)}`; // « +33 0 6 … »
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return null;
  if (value.startsWith('+33') && value.length !== 12) return null;
  return value;
}

const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Case à cocher HTML : présente (« on », « true ») ou absente. */
const checkbox = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'on' || v === 'true' || v === '1');

/** Liste d'identifiants d'options (champ répété ou valeur unique). */
const optionIds = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
  .pipe(
    z
      .array(
        z
          .string()
          .regex(/^\d{1,9}$/)
          .transform(Number),
      )
      .max(10),
  )
  .transform((ids) => [...new Set(ids)]);

const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

/** GET /api/booking/slots */
export const slotsQuery = z
  .object({
    service: slug,
    options: optionIds,
    from: z.string().refine(isLocalDate),
    to: z.string().refine(isLocalDate),
  })
  .strict();

/** Champs texte du formulaire de réservation (multipart). */
export const bookingForm = z.object({
  service: slug,
  options: optionIds,
  startsAt: instant,
  firstName: z.string().trim().min(1, 'Indiquez votre prénom.').max(80),
  lastName: z.string().trim().min(1, 'Indiquez votre nom.').max(80),
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email('Cette adresse email semble incomplète.'))
    .transform((v) => v.toLowerCase()),
  phone: z
    .string()
    .max(40)
    .transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) {
        ctx.addIssue({
          code: 'custom',
          message: 'Indiquez un numéro valide, par exemple 06 12 34 56 78 ou +32 470 12 34 56.',
        });
        return z.NEVER;
      }
      return phone;
    }),
  hairState: z.enum(Object.keys(HAIR_STATES), { message: 'Choisissez l’état de vos cheveux.' }),
  notes: z.string().trim().max(1000, '1 000 caractères au maximum.').default(''),
  policy: checkbox.refine((v) => v, 'Merci d’accepter la politique de rendez-vous.'),
  smsReminders: checkbox,
  newsletter: checkbox,
  // Pot de miel : invisible pour un humain, rempli par les robots.
  website: z.string().max(200).default(''),
  altcha: z.string().max(1024).default(''),
});

/** Paramètre :token des pages « Gérer mon RDV ». */
export const tokenParams = z.object({ token: z.string().regex(TOKEN_RE) });

/** POST /rdv/:token/deplacer */
export const rescheduleBody = z.object({ startsAt: instant, _csrf: z.string().optional() });

/** POST /rdv/:token/annuler */
export const cancelBody = z.object({
  reason: z.string().trim().max(500).default(''),
  _csrf: z.string().optional(),
});

/** GET /rdv/:token/creneaux */
export const manageSlotsQuery = z
  .object({ from: z.string().refine(isLocalDate), to: z.string().refine(isLocalDate) })
  .strict();

/** Paramètre du flux iCal privé. */
export const feedParams = z.object({ token: z.string().min(32).max(200) });
