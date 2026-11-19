import 'fastify';
import type { EntryName } from '../client/entries.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** URL publique du site, sans barre finale (canonical, sitemap, JSON-LD). */
    publicUrl: string;
    /** Pool PostgreSQL partagé (passé aux repo.js des modules). */
    db: import('pg').Pool;
  }
  interface FastifyReply {
    /** Rend un template Eta dans le layout, avec les assets de la page `entry`. */
    page(template: string, entry: EntryName, data?: Record<string, unknown>): FastifyReply;
  }
}
