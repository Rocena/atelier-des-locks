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
  }
  interface FastifyReply {
    /** Rend un template Eta dans le layout, avec les assets de la page `entry`. */
    page(template: string, entry: EntryName, data?: Record<string, unknown>): FastifyReply;
  }
}
