// @ts-check
import { z } from 'zod';

/** Slug d'URL : minuscules, chiffres et tirets. */
export const slugParams = z.object({
  slug: z
    .string()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

/** GET /api/services?categorie=… : filtre facultatif, valeur invalide ignorée. */
export const servicesQuery = z.object({
  categorie: z
    .string()
    .max(40)
    .regex(/^[a-z0-9-]+$/)
    .optional()
    .catch(undefined),
});

/**
 * Vue publique d'une prestation : retire les champs internes (marqueur « à confirmer »).
 * @param {import('./repo.js').Service} service
 */
export function publicService(service) {
  return /** @type {Omit<typeof service, 'isPlaceholder'>} */ (
    Object.fromEntries(Object.entries(service).filter(([key]) => key !== 'isPlaceholder'))
  );
}
