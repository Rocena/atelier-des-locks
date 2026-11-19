// @ts-check
/**
 * Tableau de bord (§9) : rendez-vous du jour et de la semaine, chiffre d'affaires estimé du
 * mois, avis à modérer, taux d'absence. Le chiffre d'affaires n'est montré qu'à la propriétaire.
 */
import { addDays, utcToZoned, zonedToUtc } from '../../lib/zoned-time.js';
import * as agenda from '../agenda/repo.js';
import { weekDates } from '../agenda/timeline.js';

const DAY = 86_400_000;

/** Premier jour du mois suivant (date locale). @param {string} date */
export function nextMonthStart(date) {
  const [y, m] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Taux d'absence en pourcentage sur les rendez-vous terminés ou manqués (null si aucun).
 * @param {number} noShow @param {number} finished
 */
export const noShowRate = (noShow, finished) =>
  finished === 0 ? null : Math.round((noShow / finished) * 100);

/**
 * @param {import('pg').Pool} db
 * @param {{ now: Date, timeZone: string, role: 'owner'|'staff' }} q
 */
export async function loadDashboard(db, { now, timeZone, role }) {
  const today = utcToZoned(now, timeZone).date;
  const week = weekDates(today);
  const monthStart = `${today.slice(0, 8)}01`;
  const at = (/** @type {string} */ date) => zonedToUtc(date, '00:00', timeZone);

  const [todays, toValidate, stats] = await Promise.all([
    agenda.findAppointments(db, {
      from: at(today),
      to: at(addDays(today, 1)),
      statuses: ['pending', 'confirmed', 'completed', 'no_show'],
    }),
    agenda.findAppointments(db, {
      from: now,
      to: new Date(now.getTime() + 365 * DAY),
      statuses: ['pending'],
      limit: 10,
    }),
    agenda.findDashboardStats(db, {
      weekFrom: at(week[0]),
      weekTo: at(addDays(week[6], 1)),
      monthFrom: at(monthStart),
      monthTo: at(nextMonthStart(monthStart)),
      noShowSince: new Date(now.getTime() - 90 * DAY),
    }),
  ]);
  return {
    today,
    todays,
    toValidate: toValidate.map((a) => ({ ...a, localDate: utcToZoned(a.startsAt, timeZone).date })),
    stats: {
      weekCount: stats.weekCount,
      reviewsPending: stats.reviewsPending,
      toValidate: stats.toValidate,
      noShowRate: noShowRate(stats.noShow, stats.finished),
      // Le chiffre d'affaires reste réservé à la propriétaire.
      monthRevenue: role === 'owner' ? stats.monthRevenue : null,
      monthUnpriced: role === 'owner' ? stats.monthUnpriced : null,
    },
    monthStart,
  };
}
