// @ts-check
/**
 * Rendu des templates Eta (src/views). L'échappement HTML est automatique avec `<%= %>` ;
 * `<%~ %>` (non échappé) est réservé aux partials et au contenu déjà sûr.
 */
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';

const viewsDir = fileURLToPath(new URL('../../views', import.meta.url));

/** @param {{ cache: boolean }} options */
export function createRenderer({ cache }) {
  const eta = new Eta({ views: viewsDir, cache, autoEscape: true, autoTrim: false });

  /**
   * @param {string} template chemin relatif à src/views, ex. "pages/styleguide"
   * @param {Record<string, unknown>} data
   */
  return (template, data) => eta.render(template, data);
}
