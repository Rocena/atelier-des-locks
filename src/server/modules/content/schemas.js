// @ts-check
import { z } from 'zod';

/** Clé d'un bloc de contenu : minuscules, chiffres, points et soulignés (ex. methods.stages). */
export const contentKeyParams = z.object({
  key: z
    .string()
    .max(80)
    .regex(/^[a-z0-9_.]+$/),
});
