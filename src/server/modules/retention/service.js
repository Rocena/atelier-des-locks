// @ts-check
/**
 * Purge quotidienne selon les durées de conservation de docs/DATABASE.md (§14) :
 * clientes inactives anonymisées (3 ans par défaut, réglage `privacy.client_retention_years`),
 * photos de cheveux 1 an, destinataires des envois et adresses IP 12 mois, sessions expirées.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { withTransaction } from '../../db/pool.js';
import { anonymizeClient } from '../clients/repo.js';
import { getSettings } from '../settings/repo.js';
import * as repo from './repo.js';

export const DEFAULT_RETENTION_YEARS = 3;
const SAFE_PHOTO = /^(hair|reviews)\/[0-9a-f-]{36}\.webp$/;

/** @param {Date} date @param {{ years?: number, months?: number }} delta */
export function subtract(date, { years = 0, months = 0 }) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() - months - years * 12);
  return d;
}

/** @param {unknown} value */
export function retentionYears(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_RETENTION_YEARS;
}

/**
 * @param {import('pg').Pool} db
 * @param {{ uploadDir: string, now?: Date }} options
 */
export async function runRetention(db, { uploadDir, now = new Date() }) {
  const settings = await getSettings(db, ['privacy.client_retention_years']);
  const years = retentionYears(settings['privacy.client_retention_years']);
  /** @type {string[]} */
  const files = [];

  let anonymized = 0;
  for (const id of await repo.findInactiveClientIds(db, subtract(now, { years }))) {
    files.push(...(await withTransaction(db, (tx) => anonymizeClient(tx, id))));
    anonymized += 1;
  }
  files.push(...(await repo.clearOldHairPhotos(db, subtract(now, { years: 1 }))));
  const recipients = await repo.clearOldRecipients(db, subtract(now, { months: 12 }));
  const ips = await repo.clearOldIps(db, subtract(now, { months: 12 }));
  const sessions = await repo.deleteExpiredSessions(db, now);

  // Fichiers supprimés après la validation des transactions ; seuls les noms générés sont acceptés.
  for (const relative of files) {
    if (SAFE_PHOTO.test(relative)) await rm(path.join(uploadDir, relative), { force: true });
  }
  return { anonymized, photos: files.length, recipients, ips, sessions };
}
