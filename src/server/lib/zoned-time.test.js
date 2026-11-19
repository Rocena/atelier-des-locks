// @ts-check
import { describe, expect, it } from 'vitest';
import { addDays, utcToZoned, weekdayOf, zonedToUtc } from './zoned-time.js';

const TZ = 'Europe/Paris';

describe('zonedToUtc', () => {
  it('convertit une heure d’hiver (UTC+1) et d’été (UTC+2)', () => {
    expect(zonedToUtc('2026-12-01', '09:00', TZ).toISOString()).toBe('2026-12-01T08:00:00.000Z');
    expect(zonedToUtc('2026-07-01', '09:00', TZ).toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });

  it('passage à l’heure d’été : une heure inexistante est décalée vers l’avant', () => {
    // 29 mars 2026 : 02:00 CET → 03:00 CEST. 02:30 n'existe pas, on prend 03:30 CEST.
    expect(zonedToUtc('2026-03-29', '01:59', TZ).toISOString()).toBe('2026-03-29T00:59:00.000Z');
    expect(zonedToUtc('2026-03-29', '02:30', TZ).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(zonedToUtc('2026-03-29', '03:00', TZ).toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('passage à l’heure d’hiver : une heure ambiguë prend la première occurrence', () => {
    // 25 octobre 2026 : 03:00 CEST → 02:00 CET. 02:30 existe deux fois.
    expect(zonedToUtc('2026-10-25', '02:30', TZ).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(zonedToUtc('2026-10-25', '03:00', TZ).toISOString()).toBe('2026-10-25T02:00:00.000Z');
  });

  it('gère minuit et 24:00', () => {
    expect(zonedToUtc('2026-12-01', '00:00', TZ).toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '24:00', TZ).toISOString()).toBe('2026-12-01T23:00:00.000Z');
  });

  it('refuse les formats invalides', () => {
    expect(() => zonedToUtc('2026-13-01', '09:00', TZ)).toThrow();
    expect(() => zonedToUtc('2026-12-01', '9h', TZ)).toThrow();
  });
});

describe('utcToZoned', () => {
  it('donne la date, l’heure et le jour ISO locaux', () => {
    expect(utcToZoned(new Date('2026-12-01T23:30:00Z'), TZ)).toEqual({
      date: '2026-12-02',
      time: '00:30',
      weekday: 3,
    });
    expect(utcToZoned(new Date('2026-10-25T00:30:00Z'), TZ).time).toBe('02:30');
    expect(utcToZoned(new Date('2026-10-25T01:30:00Z'), TZ).time).toBe('02:30');
  });
});

describe('dates locales', () => {
  it('addDays traverse les mois, les années et les changements d’heure', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('weekdayOf suit la norme ISO (1 = lundi, 7 = dimanche)', () => {
    expect(weekdayOf('2026-11-30')).toBe(1);
    expect(weekdayOf('2026-12-06')).toBe(7);
  });
});
