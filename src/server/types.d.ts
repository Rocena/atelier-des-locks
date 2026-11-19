import 'fastify';
import type { EntryName } from '../client/entries.js';

declare module 'fastify' {
  interface FastifyReply {
    /** Rend un template Eta dans le layout, avec les assets de la page `entry`. */
    page(template: string, entry: EntryName, data?: Record<string, unknown>): FastifyReply;
  }
}
