// @ts-check
import { describe, expect, it } from 'vitest';
import { computeAvailability, findSlot } from './availability.js';
import { utcToZoned } from '../../lib/zoned-time.js';

const TZ = 'Europe/Paris';

/** Horaires réels du salon : mar-ven 9h-12h et 14h-18h, samedi 14h-18h. */
const SALON_HOURS = [2, 3, 4, 5]
  .flatMap((weekday) => [
    { staffId: 1, weekday, opens: '09:00', closes: '12:00' },
    { staffId: 1, weekday, opens: '14:00', closes: '18:00' },
  ])
  .concat([{ staffId: 1, weekday: 6, opens: '14:00', closes: '18:00' }]);

/** Mêmes horaires pour une seconde praticienne. */
const SECOND_STAFF_HOURS = SALON_HOURS.map((h) => ({ ...h, staffId: 2 }));

/**
 * Entrée par défaut : mardi 1er décembre 2026, réservation faite le 20 novembre.
 * @param {Partial<import('./availability.js').AvailabilityInput>} [overrides]
 * @returns {import('./availability.js').AvailabilityInput}
 */
function input(overrides = {}) {
  return {
    timeZone: TZ,
    from: '2026-12-01',
    to: '2026-12-01',
    now: new Date('2026-11-20T10:00:00Z'),
    occupationMinutes: 60,
    stepMinutes: 30,
    minNoticeHours: 24,
    horizonDays: 60,
    longServiceMinutes: 240,
    staffIds: [1],
    weeklyHours: SALON_HOURS,
    closures: [],
    busy: [],
    ...overrides,
  };
}

/**
 * Heures locales de début des créneaux d'une journée (lisible dans les assertions).
 * @param {import('./availability.js').DayAvailability[]} days
 * @param {string} [date]
 */
function starts(days, date) {
  const day = date ? days.find((d) => d.date === date) : days[0];
  if (!day) throw new Error(`Jour absent : ${date}`);
  return day.slots.map((s) => utcToZoned(new Date(s.startsAt), TZ).time);
}

/** @param {string} from @param {string} to */
const paris = (from, to) => ({ startsAt: new Date(from), endsAt: new Date(to) });

describe('horaires hebdomadaires', () => {
  it('propose des créneaux toutes les 30 min dans chaque plage du mardi', () => {
    expect(starts(computeAvailability(input()))).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
      '16:00',
      '16:30',
      '17:00',
    ]);
  });

  it('renvoie un jour par date demandée, vide quand le salon est fermé', () => {
    const days = computeAvailability(input({ from: '2026-11-29', to: '2026-12-05' }));
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
    ]);
    expect(starts(days, '2026-11-29')).toEqual([]); // dimanche
    expect(starts(days, '2026-11-30')).toEqual([]); // lundi
    expect(starts(days, '2026-12-05')[0]).toBe('14:00'); // samedi après-midi seulement
  });

  it('les créneaux sont en UTC et indiquent leur fin', () => {
    const [first] = computeAvailability(input())[0].slots;
    expect(first).toEqual({
      startsAt: '2026-12-01T08:00:00.000Z',
      endsAt: '2026-12-01T09:00:00.000Z',
      staffIds: [1],
    });
  });

  it('un RDV court ne traverse pas la pause de midi', () => {
    const times = starts(computeAvailability(input({ occupationMinutes: 90 })));
    expect(times.filter((t) => t < '12:00')).toEqual(['09:00', '09:30', '10:00', '10:30']);
    expect(times).not.toContain('11:00');
  });

  it('un RDV qui remplit exactement une plage est accepté', () => {
    expect(starts(computeAvailability(input({ occupationMinutes: 180 })))).toEqual([
      '09:00',
      '14:00',
      '14:30',
      '15:00',
    ]);
  });

  it('respecte un pas de 15 minutes', () => {
    const times = starts(computeAvailability(input({ stepMinutes: 15, occupationMinutes: 45 })));
    expect(times.slice(0, 4)).toEqual(['09:00', '09:15', '09:30', '09:45']);
    expect(times.filter((t) => t < '12:00').at(-1)).toBe('11:15');
  });

  it('aucune plage le dimanche ni le lundi', () => {
    expect(starts(computeAvailability(input({ from: '2026-12-06', to: '2026-12-06' })))).toEqual(
      [],
    );
  });
});

describe('prestations longues (4 à 9 h)', () => {
  it('une création de 6h15 traverse la pause et finit au plus tard à 18h', () => {
    const times = starts(computeAvailability(input({ occupationMinutes: 375 })));
    expect(times).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('ne commence jamais pendant la pause', () => {
    const times = starts(computeAvailability(input({ occupationMinutes: 300, stepMinutes: 15 })));
    expect(times.some((t) => t >= '12:00' && t < '14:00')).toBe(false);
  });

  it('9 h tiennent uniquement à 9h en semaine, jamais le samedi', () => {
    const days = computeAvailability(
      input({ occupationMinutes: 540, from: '2026-12-01', to: '2026-12-05' }),
    );
    expect(starts(days, '2026-12-01')).toEqual(['09:00']);
    expect(starts(days, '2026-12-05')).toEqual([]);
  });

  it('au-delà de la journée, aucun créneau', () => {
    expect(starts(computeAvailability(input({ occupationMinutes: 600 })))).toEqual([]);
  });

  it('pile au seuil de 4 h, la prestation peut traverser la pause', () => {
    const times = starts(computeAvailability(input({ occupationMinutes: 240 })));
    expect(times).toContain('09:00');
    expect(times).toContain('14:00');
  });

  it('juste sous le seuil, elle doit tenir dans une seule plage', () => {
    const times = starts(computeAvailability(input({ occupationMinutes: 210 })));
    expect(times).toEqual(['14:00', '14:30']);
  });

  it('un RDV en début d’après-midi bloque une prestation longue du matin', () => {
    const busy = [{ staffId: 1, ...paris('2026-12-01T13:00:00Z', '2026-12-01T14:00:00Z') }];
    // 14h-15h Paris occupé : il faudrait finir avant 14h. 6h15 ne tient plus, 5 h tient à 9h pile.
    expect(starts(computeAvailability(input({ occupationMinutes: 375, busy })))).toEqual([]);
    const shorter = starts(computeAvailability(input({ occupationMinutes: 300, busy })));
    expect(shorter).toEqual(['09:00']);
  });
});

describe('rendez-vous et blocages', () => {
  const busy = [{ staffId: 1, ...paris('2026-12-01T09:00:00Z', '2026-12-01T10:00:00Z') }]; // 10h-11h

  it('exclut les créneaux qui chevauchent un RDV existant', () => {
    const times = starts(computeAvailability(input({ busy })));
    expect(times.filter((t) => t < '12:00')).toEqual(['09:00', '11:00']);
  });

  it('accepte les créneaux contigus (fin = début du RDV suivant)', () => {
    const times = starts(computeAvailability(input({ busy })));
    expect(times).toContain('09:00'); // 9h-10h, puis RDV 10h-11h
    expect(times).toContain('11:00'); // RDV 10h-11h, puis 11h-12h
  });

  it('un blocage de plusieurs jours (congés posés en blocage) vide toutes les journées', () => {
    const vacation = [{ staffId: 1, ...paris('2026-11-30T23:00:00Z', '2026-12-03T23:00:00Z') }];
    const days = computeAvailability(
      input({ busy: vacation, from: '2026-12-01', to: '2026-12-04' }),
    );
    expect(days.map((d) => d.slots.length)).toEqual([0, 0, 0, 12]);
  });

  it('le RDV d’une autre praticienne ne bloque pas', () => {
    const other = [{ staffId: 2, ...paris('2026-12-01T08:00:00Z', '2026-12-01T17:00:00Z') }];
    expect(starts(computeAvailability(input({ busy: other })))).toHaveLength(12);
  });
});

describe('exceptions (fermetures, horaires spéciaux)', () => {
  it('une fermeture du salon sur plusieurs jours ferme chaque journée', () => {
    const closures = [
      /** @type {const} */ ({
        staffId: null,
        kind: 'closed',
        startsOn: '2026-12-22',
        endsOn: '2027-01-02',
      }),
    ];
    const days = computeAvailability(input({ closures, from: '2026-12-21', to: '2027-01-05' }));
    const open = days.filter((d) => d.slots.length > 0).map((d) => d.date);
    expect(open).toEqual(['2027-01-05']);
  });

  it('une fermeture propre à une praticienne ne ferme pas les autres', () => {
    const closures = [
      /** @type {const} */ ({
        staffId: 1,
        kind: 'closed',
        startsOn: '2026-12-01',
        endsOn: '2026-12-01',
      }),
    ];
    const days = computeAvailability(
      input({
        closures,
        staffIds: [1, 2],
        weeklyHours: [...SALON_HOURS, ...SECOND_STAFF_HOURS],
      }),
    );
    expect(days[0].slots.every((s) => s.staffIds.join() === '2')).toBe(true);
    expect(days[0].slots).toHaveLength(12);
  });

  it('des horaires spéciaux remplacent toutes les plages du jour', () => {
    const closures = [
      /** @type {const} */ ({
        staffId: null,
        kind: 'special_hours',
        startsOn: '2026-12-01',
        endsOn: '2026-12-01',
        opens: '10:00',
        closes: '12:00',
      }),
    ];
    expect(starts(computeAvailability(input({ closures })))).toEqual(['10:00', '10:30', '11:00']);
  });

  it('des horaires spéciaux peuvent ouvrir un jour habituellement fermé', () => {
    const closures = [
      /** @type {const} */ ({
        staffId: null,
        kind: 'special_hours',
        startsOn: '2026-12-07',
        endsOn: '2026-12-07',
        opens: '10:00',
        closes: '11:00',
      }),
    ];
    const days = computeAvailability(input({ closures, from: '2026-12-07', to: '2026-12-07' }));
    expect(starts(days)).toEqual(['10:00']);
  });

  it('plusieurs plages spéciales le même jour s’additionnent', () => {
    const special = (/** @type {string} */ opens, /** @type {string} */ closes) =>
      /** @type {const} */ ({
        staffId: null,
        kind: 'special_hours',
        startsOn: '2026-12-01',
        endsOn: '2026-12-01',
        opens,
        closes,
      });
    const closures = [special('09:00', '10:00'), special('16:00', '17:00')];
    expect(starts(computeAvailability(input({ closures })))).toEqual(['09:00', '16:00']);
  });

  it('une fermeture l’emporte sur des horaires spéciaux', () => {
    const closures = [
      /** @type {const} */ ({
        staffId: null,
        kind: 'special_hours',
        startsOn: '2026-12-01',
        endsOn: '2026-12-01',
        opens: '10:00',
        closes: '12:00',
      }),
      /** @type {const} */ ({
        staffId: 1,
        kind: 'closed',
        startsOn: '2026-11-30',
        endsOn: '2026-12-02',
      }),
    ];
    expect(starts(computeAvailability(input({ closures })))).toEqual([]);
  });
});

describe('délai minimum et horizon', () => {
  it('exclut les créneaux à moins de 24 h (borne incluse)', () => {
    // Lundi 30 novembre, 10h Paris (9h UTC) : mardi 9h30 est à 23h30, mardi 10h pile à 24 h.
    const days = computeAvailability(input({ now: new Date('2026-11-30T09:00:00Z') }));
    expect(starts(days)[0]).toBe('10:00');
  });

  it('un délai minimum de 0 h exclut seulement le passé', () => {
    const days = computeAvailability(
      input({ minNoticeHours: 0, now: new Date('2026-12-01T13:10:00Z') }), // 14h10 Paris
    );
    expect(starts(days)[0]).toBe('14:30');
  });

  it('aucun créneau dans le passé', () => {
    const days = computeAvailability(input({ now: new Date('2026-12-10T10:00:00Z') }));
    expect(days[0].slots).toEqual([]);
  });

  it('horizon : le dernier jour réservable est aujourd’hui + N jours (inclus)', () => {
    const days = computeAvailability(
      input({ horizonDays: 11, from: '2026-12-01', to: '2026-12-02' }), // aujourd'hui : 20 nov.
    );
    expect(starts(days, '2026-12-01')).toHaveLength(12);
    expect(starts(days, '2026-12-02')).toEqual([]);
  });

  it('l’horizon se calcule en date locale (à 0h30 à Paris, c’est encore la veille en UTC)', () => {
    // 20 novembre 23h30 UTC = 21 novembre 0h30 Paris : « aujourd'hui » est le 21.
    const days = computeAvailability(
      input({ now: new Date('2026-11-20T23:30:00Z'), horizonDays: 11, to: '2026-12-02' }),
    );
    expect(starts(days, '2026-12-02')).toHaveLength(12);
  });
});

describe('fuseau Europe/Paris et changements d’heure', () => {
  it('9h Paris = 8h UTC en hiver, 7h UTC en été', () => {
    const winter = computeAvailability(
      input({ from: '2026-03-24', to: '2026-03-24', now: new Date('2026-03-01T00:00:00Z') }),
    );
    const summer = computeAvailability(
      input({ from: '2026-03-31', to: '2026-03-31', now: new Date('2026-03-01T00:00:00Z') }),
    );
    expect(winter[0].slots[0].startsAt).toBe('2026-03-24T08:00:00.000Z');
    expect(summer[0].slots[0].startsAt).toBe('2026-03-31T07:00:00.000Z');
  });

  const nightHours = [{ staffId: 1, weekday: 7, opens: '00:00', closes: '06:00' }];

  it('nuit du passage à l’heure d’été : 5 h réelles, pas de 2h', () => {
    const days = computeAvailability(
      input({
        weeklyHours: nightHours,
        from: '2026-03-29',
        to: '2026-03-29',
        now: new Date('2026-03-01T00:00:00Z'),
      }),
    );
    expect(starts(days)).toEqual([
      '00:00',
      '00:30',
      '01:00',
      '01:30',
      '03:00',
      '03:30',
      '04:00',
      '04:30',
      '05:00',
    ]);
  });

  it('nuit du passage à l’heure d’hiver : 7 h réelles, 2h et 2h30 deux fois', () => {
    const days = computeAvailability(
      input({
        weeklyHours: nightHours,
        from: '2026-10-25',
        to: '2026-10-25',
        now: new Date('2026-10-01T00:00:00Z'),
      }),
    );
    const times = starts(days);
    expect(times).toHaveLength(13);
    expect(times.filter((t) => t === '02:00')).toHaveLength(2);
    expect(times.filter((t) => t === '02:30')).toHaveLength(2);
  });

  it('la durée d’un RDV est une durée réelle, même le jour du changement d’heure', () => {
    const [slot] = computeAvailability(
      input({
        weeklyHours: nightHours,
        occupationMinutes: 180,
        from: '2026-10-25',
        to: '2026-10-25',
        now: new Date('2026-10-01T00:00:00Z'),
      }),
    )[0].slots;
    expect(new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()).toBe(180 * 60_000);
    expect(utcToZoned(new Date(slot.endsAt), TZ).time).toBe('02:00'); // 0h + 3 h réelles = 2h (CET)
  });

  it('le changement d’heure 2027 (28 mars) est aussi géré', () => {
    const days = computeAvailability(
      input({ from: '2027-03-30', to: '2027-03-30', now: new Date('2027-03-01T00:00:00Z') }),
    );
    expect(days[0].slots[0].startsAt).toBe('2027-03-30T07:00:00.000Z');
  });
});

describe('plusieurs praticiennes', () => {
  const both = {
    staffIds: [1, 2],
    weeklyHours: [...SALON_HOURS, ...SECOND_STAFF_HOURS],
  };

  it('fusionne les créneaux et liste les praticiennes libres', () => {
    const busy = [{ staffId: 1, ...paris('2026-12-01T08:00:00Z', '2026-12-01T11:00:00Z') }];
    const [day] = computeAvailability(input({ ...both, busy }));
    expect(day.slots[0]).toMatchObject({ staffIds: [2] });
    expect(day.slots.find((s) => s.startsAt === '2026-12-01T13:00:00.000Z')?.staffIds).toEqual([
      1, 2,
    ]);
  });

  it('un créneau reste ouvert tant qu’une praticienne est libre', () => {
    const busy = [
      { staffId: 1, ...paris('2026-12-01T08:00:00Z', '2026-12-01T17:00:00Z') },
      { staffId: 2, ...paris('2026-12-01T08:00:00Z', '2026-12-01T10:00:00Z') },
    ];
    const [day] = computeAvailability(input({ ...both, busy }));
    expect(starts([day])[0]).toBe('11:00');
    expect(day.slots[0].staffIds).toEqual([2]);
  });

  it('ignore une praticienne qui ne réalise pas la prestation', () => {
    const [day] = computeAvailability(input({ ...both, staffIds: [2] }));
    expect(day.slots.every((s) => s.staffIds.join() === '2')).toBe(true);
  });

  it('chaque praticienne a ses propres horaires', () => {
    const hours = [...SALON_HOURS, { staffId: 2, weekday: 1, opens: '10:00', closes: '11:00' }];
    const days = computeAvailability(
      input({ staffIds: [1, 2], weeklyHours: hours, from: '2026-11-30', to: '2026-11-30' }),
    );
    expect(days[0].slots).toEqual([
      {
        startsAt: '2026-11-30T09:00:00.000Z',
        endsAt: '2026-11-30T10:00:00.000Z',
        staffIds: [2],
      },
    ]);
  });

  it('aucune praticienne éligible : aucun créneau', () => {
    expect(computeAvailability(input({ staffIds: [] }))[0].slots).toEqual([]);
  });
});

describe('findSlot (revalidation à la réservation)', () => {
  it('retrouve un créneau libre et ses praticiennes', () => {
    expect(findSlot(input(), new Date('2026-12-01T08:00:00Z'))).toEqual({
      startsAt: '2026-12-01T08:00:00.000Z',
      endsAt: '2026-12-01T09:00:00.000Z',
      staffIds: [1],
    });
  });

  it('refuse un instant pris, hors grille ou fermé', () => {
    const busy = [{ staffId: 1, ...paris('2026-12-01T08:00:00Z', '2026-12-01T09:00:00Z') }];
    expect(findSlot(input({ busy }), new Date('2026-12-01T08:00:00Z'))).toBeNull();
    expect(findSlot(input(), new Date('2026-12-01T08:10:00Z'))).toBeNull();
    expect(findSlot(input(), new Date('2026-11-30T08:00:00Z'))).toBeNull();
  });
});

describe('validation des entrées', () => {
  it.each([
    [{ occupationMinutes: 0 }],
    [{ occupationMinutes: 1.5 }],
    [{ stepMinutes: 0 }],
    [{ from: '2026-12-02', to: '2026-12-01' }],
    [{ from: '2026-12-01', to: '2027-06-01' }],
    [{ from: '01/12/2026' }],
    [{ minNoticeHours: -1 }],
  ])('refuse %o', (overrides) => {
    expect(() => computeAvailability(input(overrides))).toThrow();
  });
});
