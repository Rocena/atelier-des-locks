// @ts-check
import { z } from 'zod';

const slug = z
  .string()
  .max(40)
  .regex(/^[a-z0-9-]+$/)
  .optional()
  .catch(undefined);

/** Filtres de la galerie (?categorie=…&methode=…&taille=…). Valeur invalide : filtre ignoré. */
export const galleryQuery = z.object({ categorie: slug, methode: slug, taille: slug });
