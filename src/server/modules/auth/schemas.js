// @ts-check
import { z } from 'zod';

export const loginBody = z.object({
  email: z.string().trim().min(1, 'Indiquez votre adresse email.').max(254),
  password: z.string().min(1, 'Indiquez votre mot de passe.').max(200),
});

/** Code TOTP (6 chiffres, espaces tolérés) ou code de secours (12 caractères, tirets tolérés). */
export const secondFactorBody = z.object({
  code: z.string().trim().min(1, 'Saisissez un code.').max(40),
  kind: z.enum(['totp', 'recovery']).default('totp'),
});

export const setupBody = z.object({
  code: z.string().trim().min(1, 'Saisissez le code affiché par l’application.').max(20),
});

export const passwordBody = z
  .object({
    current: z.string().min(1, 'Indiquez votre mot de passe actuel.').max(200),
    next: z.string().min(1, 'Indiquez le nouveau mot de passe.').max(200),
    confirm: z.string().max(200),
  })
  .refine((v) => v.next === v.confirm, {
    path: ['confirm'],
    message: 'Les deux mots de passe ne sont pas identiques.',
  });

export const recoveryBody = z.object({
  code: z.string().trim().min(1, 'Saisissez le code de votre application.').max(20),
});

/**
 * Erreurs Zod → { champ: message } pour les formulaires.
 * @param {import('zod').ZodError} error
 * @returns {Record<string, string>}
 */
export function fieldErrors(error) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    // Champ absent ou de mauvais type : message français plutôt que l'anglais de Zod.
    out[key] ??= issue.message.startsWith('Invalid') ? 'Ce champ est à vérifier.' : issue.message;
  }
  return out;
}
