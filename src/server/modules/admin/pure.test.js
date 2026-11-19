// @ts-check
/**
 * Fonctions pures de l'administration : ordre, formatage, formulaires de catalogue, d'horaires
 * et de contenu, export CSV, frise de l'agenda.
 */
import { describe, expect, it } from 'vitest';
import { clientsToCsv, csvCell } from '../clients/csv.js';
import {
  PLACEHOLDER_DOMAIN,
  displayEmail,
  isPlaceholderEmail,
  placeholderEmailFor,
} from '../clients/placeholder.js';
import {
  announcementId,
  parseStages,
  readingMinutes,
  stagesToValues,
} from '../content/admin-schemas.js';
import { cleanDetails } from '../audit/service.js';
import {
  bodyToText,
  categoryForm,
  centsToEuros,
  eurosToCents,
  optionForm,
  parseBody,
  parseLines,
  serviceForm,
  slugify,
} from '../services/admin-schemas.js';
import { suggestAlt, ratioOf } from '../gallery/images.js';
import {
  closedRanges,
  minutesSinceMidnight,
  openRanges,
  place,
  timelineBounds,
  weekDates,
} from '../agenda/timeline.js';
import {
  hoursToValues,
  parseHours,
  parseHoursText,
  hoursToText,
  closureForm,
  contactForm,
  bookingSettingsForm,
} from '../settings/schemas.js';
import { nextMonthStart, noShowRate } from '../dashboard/service.js';
import { maskRecipient, minutesLabel, timeLabel } from './format.js';
import { mergeOrder, moveInList } from './order.js';
import { phoneNeedle } from '../clients/repo.js';

describe('ordre des listes', () => {
  it('monte et descend d’un cran, sans sortir des limites', () => {
    expect(moveInList([1, 2, 3], 2, 'up')).toEqual([2, 1, 3]);
    expect(moveInList([1, 2, 3], 2, 'down')).toEqual([1, 3, 2]);
    expect(moveInList([1, 2, 3], 1, 'up')).toEqual([1, 2, 3]);
    expect(moveInList([1, 2, 3], 3, 'down')).toEqual([1, 2, 3]);
    expect(moveInList([1, 2, 3], 9, 'up')).toEqual([1, 2, 3]);
  });
  it('fusionne l’ordre d’un groupe dans la liste complète', () => {
    expect(mergeOrder([1, 2, 3, 4, 5], [4, 2])).toEqual([1, 4, 3, 2, 5]);
    expect(mergeOrder([1, 2, 3], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(mergeOrder([1, 2, 3], [9])).toBeNull();
    expect(mergeOrder([1, 2, 3], [1, 1])).toBeNull();
  });
});

describe('catalogue : conversions', () => {
  it('euros ↔ centimes', () => {
    expect(eurosToCents('85')).toBe(8500);
    expect(eurosToCents('85,5')).toBe(8550);
    expect(eurosToCents('85.50 €')).toBe(8550);
    expect(eurosToCents(' 1 200 ')).toBe(120000);
    expect(eurosToCents('')).toBeNull();
    expect(eurosToCents(undefined)).toBeNull();
    for (const bad of ['abc', '-5', '12,345', '1e3', '12,5,5'])
      expect(Number.isNaN(eurosToCents(bad))).toBe(true);
    expect(centsToEuros(8550)).toBe('85,5');
    expect(centsToEuros(null)).toBe('');
  });
  it('slugs sans accent ni caractère spécial', () => {
    expect(slugify('Création de locks, à la main !')).toBe('creation-de-locks-a-la-main');
    expect(slugify('  --Énorme  Œuvre--')).toBe('enorme-uvre');
    expect(slugify('')).toBe('');
    expect(slugify('x'.repeat(200))).toHaveLength(80);
  });
  it('texte long ↔ sections', () => {
    const text =
      'Intro en une phrase.\n\n## Le déroulé\nPremier\nsur deux lignes\n\nSecond paragraphe.\n\n## Fin\n\nDernier.';
    const sections = parseBody(text);
    expect(sections).toEqual([
      { title: null, paragraphs: ['Intro en une phrase.'] },
      { title: 'Le déroulé', paragraphs: ['Premier sur deux lignes', 'Second paragraphe.'] },
      { title: 'Fin', paragraphs: ['Dernier.'] },
    ]);
    expect(parseBody(bodyToText(sections))).toEqual(sections);
    expect(parseBody('')).toEqual([]);
    expect(parseLines(' un \n\n deux \r\n trois ')).toEqual(['un', 'deux', 'trois']);
  });
  it('formulaire prestation : prix ou devis, durées cohérentes', () => {
    const base = {
      name: 'Entretien',
      summary: 'Court',
      durationMin: '60',
      durationMax: '90',
      bufferAfter: '10',
      price: '85',
    };
    expect(serviceForm.safeParse(base).success).toBe(true);
    expect(serviceForm.safeParse({ ...base, price: '' }).success).toBe(false);
    expect(serviceForm.safeParse({ ...base, price: '', onQuote: '1' }).success).toBe(true);
    expect(serviceForm.safeParse({ ...base, durationMax: '30' }).success).toBe(false);
    expect(serviceForm.safeParse({ ...base, price: 'beaucoup' }).success).toBe(false);
    expect(serviceForm.safeParse({ ...base, name: '' }).success).toBe(false);
    const parsed = serviceForm.parse({ ...base, active: '1', categoryId: '' });
    expect(parsed.price).toBe(8500);
    expect(parsed.categoryId).toBeNull();
    expect(parsed.active).toBe(true);
    expect(parsed.featured).toBe(false);
  });
  it('formulaire option et catégorie', () => {
    expect(
      optionForm.parse({ label: 'Longueur +', price: '15,50', extraMinutes: '30' }),
    ).toMatchObject({ price: 1550, extraMinutes: 30, active: false });
    expect(optionForm.safeParse({ label: '', price: '1' }).success).toBe(false);
    expect(
      categoryForm.safeParse({
        name: 'N',
        headline: 'H',
        summary: 'S',
        intro: 'I',
        mediaLabel: 'M',
      }).success,
    ).toBe(true);
    expect(categoryForm.safeParse({ name: 'N' }).success).toBe(false);
  });
});

describe('galerie', () => {
  it('l’orientation vient des dimensions, pas du formulaire', () => {
    expect(ratioOf(800, 1000)).toBe('portrait');
    expect(ratioOf(1000, 1000)).toBe('square');
    expect(ratioOf(1000, 1050)).toBe('square');
    expect(ratioOf(1600, 1000)).toBe('landscape');
  });
  it('suggestion de texte alternatif', () => {
    expect(suggestAlt({})).toBe('');
    expect(suggestAlt({ category: 'Création', method: 'Comb coils', size: 'fines' })).toBe(
      'Réalisation du salon : Création, méthode Comb coils, locks fines.',
    );
  });
});

describe('recherche par téléphone', () => {
  it('format national ou international, et jamais un fragment de texte', () => {
    expect(phoneNeedle('06 12 34 56 78')).toBe('33612345678');
    expect(phoneNeedle('+33 6 12 34')).toBe('3361234');
    expect(phoneNeedle('0612345678')).toBe('33612345678');
    // Du texte, même avec un chiffre, n'est pas un numéro.
    for (const text of ['E2E mobile', 'Awa 2', 'dupont', '', '12', '  '])
      expect(phoneNeedle(text)).toBe('');
  });
});

describe('export CSV', () => {
  it('échappe guillemets, séparateurs et retours à la ligne', () => {
    expect(csvCell('simple')).toBe('simple');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell('deux\nlignes')).toBe('"deux\nlignes"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });
  it('neutralise l’injection de formules (Excel)', () => {
    for (const evil of ['=1+1', '+33612345678', '-2+3', '@SUM(A1)', '\tcmd']) {
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`);
  });
  it('UTF-8 avec BOM, CRLF, séparateur « ; », faux emails masqués', () => {
    const csv = clientsToCsv([
      {
        firstName: 'Awa',
        lastName: 'Diop',
        email: 'awa@exemple.fr',
        phone: '+33612345678',
        smsReminders: true,
        newsletter: false,
        newsletterAt: null,
        createdAt: new Date('2026-01-02T10:00:00Z'),
        visits: 3,
        lastVisit: new Date('2026-11-03T10:00:00Z'),
      },
      {
        firstName: '=Cmd',
        lastName: 'Sans mail',
        email: placeholderEmailFor('+33611111111'),
        phone: null,
        smsReminders: false,
        newsletter: true,
        newsletterAt: new Date('2026-02-02T10:00:00Z'),
        createdAt: new Date('2026-01-02T10:00:00Z'),
        visits: 0,
        lastVisit: null,
      },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      'Prénom;Nom;Email;Téléphone;Rappels SMS;Newsletter;Date du consentement newsletter;Nombre de rendez-vous;Dernier rendez-vous;Fiche créée le',
    );
    expect(lines[1]).toBe("Awa;Diop;awa@exemple.fr;'+33612345678;oui;non;;3;2026-11-03;2026-01-02");
    expect(lines[2]).toBe("'=Cmd;Sans mail;;;non;oui;2026-02-02;0;;2026-01-02");
    expect(csv).not.toContain(PLACEHOLDER_DOMAIN);
  });
  it('emails de remplacement', () => {
    const fake = placeholderEmailFor('+33 6 12 34 56 78');
    expect(fake).toBe(`tel-33612345678@${PLACEHOLDER_DOMAIN}`);
    expect(isPlaceholderEmail(fake)).toBe(true);
    expect(isPlaceholderEmail('awa@exemple.fr')).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
    expect(displayEmail(fake)).toBeNull();
    expect(displayEmail('awa@exemple.fr')).toBe('awa@exemple.fr');
  });
});

describe('frise de l’agenda', () => {
  const tz = 'Europe/Paris';
  it('minutes depuis minuit en heure de Paris (été et hiver)', () => {
    expect(minutesSinceMidnight(new Date('2026-11-24T13:30:00Z'), '2026-11-24', tz)).toBe(
      14 * 60 + 30,
    );
    expect(minutesSinceMidnight(new Date('2026-07-14T12:00:00Z'), '2026-07-14', tz)).toBe(14 * 60);
    // Un RDV qui déborde sur le lendemain dépasse 1440.
    expect(minutesSinceMidnight(new Date('2026-11-24T23:30:00Z'), '2026-11-24', tz)).toBe(
      24 * 60 + 30,
    );
  });
  it('place un rendez-vous avec son tampon', () => {
    const p = place(
      {
        startsAt: new Date('2026-11-24T08:00:00Z'),
        endsAt: new Date('2026-11-24T10:30:00Z'),
        bufferMinutes: 30,
      },
      '2026-11-24',
      tz,
    );
    expect(p).toEqual({ startMin: 540, endMin: 690, spanMin: 120, bufferMin: 30 });
    expect(
      place(
        { startsAt: new Date('2026-11-24T08:00:00Z'), endsAt: new Date('2026-11-24T08:05:00Z') },
        '2026-11-24',
        tz,
      ).spanMin,
    ).toBe(15);
  });
  it('semaine du lundi au dimanche', () => {
    expect(weekDates('2026-11-18')).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(weekDates('2026-11-22')[0]).toBe('2026-11-16');
    expect(weekDates('2026-11-16')[0]).toBe('2026-11-16');
  });
  it('plages d’ouverture : semaine, fermeture, horaires spéciaux', () => {
    const weekly = [
      { weekday: 2, opens: '09:00', closes: '12:00' },
      { weekday: 2, opens: '14:00', closes: '18:00' },
    ];
    expect(openRanges('2026-11-24', weekly, [])).toEqual([
      { from: 540, to: 720 },
      { from: 840, to: 1080 },
    ]);
    expect(openRanges('2026-11-23', weekly, [])).toEqual([]);
    expect(
      openRanges('2026-11-24', weekly, [
        { kind: 'closed', startsOn: '2026-11-20', endsOn: '2026-11-30' },
      ]),
    ).toEqual([]);
    expect(
      openRanges('2026-11-24', weekly, [
        {
          kind: 'special_hours',
          startsOn: '2026-11-24',
          endsOn: '2026-11-24',
          opens: '10:00',
          closes: '13:00',
        },
      ]),
    ).toEqual([{ from: 600, to: 780 }]);
  });
  it('zones fermées et bornes de la frise', () => {
    expect(
      closedRanges(
        [
          { from: 540, to: 720 },
          { from: 840, to: 1080 },
        ],
        480,
        1140,
      ),
    ).toEqual([
      { from: 480, to: 540 },
      { from: 720, to: 840 },
      { from: 1080, to: 1140 },
    ]);
    expect(closedRanges([], 480, 600)).toEqual([{ from: 480, to: 600 }]);
    expect(timelineBounds([], [])).toEqual({ dayStart: 480, dayEnd: 1140 });
    expect(timelineBounds([{ startMin: 420, endMin: 1200 }], [[{ from: 360, to: 1260 }]])).toEqual({
      dayStart: 360,
      dayEnd: 1260,
    });
  });
});

describe('réglages : horaires, fermetures, coordonnées', () => {
  it('horaires du formulaire ↔ plages', () => {
    const { ranges, errors } = parseHours({
      d2a: '09:00',
      d2b: '12:00',
      d2c: '14:00',
      d2d: '18:00',
      d6c: '14:00',
      d6d: '18:00',
    });
    expect(errors).toEqual({});
    expect(ranges).toEqual([
      { weekday: 2, opens: '09:00', closes: '12:00' },
      { weekday: 2, opens: '14:00', closes: '18:00' },
      { weekday: 6, opens: '14:00', closes: '18:00' },
    ]);
    expect(hoursToValues(ranges)).toMatchObject({
      d2a: '09:00',
      d2b: '12:00',
      d2c: '14:00',
      d2d: '18:00',
      d6a: '14:00',
      d6b: '18:00',
    });
  });
  it('plage incomplète, inversée ou qui se chevauche = erreur', () => {
    expect(parseHours({ d1a: '09:00' }).errors.d1a).toMatch(/ouverture et la fermeture/);
    expect(parseHours({ d1a: '12:00', d1b: '09:00' }).errors.d1b).toMatch(/après l’ouverture/);
    expect(
      parseHours({ d1a: '09:00', d1b: '13:00', d1c: '12:00', d1d: '18:00' }).errors.d1d,
    ).toMatch(/chevauchent/);
    expect(parseHours({}).ranges).toEqual([]);
  });
  it('fermetures : une date, une période, des horaires spéciaux', () => {
    expect(closureForm.parse({ kind: 'closed', startsOn: '2026-12-24' })).toMatchObject({
      endsOn: '2026-12-24',
    });
    expect(
      closureForm.safeParse({ kind: 'closed', startsOn: '2026-12-24', endsOn: '2026-12-20' })
        .success,
    ).toBe(false);
    expect(closureForm.safeParse({ kind: 'special_hours', startsOn: '2026-12-24' }).success).toBe(
      false,
    );
    expect(
      closureForm.safeParse({
        kind: 'special_hours',
        startsOn: '2026-12-24',
        opens: '10:00',
        closes: '14:00',
      }).success,
    ).toBe(true);
    expect(closureForm.safeParse({ kind: 'closed', startsOn: '2026-02-30' }).success).toBe(false);
  });
  it('délais de réservation bornés', () => {
    const ok = {
      minNoticeHours: '24',
      horizonDays: '60',
      cancellationHours: '48',
      slotStepMinutes: '30',
      longServiceMinutes: '240',
      policyText: 'Vous pouvez annuler gratuitement jusqu’à 48 h avant.',
    };
    expect(bookingSettingsForm.safeParse(ok).success).toBe(true);
    expect(bookingSettingsForm.safeParse({ ...ok, slotStepMinutes: '25' }).success).toBe(false);
    expect(bookingSettingsForm.safeParse({ ...ok, horizonDays: '5' }).success).toBe(false);
    expect(bookingSettingsForm.safeParse({ ...ok, minNoticeHours: '-1' }).success).toBe(false);
    expect(bookingSettingsForm.safeParse({ ...ok, policyText: 'court' }).success).toBe(false);
  });
  it('coordonnées : téléphone et lien Instagram contrôlés', () => {
    const ok = {
      street: '12 rue des Arts',
      postalCode: '31000',
      city: 'Toulouse',
      phone: '06 12 34 56 78',
      whatsapp: '',
      instagram: 'https://instagram.com/atelierdeslocks',
      hours: '',
    };
    expect(contactForm.safeParse(ok).success).toBe(true);
    expect(contactForm.safeParse({ ...ok, phone: '123' }).success).toBe(false);
    expect(contactForm.safeParse({ ...ok, instagram: 'javascript:alert(1)' }).success).toBe(false);
    expect(contactForm.safeParse({ ...ok, instagram: 'https://evil.example/x' }).success).toBe(
      false,
    );
    expect(contactForm.safeParse({ ...ok, postalCode: '3100' }).success).toBe(false);
    const lines = parseHoursText('Mardi – vendredi | 9h30 – 19h\nDimanche');
    expect(lines).toEqual([
      { days: 'Mardi – vendredi', time: '9h30 – 19h' },
      { days: 'Dimanche', time: 'Fermé' },
    ]);
    expect(parseHoursText(hoursToText(lines))).toEqual(lines);
  });
});

describe('contenus', () => {
  it('étapes : lignes vides ignorées, étape incomplète refusée, au moins une', () => {
    const ok = parseStages({
      name1: 'Bébé loc',
      period1: '0 à 3 mois',
      text1: 'Fragile.',
      name2: '',
      text2: '',
    });
    expect(ok.errors).toEqual({});
    expect(ok.stages).toEqual([{ name: 'Bébé loc', period: '0 à 3 mois', text: 'Fragile.' }]);
    expect(parseStages({ name1: 'Sans texte' }).errors.text1).toBeTruthy();
    expect(parseStages({ text1: 'Sans nom' }).errors.name1).toBeTruthy();
    expect(parseStages({}).errors.name1).toBeTruthy();
    expect(stagesToValues(ok.stages)).toEqual({
      name1: 'Bébé loc',
      period1: '0 à 3 mois',
      text1: 'Fragile.',
    });
  });
  it('le bandeau change d’identifiant quand son message change', () => {
    expect(announcementId('A', '/x', 'a1', { text: 'A', href: '/x' })).toBe('a1');
    expect(announcementId('B', '/x', 'a1', { text: 'A', href: '/x' })).not.toBe('a1');
    expect(announcementId('A', '/x', undefined, undefined)).toMatch(/^a/);
  });
  it('temps de lecture : 200 mots par minute, 1 au minimum', () => {
    expect(readingMinutes([{ title: null, paragraphs: ['un deux trois'] }])).toBe(1);
    expect(readingMinutes([{ title: 'T', paragraphs: [Array(450).fill('mot').join(' ')] }])).toBe(
      3,
    );
  });
});

describe('tableau de bord et affichage', () => {
  it('taux d’absence et mois suivant', () => {
    expect(noShowRate(1, 20)).toBe(5);
    expect(noShowRate(0, 0)).toBeNull();
    expect(noShowRate(1, 3)).toBe(33);
    expect(nextMonthStart('2026-11-01')).toBe('2026-12-01');
    expect(nextMonthStart('2026-12-01')).toBe('2027-01-01');
  });
  it('formatage : heures, durées, destinataires masqués', () => {
    expect(timeLabel(new Date('2026-11-24T13:30:00Z'))).toBe('14 h 30');
    expect(timeLabel(new Date('2026-11-24T08:00:00Z'))).toBe('09 h');
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(120)).toBe('2 h');
    expect(minutesLabel(150)).toBe('2 h 30');
    expect(maskRecipient('awa.diop@exemple.fr')).toBe('a***@exemple.fr');
    expect(maskRecipient('+33612345678')).toBe('+33••••78');
    expect(maskRecipient('')).toBe('••••');
  });
  it('le journal d’audit ne garde jamais de secret', () => {
    expect(
      cleanDetails({
        name: 'x',
        password: 'p',
        totpSecret: 's',
        recoveryCode: 'c',
        token: 't',
        hash: 'h',
        count: 3,
      }),
    ).toEqual({ name: 'x', count: 3 });
  });
});
