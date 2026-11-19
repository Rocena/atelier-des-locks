// @ts-check
/**
 * Règles métier pures de la réservation : durée bloquée, prix estimé, politique d'annulation (§7.3, §7.5).
 */

/** Statuts qui autorisent encore un déplacement ou une annulation par la cliente. */
const ACTIVE_STATUSES = new Set(['pending', 'confirmed']);

/**
 * Durée et prix d'une réservation à partir de la prestation et des options choisies.
 * La durée bloquée au planning prend le pire cas : durée max + options + tampon.
 * @param {{ durationMin: number, durationMax: number, bufferAfter: number, price: number|null, priceFrom: boolean, onQuote: boolean }} service
 * @param {{ price: number, extraMinutes: number }[]} options
 */
export function computeBooking(service, options) {
  const extra = options.reduce((sum, o) => sum + o.extraMinutes, 0);
  // Somme en centimes pour éviter les erreurs d'arrondi des flottants.
  const cents =
    service.onQuote || service.price == null
      ? null
      : Math.round(service.price * 100) +
        options.reduce((sum, o) => sum + Math.round(o.price * 100), 0);
  return {
    durationMin: service.durationMin + extra,
    durationMax: service.durationMax + extra,
    bufferMinutes: service.bufferAfter,
    occupationMinutes: service.durationMax + extra + service.bufferAfter,
    price: cents == null ? null : cents / 100,
    priceFrom: service.priceFrom,
  };
}

/**
 * La cliente peut-elle encore déplacer ou annuler elle-même son RDV ?
 * Gratuit jusqu'à X heures avant (borne incluse), ensuite elle doit appeler le salon.
 * @param {{ status: string, startsAt: Date, now: Date, cancellationHours: number }} input
 * @returns {{ allowed: boolean, reason: null|'inactive'|'past'|'too_late', deadline: Date }}
 */
export function selfService({ status, startsAt, now, cancellationHours }) {
  const deadline = new Date(startsAt.getTime() - cancellationHours * 3_600_000);
  if (!ACTIVE_STATUSES.has(status)) return { allowed: false, reason: 'inactive', deadline };
  if (now.getTime() >= startsAt.getTime()) return { allowed: false, reason: 'past', deadline };
  if (now.getTime() > deadline.getTime()) return { allowed: false, reason: 'too_late', deadline };
  return { allowed: true, reason: null, deadline };
}
