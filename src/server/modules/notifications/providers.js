// @ts-check
/**
 * Fournisseurs d'envoi (§7.6). Tout le module passe par l'interface `NotificationProvider` :
 * changer de fournisseur (Brevo → un autre) ne touche qu'à ce fichier.
 *
 *   - console : écrit les messages dans le terminal. Dev et tests, aucun réseau.
 *   - brevo   : API transactionnelle Brevo (entreprise française, conforme RGPD).
 *
 * @typedef {object} EmailMessage
 * @property {{ email: string, name: string }} to
 * @property {string} subject
 * @property {string} html
 * @property {string} text
 * @property {{ name: string, contentType: string, content: string }[]} [attachments]
 * @property {string} [tag]
 *
 * @typedef {object} SmsMessage
 * @property {string} to    numéro E.164 (« +33612345678 »)
 * @property {string} text
 * @property {string} [tag]
 *
 * @typedef {object} NotificationProvider
 * @property {string} name
 * @property {(message: EmailMessage) => Promise<{ messageId: string }>} sendEmail
 * @property {(message: SmsMessage) => Promise<{ messageId: string }>} sendSms
 */

/**
 * Échec d'envoi. `retryable` : une nouvelle tentative peut réussir (réseau, 429, 5xx).
 * Une erreur définitive (adresse refusée, clé invalide) n'est pas rejouée.
 */
export class ProviderError extends Error {
  /** @param {string} message @param {boolean} retryable @param {number} [status] */
  constructor(message, retryable, status) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
    this.status = status;
  }
}

/** « awa.d@exemple.fr » → « a***@exemple.fr » (journaux de dev sans adresse complète). @param {string} email */
export function maskEmail(email) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.charAt(0)}***@${domain}`;
}

/** « +33612345678 » → « +336****5678 ». @param {string} phone */
export function maskPhone(phone) {
  return phone.length > 8 ? `${phone.slice(0, 4)}****${phone.slice(-4)}` : '****';
}

/**
 * Fournisseur « console » : affiche les messages (destinataire masqué) et les garde en mémoire
 * dans `outbox`, que les tests inspectent.
 * @typedef {{ channel: 'email'|'sms', to: string, subject?: string, text: string, html?: string, attachments?: EmailMessage['attachments'] }} OutboxEntry
 * @param {{ log?: (line: string) => void, outbox?: OutboxEntry[] }} [options]
 * @returns {NotificationProvider & { outbox: OutboxEntry[] }}
 */
export function createConsoleProvider({ log = console.info, outbox = [] } = {}) {
  let counter = 0;
  const keep = (/** @type {any} */ entry) => {
    outbox.push(entry);
    if (outbox.length > 200) outbox.shift();
  };
  return {
    name: 'console',
    outbox,
    async sendEmail(message) {
      counter += 1;
      keep({
        channel: 'email',
        to: message.to.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
      });
      log(
        `[notifications:console] EMAIL → ${maskEmail(message.to.email)} · ${message.subject}\n${message.text}\n`,
      );
      return { messageId: `console-email-${counter}` };
    },
    async sendSms(message) {
      counter += 1;
      keep({ channel: 'sms', to: message.to, text: message.text });
      log(
        `[notifications:console] SMS → ${maskPhone(message.to)} (${message.text.length}/160) ${message.text}`,
      );
      return { messageId: `console-sms-${counter}` };
    },
  };
}

const BREVO_API = 'https://api.brevo.com/v3';

/**
 * Fournisseur Brevo : emails (`/smtp/email`) et SMS transactionnels (`/transactionalSMS/sms`).
 * `fetchImpl` est injectable pour les tests (aucun appel réseau réel).
 * @param {{ apiKey: string, senderEmail: string, senderName: string, smsSender: string, fetchImpl?: typeof fetch, baseUrl?: string }} options
 * @returns {NotificationProvider}
 */
export function createBrevoProvider({
  apiKey,
  senderEmail,
  senderName,
  smsSender,
  fetchImpl = fetch,
  baseUrl = BREVO_API,
}) {
  /** @param {string} path @param {object} body */
  async function post(path, body) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      // Réseau coupé, délai dépassé : on réessaiera.
      throw new ProviderError(
        `Brevo injoignable : ${error instanceof Error ? error.message : error}`,
        true,
      );
    }
    const payload = /** @type {any} */ (await response.json().catch(() => ({})));
    if (!response.ok) {
      // 429 et 5xx se réessaient ; les autres 4xx (clé, adresse, contenu) sont définitifs.
      const retryable = response.status === 429 || response.status >= 500;
      // Le message de Brevo ne contient pas le contenu du mail : on peut le journaliser.
      throw new ProviderError(
        `Brevo ${response.status} : ${String(payload.message ?? payload.code ?? 'erreur')}`.slice(
          0,
          300,
        ),
        retryable,
        response.status,
      );
    }
    return payload;
  }

  return {
    name: 'brevo',
    async sendEmail(message) {
      const payload = await post('/smtp/email', {
        sender: { email: senderEmail, name: senderName },
        to: [{ email: message.to.email, name: message.to.name }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        ...(message.attachments?.length
          ? {
              attachment: message.attachments.map((a) => ({
                name: a.name,
                content: Buffer.from(a.content, 'utf8').toString('base64'),
              })),
            }
          : {}),
        ...(message.tag ? { tags: [message.tag] } : {}),
      });
      return { messageId: String(payload.messageId ?? '') };
    },
    async sendSms(message) {
      const payload = await post('/transactionalSMS/sms', {
        sender: smsSender,
        // Brevo attend l'indicatif pays sans « + » (« 33612345678 »).
        recipient: message.to.replace(/^\+/, ''),
        content: message.text,
        type: 'transactional',
        ...(message.tag ? { tag: message.tag } : {}),
      });
      return { messageId: String(payload.messageId ?? payload.reference ?? '') };
    },
  };
}

/**
 * Fournisseur choisi par la configuration.
 * @param {import('../../config.js').AppConfig['notifications']} config
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {NotificationProvider}
 */
export function createProvider(config, options = {}) {
  if (config.provider === 'brevo') {
    return createBrevoProvider({
      apiKey: config.brevoApiKey,
      senderEmail: config.senderEmail,
      senderName: config.senderName,
      smsSender: config.smsSender,
    });
  }
  return createConsoleProvider(options);
}
