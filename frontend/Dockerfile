# syntax=docker/dockerfile:1
#
# The STRATA dashboard: built with Node, then served over HTTPS by an nginx
# that runs as an ordinary user. Normally built by docker compose:
#     docker compose up --build -d
#
# Targets:
#   runtime  what the frontend service runs (the default)
#   test     the dashboard's unit tests:
#            docker compose --profile test run --build --rm frontend-tests
#
# The TLS certificate and key are never copied into the image: compose
# mounts them at run time (make them with scripts/make-dashboard-cert.sh).

FROM node:22-alpine AS build
WORKDIR /app
RUN chown node:node /app
# Building (and the tests) run as the image's ordinary "node" user.
USER node
# npm ci installs exactly what package-lock.json lists and checks every
# package against its recorded hash. Dependencies first, so they're cached.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=node:node index.html tsconfig.json vite.config.ts ./
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
RUN npx tsc -p tsconfig.json && npx vite build


FROM build AS test
CMD ["npx", "vitest", "run"]


FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/strata-api-proxy.conf nginx/strata-security-headers.conf /etc/nginx/
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8443
# nginx itself, without the image's start-up scripts (they edit files, and
# compose makes this container's filesystem read-only).
ENTRYPOINT ["nginx", "-g", "daemon off;"]
CMD []
