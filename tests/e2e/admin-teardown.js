// @ts-check
/** Supprime comptes et données de test de l'admin après la suite e2e. */
import { purge, withDb } from './admin-fixture.js';

export default async function teardown() {
  await withDb(purge);
}
