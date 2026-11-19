import 'fastify';
import type { EntryName } from '../client/entries.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** URL publique du site, sans barre finale (canonical, sitemap, JSON-LD). */
    publicUrl: string;
    /** Pool PostgreSQL partagé (passé aux repo.js des modules). */
    db: import('pg').Pool;
    /** Fournisseur de réservation actif (adaptateur BOOKING_PROVIDER, §7.1). */
    bookingProvider: 'internal' | 'fresha_link';
    /** Notifications (§7.6) : planifie les emails et SMS d'un rendez-vous. Ne lève jamais d'erreur. */
    notifications: import('./modules/notifications/service.js').Notifier;
    /** Routes enregistrées sous /admin avec leurs rôles (le test d'accès les parcourt). */
    adminRoutes: Array<{
      method: string;
      url: string;
      access: string;
      roles: readonly string[] | null;
    }>;
    /** Nom du cookie de session de l'admin. */
    adminCookie: string;
  }
  interface FastifyContextConfig {
    /** Admin : rôles autorisés sur la route (absent = refusé). */
    roles?: readonly string[];
    /** Admin : « public » (connexion), « half » (2FA en attente) ou « full » (défaut). */
    access?: 'public' | 'half' | 'full';
  }
  interface FastifyRequest {
    /** Compte connecté à l'admin (null si aucune session valide). */
    admin: {
      user: import('./modules/auth/repo.js').User;
      session: import('./modules/auth/repo.js').SessionRow;
      /** Mot de passe vérifié, 2FA en attente. */
      half: boolean;
    } | null;
  }
  interface FastifyReply {
    /** Rend un template Eta dans le layout, avec les assets de la page `entry`. */
    page(template: string, entry: EntryName, data?: Record<string, unknown>): FastifyReply;
    /** Rend une page de l'admin (layout sobre, navigation, jeton CSRF). */
    adminPage(template: string, data?: Record<string, unknown>): FastifyReply;
  }
}
