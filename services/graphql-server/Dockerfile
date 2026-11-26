# syntax=docker/dockerfile:1.7
# Build context: repository root (needs the npm workspace + packages/core).
#   docker build -f services/graphql-server/Dockerfile -t graphql-server .

FROM node:22-alpine AS build
WORKDIR /repo
# Copy manifests first so `npm ci` is cached until dependencies change.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY services/graphql-server/package.json services/graphql-server/
COPY services/api/package.json services/api/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY services/graphql-server services/graphql-server
# Produces a single self-contained bundle: the runtime image needs no node_modules.
RUN npm run build -w @gqlapp/graphql-server

FROM node:22-alpine AS runtime
# Patch OS packages and drop the package managers: the bundle needs only `node`,
# and npm/yarn/corepack (and their dependency trees) are pure attack surface.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--enable-source-maps \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem
# Amazon RDS CA bundle so TLS connections to RDS / RDS Proxy are fully verified.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
WORKDIR /app
COPY --from=build --chown=node:node /repo/services/graphql-server/dist ./dist
# Non-root; the ECS task definition also sets a read-only root filesystem.
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "dist/index.js"]
