// @ts-check
import { afterAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test-helpers.js';
import { findCatalog, findMethods } from './repo.js';
import {
  buildNavigation,
  findActiveService,
  groupByCategory,
  methodsByFamily,
  methodsOf,
  relatedServices,
  serviceJsonLd,
} from './service.js';

const pool = testPool();
const { categories, services } = await findCatalog(pool);
const { methods } = await findMethods(pool);
afterAll(() => pool.end());

/** @param {string} slug */
const get = (slug) =>
  /** @type {import('./repo.js').Service} */ (findActiveService(services, slug));

describe('catalogue', () => {
  it('regroupe les prestations actives par catégorie, dans l’ordre', () => {
    const { groups, others } = groupByCategory(categories, services);
    expect(groups.map((g) => g.slug)).toEqual([
      'installation',
      'resserrage',
      'detox',
      'coloration',
      'coiffure',
    ]);
    expect(groups.every((g) => g.services.length > 0)).toBe(true);
    expect(others.map((s) => s.slug)).toContain('consultation-diagnostic');
  });

  it('ignore une prestation inactive', () => {
    const inactive = services.map((s) => (s.slug === 'bain-detox' ? { ...s, active: false } : s));
    expect(findActiveService(inactive, 'bain-detox')).toBeNull();
    expect(get('bain-detox').name).toBe('Bain détox');
  });

  it('propose d’abord des prestations de la même catégorie', () => {
    const related = relatedServices(services, get('bain-detox'));
    expect(related).toHaveLength(3);
    expect(related[0].category).toBe('detox');
    expect(related.some((s) => s.slug === 'bain-detox')).toBe(false);
  });

  it('chaque méthode référencée par une prestation existe', () => {
    for (const service of services) {
      expect(methodsOf(service, methods)).toHaveLength(service.methods.length);
    }
  });

  it('chaque méthode renvoie vers une prestation existante', () => {
    for (const method of methods) {
      expect(findActiveService(services, method.service), method.slug).not.toBeNull();
    }
  });

  it('place les méthodes « both » dans la création et dans l’entretien', () => {
    const { installation, maintenance } = methodsByFamily(methods);
    expect(installation.map((m) => m.slug)).toContain('interlocking');
    expect(maintenance.map((m) => m.slug)).toContain('interlocking');
    expect(installation.map((m) => m.slug)).not.toContain('palm-rolling');
  });

  it('construit le méga-menu avec des liens vers les catégories', () => {
    const nav = buildNavigation(categories, services);
    expect(nav.categories[0].href).toBe('/prestations#installation');
    expect(nav.categories[0].services[0].href).toMatch(/^\/prestations\/[a-z-]+$/);
  });

  it('n’annonce pas de prix dans le JSON-LD d’une prestation sur devis', () => {
    expect(serviceJsonLd(get('depart-de-locks'), { name: 'X' }, 'https://x.fr').offers).toBe(
      undefined,
    );
    expect(serviceJsonLd(get('bain-detox'), { name: 'X' }, 'https://x.fr').offers).toMatchObject({
      price: 45,
    });
  });

  it('n’emploie jamais « Sisterlocks » sans la mention de marque', () => {
    const text = JSON.stringify({ services, methods });
    expect(text.match(/Sisterlocks(?!™)/g)).toBeNull();
  });
});
