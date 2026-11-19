// @ts-check
/**
 * Crée un compte de l'administration (le premier, de rôle « owner », puis les suivants).
 *
 *   npm run admin:create                      → compte propriétaire (questions à l'écran)
 *   npm run admin:create -- --role staff      → compte équipe
 *
 * Le mot de passe n'est jamais passé en argument ni affiché : il est saisi à l'invite, masqué.
 * La double authentification est configurée par la personne à sa première connexion
 * (QR code + codes de secours), jamais ici : le secret n'existe que dans son téléphone.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadDotEnv } from '../src/server/config.js';
import { createPool } from '../src/server/db/pool.js';
import { createUser } from '../src/server/modules/auth/service.js';
import { countUsers } from '../src/server/modules/auth/repo.js';

/**
 * @param {string[]} argv
 * @returns {{ role: 'owner'|'staff', help: boolean, error?: string }}
 */
export function parseArgs(argv) {
  /** @type {'owner'|'staff'} */
  let role = 'owner';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { role, help: true };
    if (arg === '--role') {
      const value = argv[i + 1];
      if (value !== 'owner' && value !== 'staff') {
        return { role, help: false, error: 'Le rôle doit être « owner » ou « staff ».' };
      }
      role = value;
      i += 1;
    } else {
      return { role, help: false, error: `Option inconnue : ${arg}` };
    }
  }
  return { role, help: false };
}

/**
 * Pose une question. Réponse masquée si `secret`.
 * @param {string} question
 * @param {boolean} [secret]
 * @returns {Promise<string>}
 */
function ask(question, secret = false) {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      if (secret) process.stdout.write('\n');
      resolve(answer);
    });
    muted = secret;
  });
}

/**
 * @param {{ role: 'owner'|'staff' }} args
 * @param {{ db: import('pg').Pool, prompt: (question: string, secret?: boolean) => Promise<string>, log?: (line: string) => void }} deps
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function run({ role }, { db, prompt, log = console.info }) {
  if (role === 'owner' && (await countUsers(db)) > 0) {
    log('Des comptes existent déjà. Vous allez en ajouter un de plus.');
  }
  const email = (await prompt('Adresse email : ')).trim();
  const displayName = (await prompt('Nom affiché (ex. Awa) : ')).trim();
  const password = await prompt('Mot de passe (12 caractères au moins) : ', true);
  const confirm = await prompt('Confirmez le mot de passe : ', true);
  if (password !== confirm)
    return { ok: false, message: 'Les deux mots de passe ne sont pas identiques.' };
  const result = await createUser(db, { email, displayName, password, role });
  if (!result.ok) return { ok: false, message: result.error };
  return {
    ok: true,
    message: `Compte ${role === 'owner' ? 'propriétaire' : 'équipe'} créé pour ${email.toLowerCase()}.\nÀ la première connexion (/admin), l'application d'authentification sera configurée.`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.error) {
    console.info(args.error ?? 'Usage : npm run admin:create [-- --role owner|staff]');
    process.exit(args.error ? 1 : 0);
  }
  loadDotEnv();
  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  try {
    const outcome = await run(args, { db, prompt: ask });
    console.info(outcome.message);
    process.exitCode = outcome.ok ? 0 : 1;
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
