# Container image for Google Cloud Run (or any container host).
#
# Cloud Run injects PORT (8080 by default) and src/config.js already reads it,
# and Express binds 0.0.0.0 by default, so no code changes are needed.
FROM node:22-slim

WORKDIR /app

# Copy manifests first so the dependency layer is cached across code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production

CMD ["node", "src/server.js"]
