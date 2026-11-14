# syntax=docker/dockerfile:1
# Mind Meld Studio backend + browser UI. Build from the repository root:
#   docker build -f infra/docker/Dockerfile -t mindmeld-studio:local .
# The container never executes studied code itself. Execution needs a sandbox daemon (see infra/compose).
# Behind a TLS-intercepting proxy, pass its CA as a build secret (never baked into the final image):
#   docker build --secret id=extra_ca,src=/path/proxy-ca.crt --build-arg HTTPS_PROXY ... -f infra/docker/Dockerfile .
ARG NODE_IMAGE=node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
ARG DOCKER_CLI_IMAGE=docker:29-cli@sha256:2357639ad1ea7d0194134bf3292622fd4e562483966ed674e5d7c945b5f3b28d

FROM ${DOCKER_CLI_IMAGE} AS dockercli

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
# --ignore-scripts: no dependency lifecycle scripts run during the image build.
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) npm ci --ignore-scripts --no-audit --no-fund
RUN if [ -f packages/web/package.json ]; then npm run build -w @mindmeld/web; else mkdir -p packages/web/dist; fi

FROM ${NODE_IMAGE} AS runtime
# docker CLI: talks to a sandbox daemon only when one is mounted (opt-in). Copied, not installed, so the image
# needs no OS package mirror. git (for hardened https clones) is optional: --build-arg WITH_GIT=0 skips it.
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
ARG WITH_GIT=1
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ "$WITH_GIT" = 1 ]; then \
      if [ -f /run/secrets/extra_ca ]; then cp /etc/ssl/certs/ca-certificates.crt /tmp/ca.bak && cat /run/secrets/extra_ca >> /etc/ssl/certs/ca-certificates.crt; fi; \
      apk add --no-cache git && if [ -f /tmp/ca.bak ]; then mv /tmp/ca.bak /etc/ssl/certs/ca-certificates.crt; fi; \
    fi
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force \
 && rm -rf packages/*/test
COPY --from=build /src/packages/web/dist ./packages/web/dist
RUN mkdir -p /data /var/tmp/mindmeld-runs && chown node:node /data /var/tmp/mindmeld-runs
ENV NODE_ENV=production \
    MINDMELD_HOST=0.0.0.0 \
    MINDMELD_PORT=8787 \
    MINDMELD_DATA_DIR=/data \
    MINDMELD_RUN_DIR=/var/tmp/mindmeld-runs \
    MINDMELD_WEB_DIR=/app/packages/web/dist \
    MINDMELD_SANDBOX=none
VOLUME ["/data"]
USER node
EXPOSE 8787
# Run with --init (compose: init: true) so signals reach Node and zombies are reaped.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "packages/server/src/cli.ts"]
