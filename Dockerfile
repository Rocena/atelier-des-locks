# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# L'Atelier des Locks : image de production (3 étapes)
#   1. deps    : dépendances de production seules (node_modules léger)
#   2. build   : compile le front avec Vite (dist/client)
#   3. runtime : Node + code serveur + front compilé, sans outils de build,
#                utilisateur non privilégié, aucun secret dans l'image.
# Debian « slim » (glibc) plutôt qu'Alpine : sharp et argon2 ont des binaires précompilés fiables.
# ---------------------------------------------------------------------------
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts : le script « prepare » (husky) n'a rien à faire en production.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/create-admin.js scripts/init-production.js scripts/admin-recover.js ./scripts/
# Dossier des photos (monté en volume par docker-compose.prod.yml) : créé ici pour appartenir à « node ».
RUN mkdir -p /app/storage/uploads && chown -R node:node /app/storage
USER node
EXPOSE 3000
# La sonde vérifie aussi la base (/health répond 503 si PostgreSQL est injoignable).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server/index.js"]
