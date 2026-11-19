// @ts-check
/** Appels JSON de l'admin : jeton CSRF lu dans la page, erreurs métier renvoyées telles quelles. */

/** @returns {string} */
export function csrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}

/**
 * @param {string} url
 * @param {unknown} body  objet JSON, ou FormData (envoi de fichier)
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
export async function postJson(url, body) {
  const isForm = body instanceof FormData;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'x-csrf-token': csrfToken(),
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    },
    body: isForm ? body : JSON.stringify(body),
  });
  /** @type {any} */
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}
