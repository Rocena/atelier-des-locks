// @ts-check
/**
 * Validation Zod du formulaire d'avis (§13 : toute entrée est validée côté serveur).
 */
import { z } from 'zod';
import { TOKEN_RE } from '../booking/tokens.js';

/** Paramètre d'URL : jeton de 32 octets en base64url. */
export const tokenParams = z.object({ token: z.string().regex(TOKEN_RE) }).strict();

/** Case à cocher HTML : « on » si cochée, absente sinon. */
const checkbox = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'on' || v === 'true' || v === '1');

/** Texte libre : espaces normalisés, retours à la ligne conservés. @param {string} value */
const tidy = (value) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Prénom : lettres (toutes langues), espaces, apostrophes, traits d'union. */
const firstName = z
  .string()
  .transform((v) => v.normalize('NFC').trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Indiquez votre prénom.')
      .max(40, 'Votre prénom est trop long.')
      .regex(/^[\p{L}][\p{L}\p{M}' ’-]*$/u, 'Votre prénom ne doit contenir que des lettres.'),
  );

/** Formulaire /avis/laisser/:token (champs texte du multipart). */
export const reviewForm = z.object({
  rating: z
    .string({ error: 'Choisissez une note de 1 à 5.' })
    .regex(/^[1-5]$/, 'Choisissez une note de 1 à 5.')
    .transform(Number),
  body: z
    .string({ error: 'Écrivez quelques mots sur votre rendez-vous.' })
    .transform(tidy)
    .pipe(
      z
        .string()
        .min(10, 'Écrivez au moins quelques mots (10 caractères).')
        .max(1500, 'Votre avis est trop long (1 500 caractères au plus).'),
    ),
  firstName,
  lastInitial: z
    .string({ error: 'Indiquez l’initiale de votre nom.' })
    .trim()
    .pipe(
      z
        .string()
        .regex(/^\p{L}$/u, 'Indiquez une seule lettre, l’initiale de votre nom.')
        .transform((v) => v.toLocaleUpperCase('fr-FR')),
    ),
  consent: checkbox.refine((v) => v, 'Votre accord pour la publication est nécessaire.'),
  // Pot de miel : invisible pour les humains.
  website: z.string().max(200).optional().default(''),
  _csrf: z.string().max(500).optional(),
});

/** Nom affiché publiquement : « Awa D. ». @param {{ firstName: string, lastInitial: string }} f */
export const authorName = (f) => `${f.firstName} ${f.lastInitial}.`;
