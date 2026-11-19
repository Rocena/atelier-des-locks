// @ts-check
import { describe, expect, it } from 'vitest';
import { computeBooking, selfService } from './policy.js';

const creation = {
  durationMin: 180,
  durationMax: 360,
  bufferAfter: 15,
  price: 250,
  priceFrom: true,
  onQuote: false,
};

describe('computeBooking : durée bloquée et prix estimé', () => {
  it('durée bloquée = durée max + options + tampon', () => {
    const result = computeBooking(creation, [
      { price: 30, extraMinutes: 30 },
      { price: 40, extraMinutes: 0 },
    ]);
    expect(result).toEqual({
      durationMin: 210,
      durationMax: 390,
      bufferMinutes: 15,
      occupationMinutes: 405,
      price: 320,
      priceFrom: true,
    });
  });

  it('sans option', () => {
    expect(computeBooking(creation, [])).toMatchObject({ occupationMinutes: 375, price: 250 });
  });

  it('prestation sur devis : pas de prix', () => {
    expect(computeBooking({ ...creation, price: null, onQuote: true }, []).price).toBeNull();
  });

  it('évite les erreurs d’arrondi sur les centimes', () => {
    expect(
      computeBooking({ ...creation, price: 0.1 }, [{ price: 0.2, extraMinutes: 0 }]).price,
    ).toBe(0.3);
  });
});

describe('selfService : déplacer ou annuler soi-même (§7.5)', () => {
  const startsAt = new Date('2026-12-10T09:00:00Z');
  const base = { status: 'confirmed', startsAt, cancellationHours: 48 };

  it('autorisé jusqu’à 48 h avant (borne incluse)', () => {
    const result = selfService({ ...base, now: new Date('2026-12-08T09:00:00Z') });
    expect(result).toEqual({
      allowed: true,
      reason: null,
      deadline: new Date('2026-12-08T09:00:00Z'),
    });
  });

  it('refusé à moins de 48 h : il faut appeler le salon', () => {
    expect(selfService({ ...base, now: new Date('2026-12-08T09:00:01Z') })).toMatchObject({
      allowed: false,
      reason: 'too_late',
    });
  });

  it('refusé pour un RDV passé', () => {
    expect(
      selfService({ ...base, cancellationHours: 0, now: new Date('2026-12-10T10:00:00Z') }),
    ).toMatchObject({ allowed: false, reason: 'past' });
  });

  it.each(['cancelled_by_client', 'cancelled_by_salon', 'completed', 'no_show'])(
    'refusé pour un RDV au statut %s',
    (status) => {
      expect(selfService({ ...base, status, now: new Date('2026-12-01T09:00:00Z') })).toMatchObject(
        { allowed: false, reason: 'inactive' },
      );
    },
  );

  it('un RDV en attente de validation peut être annulé', () => {
    expect(
      selfService({ ...base, status: 'pending', now: new Date('2026-12-01T09:00:00Z') }).allowed,
    ).toBe(true);
  });
});
