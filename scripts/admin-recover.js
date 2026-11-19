// @ts-check
/**
 * Dépannage d'un compte de l'administration, depuis le serveur.
 *
 *   node scripts/admin-recover.js --email awa@exemple.fr --unlock
 *       Lève le verrouillage (trop d'essais de connexion).
 *   node scripts/admin-recover.js --email awa@exemple.fr --reset-2fa
 *       Téléphone ET codes de secours perdus : efface la 2FA (un nouveau QR code sera proposé à la
 *       prochaine connexion), ferme les sessions ouvertes, lève le verrouillage.
 *
 * Dans Docker : docker compose exec app node scripts/admin-recover.js --email … --unlock
 * L'opération est inscrite dans le journal d'activité. Le mot de passe n'est jamais touché.
 */
import { fileURLToPath } from 'node:url';
import { loadConfig, loadDotEnv } from '../src/server/config.js';
import { createPool } from '../src/server/db/pool.js';
import { resetTwoFactorByEmail, unlockUserByEmail } from '../src/server/modules/auth/repo.js';
import { insertAudit } from '../src/server/modules/audit/repo.js';

/**
 * @param {string[]} argv
 * @returns {{ email?: string, action?: 'unlock'|'reset-2fa', help: boolean, error?: string }}
 */
export function parseArgs(argv) {
  /** @type {{ email?: string, action?: 'unlock'|'reset-2fa', help: boolean, error?: string }} */
  const out = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--email') {
      out.email = argv[i + 1]?.trim().toLowerCase();
      i += 1;
    } else if (arg === '--unlock' || arg === '--reset-2fa') {
      if (out.action && out.action !== arg.slice(2)) {
        return { help: false, error: 'Choisissez --unlock OU --reset-2fa, pas les deux.' };
      }
      out.action = /** @type {'unlock'|'reset-2fa'} */ (arg.slice(2));
    } else return { help: false, error: `Option inconnue : ${arg}` };
  }
  if (!out.help && (!out.email || !out.action)) {
    return { help: false, error: 'Indiquez --email ADRESSE et --unlock ou --reset-2fa.' };
  }
  return out;
}

/**
 * @param {{ email: string, action: 'unlock'|'reset-2fa' }} args
 * @param {{ db: import('pg').Pool }} deps
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function run({ email, action }, { db }) {
  const id =
    action === 'unlock'
      ? await unlockUserByEmail(db, email)
      : await resetTwoFactorByEmail(db, email);
  if (!id) return { ok: false, message: `Aucun compte pour ${email}.` };
  await insertAudit(db, {
    userId: null,
    action: action === 'unlock' ? 'auth.unlock_cli' : 'auth.reset_2fa_cli',
    entityType: 'user',
    entityId: id,
    details: { by: 'script en ligne de commande sur le serveur' },
  });
  return {
    ok: true,
    message:
      action === 'unlock'
        ? `Compte ${email} débloqué.`
        : `2FA de ${email} réinitialisée : un nouveau QR code sera proposé à sa prochaine connexion.`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.error) {
    console.info(
      args.error ??
        'Usage : node scripts/admin-recover.js --email ADRESSE (--unlock | --reset-2fa)',
    );
    process.exit(args.error ? 1 : 0);
  }
  loadDotEnv();
  const db = createPool(loadConfig().databaseUrl);
  try {
    const outcome = await run(
      /** @type {{ email: string, action: 'unlock'|'reset-2fa' }} */ (args),
      { db },
    );
    console.info(outcome.message);
    process.exitCode = outcome.ok ? 0 : 1;
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
