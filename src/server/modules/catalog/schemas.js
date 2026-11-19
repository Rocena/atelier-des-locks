// @ts-check
import { z } from 'zod';

/** Slug d'URL : minuscules, chiffres et tirets. */
export const slugParams = z.object({
  slug: z
    .string()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
