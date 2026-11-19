// @ts-check
/**
 * Données structurées et plan du site (fonctions pures, testées).
 */

/** Jours schema.org, dans l'ordre du lundi au dimanche. */
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * JSON-LD `HairSalon` (§16). Les champs vides (téléphone, adresse à confirmer) sont omis.
 * @param {{ name: string, phone: string, instagram: string,
 *   address: { street: string, postalCode: string, city: string },
 *   openingHours: { days: number[], opens: string, closes: string }[] }} site
 * @param {string} publicUrl
 * @param {{ average: number, count: number }} [rating]
 */
export function hairSalonJsonLd(site, publicUrl, rating) {
  /** @type {Record<string, unknown>} */
  const data = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: site.name,
    url: publicUrl,
    logo: `${publicUrl}/brand/logo-vertical.svg`,
    image: `${publicUrl}/brand/embleme.svg`,
    description:
      'Salon spécialisé dans les locks à Toulouse : création, resserrage, détox, coloration et coiffure.',
    address: {
      '@type': 'PostalAddress',
      addressLocality: site.address.city,
      postalCode: site.address.postalCode,
      addressCountry: 'FR',
    },
    areaServed: 'Toulouse',
    openingHoursSpecification: site.openingHours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days.map((d) => DAYS[d - 1]),
      opens: h.opens,
      closes: h.closes,
    })),
    priceRange: '€€',
  };
  if (site.phone) data.telephone = site.phone;
  if (site.instagram) data.sameAs = [site.instagram];
  if (rating && rating.count > 0) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(rating.average * 10) / 10,
      reviewCount: rating.count,
      bestRating: 5,
    };
  }
  return data;
}

/**
 * JSON-LD `FAQPage`.
 * @param {{ items: { q: string, a: string }[] }[]} groups
 */
export function faqJsonLd(groups) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: groups.flatMap((g) =>
      g.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    ),
  };
}

/**
 * sitemap.xml à partir d'une liste de chemins. Les chemins viennent de nos données (slugs
 * validés), on échappe tout de même les caractères XML.
 * @param {string} publicUrl
 * @param {string[]} paths
 */
export function sitemapXml(publicUrl, paths) {
  const esc = (/** @type {string} */ s) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const urls = paths.map((p) => `  <url><loc>${esc(publicUrl + p)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
