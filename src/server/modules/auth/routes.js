// @ts-check
/**
 * Routes d'authentification de l'administration : connexion, 2FA, déconnexion, mon compte.
 * Validation (schemas.js) → service.js → réponse. Pas de logique ici.
 */
import QRCode from 'qrcode';
import { ANY } from '../admin/guard.js';
import { redirectWith } from '../admin/nav.js';
import { audit } from '../audit/service.js';
import { formatSecret, otpauthUri } from './totp.js';
import {
  fieldErrors,
  loginBody,
  passwordBody,
  recoveryBody,
  secondFactorBody,
  setupBody,
} from './schemas.js';
import * as auth from './service.js';

const GENERIC_LOGIN_ERROR =
  'Adresse ou mot de passe incorrect, ou compte momentanément verrouillé. Réessayez dans quelques minutes.';
const GENERIC_CODE_ERROR =
  'Code incorrect, ou compte momentanément verrouillé. Réessayez dans quelques minutes.';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig, now: () => Date }} options
 */
export default async function authRoutes(app, { config, now }) {
  const cookieName = app.adminCookie;
  /** Limite de débit : stricte en production, large en test. */
  const limit = () => ({
    max: config.env === 'test' ? 1000 : config.admin.loginRateLimit,
    timeWindow: '10 minutes',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'rate_limited',
      message: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
    }),
  });

  /** @param {import('fastify').FastifyRequest} request */
  const ctx = (request) => ({
    db: app.db,
    secret: config.sessionSecret,
    now: now(),
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  });

  /** @param {import('fastify').FastifyReply} reply @param {string} token */
  const setSession = (reply, token) =>
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'strict',
      path: '/',
    });

  // ─── Connexion : adresse + mot de passe ────────────────────────────────────
  app.get('/connexion', { config: { access: 'public' } }, async (request, reply) => {
    const principal = request.admin;
    if (principal && !principal.half) return reply.redirect('/admin', 302);
    if (principal?.half) {
      return reply.redirect(
        principal.user.totpConfirmedAt ? '/admin/verification' : '/admin/2fa',
        302,
      );
    }
    return reply.adminPage('admin/connexion', { title: 'Connexion', bare: true });
  });

  app.post(
    '/connexion',
    {
      config: { access: 'public', rateLimit: limit() },
      preHandler: app.csrfProtection,
    },
    async (request, reply) => {
      const parsed = loginBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).adminPage('admin/connexion', {
          title: 'Connexion',
          bare: true,
          errors: fieldErrors(parsed.error),
          values: { email: String(/** @type {any} */ (request.body)?.email ?? '').slice(0, 254) },
        });
      }
      const result = await auth.login(ctx(request), parsed.data);
      if (!result.ok) {
        await audit(request, result.reason === 'locked' ? 'login.locked' : 'login.failure', {
          userId: result.user?.id ?? null,
          type: 'user',
          id: result.user?.id ?? null,
        });
        return reply.code(401).adminPage('admin/connexion', {
          title: 'Connexion',
          bare: true,
          errors: { _form: GENERIC_LOGIN_ERROR },
          values: { email: parsed.data.email },
        });
      }
      setSession(reply, result.token);
      return reply.redirect(result.needsSetup ? '/admin/2fa' : '/admin/verification', 303);
    },
  );

  // ─── Deuxième facteur ──────────────────────────────────────────────────────
  app.get('/verification', { config: { access: 'half' } }, async (request, reply) => {
    if (!request.admin?.user.totpConfirmedAt) return reply.redirect('/admin/2fa', 302);
    const recovery = /** @type {any} */ (request.query)?.secours === '1';
    return reply.adminPage('admin/verification', {
      title: 'Vérification',
      bare: true,
      values: { kind: recovery ? 'recovery' : 'totp' },
    });
  });

  app.post(
    '/verification',
    { config: { access: 'half', rateLimit: limit() }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const principal = /** @type {NonNullable<typeof request.admin>} */ (request.admin);
      const parsed = secondFactorBody.safeParse(request.body);
      const render = (/** @type {Record<string, string>} */ errors, kind = 'totp') =>
        reply.code(errors._form ? 401 : 422).adminPage('admin/verification', {
          title: 'Vérification',
          bare: true,
          errors,
          values: { kind },
        });
      if (!parsed.success) return render(fieldErrors(parsed.error));
      const result = await auth.verifySecondFactor(ctx(request), principal, parsed.data);
      if (!result.ok) {
        await audit(request, result.reason === 'locked' ? 'login.locked' : 'login.failure', {
          userId: principal.user.id,
          type: 'user',
          id: principal.user.id,
          details: { step: '2fa' },
        });
        return render({ _form: GENERIC_CODE_ERROR }, parsed.data.kind);
      }
      setSession(reply, result.token);
      request.admin = null;
      await audit(request, result.usedRecovery ? 'login.recovery_code' : 'login.success', {
        userId: principal.user.id,
        type: 'user',
        id: principal.user.id,
      });
      return reply.redirect('/admin', 303);
    },
  );

  // ─── Première configuration de la 2FA (obligatoire) ────────────────────────
  /** @param {import('fastify').FastifyRequest} request */
  async function setupView(request) {
    const principal = /** @type {NonNullable<typeof request.admin>} */ (request.admin);
    const setup = await auth.beginTotpSetup(ctx(request), principal.user);
    if (!setup) return null;
    const uri = otpauthUri({
      secret: setup.secret,
      account: principal.user.email,
      issuer: 'L’Atelier des Locks',
    });
    const qrSvg = await QRCode.toString(uri, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1C1310', light: '#F4ECE2' },
    });
    return { qrSvg, secret: formatSecret(setup.secret), uri };
  }

  app.get('/2fa', { config: { access: 'half' } }, async (request, reply) => {
    const view = await setupView(request);
    if (!view) return reply.redirect('/admin/verification', 302);
    return reply.adminPage('admin/2fa', {
      title: 'Activer la double authentification',
      bare: true,
      ...view,
    });
  });

  app.post(
    '/2fa',
    { config: { access: 'half', rateLimit: limit() }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const principal = /** @type {NonNullable<typeof request.admin>} */ (request.admin);
      const parsed = setupBody.safeParse(request.body);
      /** @param {Record<string, string>} errors */
      const again = async (errors) => {
        const view = await setupView(request);
        if (!view) return reply.redirect('/admin/verification', 303);
        return reply.code(422).adminPage('admin/2fa', {
          title: 'Activer la double authentification',
          bare: true,
          errors,
          ...view,
        });
      };
      if (!parsed.success) return again(fieldErrors(parsed.error));
      const result = await auth.confirmTotpSetup(ctx(request), principal, parsed.data.code);
      if (!result.ok) {
        await audit(request, 'login.failure', {
          userId: principal.user.id,
          type: 'user',
          id: principal.user.id,
          details: { step: '2fa-setup' },
        });
        return again({
          code: 'Ce code n’est pas bon. Vérifiez l’heure de votre téléphone et réessayez.',
        });
      }
      setSession(reply, result.token);
      await audit(request, 'totp.enabled', {
        userId: principal.user.id,
        type: 'user',
        id: principal.user.id,
      });
      // Les codes de secours ne sont montrés qu'ici, une seule fois.
      return reply.adminPage('admin/codes-secours', {
        title: 'Codes de secours',
        bare: true,
        recoveryCodes: result.recoveryCodes,
        continueHref: '/admin',
      });
    },
  );

  // ─── Déconnexion ───────────────────────────────────────────────────────────
  app.post(
    '/deconnexion',
    { config: { access: 'public' }, preHandler: app.csrfProtection },
    async (request, reply) => {
      await auth.logout(ctx(request), request.cookies?.[cookieName]);
      if (request.admin) await audit(request, 'logout', { userId: request.admin.user.id });
      reply.clearCookie(cookieName, { path: '/' });
      return reply.redirect('/admin/connexion', 303);
    },
  );

  // ─── Mon compte ────────────────────────────────────────────────────────────
  app.get('/compte', { config: { roles: ANY } }, async (request, reply) =>
    reply.adminPage('admin/compte', { title: 'Mon compte', section: 'compte' }),
  );

  app.post(
    '/compte/mot-de-passe',
    { config: { roles: ANY, rateLimit: limit() }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const principal = /** @type {NonNullable<typeof request.admin>} */ (request.admin);
      const parsed = passwordBody.safeParse(request.body);
      /** @param {Record<string, string>} errors */
      const fail = (errors) =>
        reply
          .code(422)
          .adminPage('admin/compte', { title: 'Mon compte', section: 'compte', errors });
      if (!parsed.success) return fail(fieldErrors(parsed.error));
      const result = await auth.changePassword(ctx(request), principal, parsed.data);
      if (!result.ok) return fail({ current: result.error });
      await audit(request, 'account.password', { type: 'user', id: principal.user.id });
      return redirectWith(reply, '/admin/compte', 'password');
    },
  );

  app.post(
    '/compte/codes-secours',
    { config: { roles: ANY, rateLimit: limit() }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const principal = /** @type {NonNullable<typeof request.admin>} */ (request.admin);
      const parsed = recoveryBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).adminPage('admin/compte', {
          title: 'Mon compte',
          section: 'compte',
          errors: { recoveryCode: fieldErrors(parsed.error).code },
        });
      }
      const result = await auth.regenerateRecoveryCodes(
        ctx(request),
        principal.user,
        parsed.data.code,
      );
      if (!result.ok) {
        return reply.code(422).adminPage('admin/compte', {
          title: 'Mon compte',
          section: 'compte',
          errors: {
            recoveryCode: 'Ce code n’est pas bon. Réessayez avec le code actuel de l’application.',
          },
        });
      }
      await audit(request, 'account.recovery_codes', { type: 'user', id: principal.user.id });
      return reply.adminPage('admin/codes-secours', {
        title: 'Codes de secours',
        section: 'compte',
        recoveryCodes: result.recoveryCodes,
        continueHref: '/admin/compte',
      });
    },
  );
}
