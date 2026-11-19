// @ts-check
/**
 * Règles du catalogue, en fonctions pures (testées dans service.test.js).
 * @typedef {import('./repo.js').Category} Category
 * @typedef {import('./repo.js').Service} Service
 * @typedef {import('./repo.js').Method} Method
 */

/** @param {{ order: number }} a @param {{ order: number }} b */
const byOrder = (a, b) => a.order - b.order;

/**
 * Catégories triées, chacune avec ses prestations actives triées.
 * Les prestations hors catégorie (consultation, départ de locks) sont renvoyées à part.
 * @param {Category[]} categories
 * @param {Service[]} services
 */
export function groupByCategory(categories, services) {
  const active = services.filter((s) => s.active);
  return {
    groups: [...categories].sort(byOrder).map((category) => ({
      ...category,
      services: active.filter((s) => s.category === category.slug).sort(byOrder),
    })),
    others: active.filter((s) => !s.category).sort(byOrder),
  };
}

/**
 * @param {Service[]} services
 * @param {string} slug
 */
export function findActiveService(services, slug) {
  return services.find((s) => s.active && s.slug === slug) ?? null;
}

/**
 * Prestations à suggérer : même catégorie d'abord, puis la consultation.
 * @param {Service[]} services
 * @param {Service} current
 * @param {number} [limit]
 */
export function relatedServices(services, current, limit = 3) {
  const others = services.filter((s) => s.active && s.slug !== current.slug);
  const sameCategory = others.filter((s) => current.category && s.category === current.category);
  const rest = others.filter((s) => !sameCategory.includes(s));
  return [...sameCategory.sort(byOrder), ...rest.sort(byOrder)].slice(0, limit);
}

/**
 * Méthodes d'une prestation, dans l'ordre déclaré par la prestation.
 * @param {Service} service
 * @param {Method[]} methods
 */
export function methodsOf(service, methods) {
  return service.methods
    .map((slug) => methods.find((m) => m.slug === slug))
    .filter((m) => m !== undefined);
}

/**
 * Méthodes par famille, pour le guide : création, puis entretien.
 * Une méthode « both » apparaît dans les deux.
 * @param {Method[]} methods
 */
export function methodsByFamily(methods) {
  return {
    installation: methods.filter((m) => m.family !== 'maintenance'),
    maintenance: methods.filter((m) => m.family !== 'installation'),
  };
}

/**
 * Données du méga-menu « Prestations » et du tiroir mobile.
 * @param {Category[]} categories
 * @param {Service[]} services
 */
export function buildNavigation(categories, services) {
  const { groups, others } = groupByCategory(categories, services);
  return {
    categories: groups.map((g) => ({
      slug: g.slug,
      name: g.name,
      href: `/prestations#${g.slug}`,
      services: g.services.map((s) => ({ name: s.name, href: `/prestations/${s.slug}` })),
    })),
    others: others.map((s) => ({ name: s.name, href: `/prestations/${s.slug}` })),
  };
}

/**
 * Données structurées schema.org `Service` d'une prestation.
 * @param {Service} service
 * @param {{ name: string }} site
 * @param {string} publicUrl
 */
export function serviceJsonLd(service, site, publicUrl) {
  /** @type {Record<string, unknown>} */
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.summary,
    url: `${publicUrl}/prestations/${service.slug}`,
    provider: { '@type': 'HairSalon', name: site.name, url: publicUrl },
    areaServed: { '@type': 'City', name: 'Toulouse' },
  };
  if (!service.onQuote && service.price != null) {
    data.offers = {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      ...(service.priceFrom
        ? {
            priceSpecification: {
              '@type': 'PriceSpecification',
              minPrice: service.price,
              priceCurrency: 'EUR',
            },
          }
        : { price: service.price }),
    };
  }
  return data;
}
