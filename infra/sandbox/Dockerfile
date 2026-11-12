# Optional dedicated sandbox image: the Node runtime and nothing else, running as nobody.
#   docker build -t mindmeld-sandbox:node26 infra/sandbox
#   MINDMELD_SANDBOX_IMAGE=mindmeld-sandbox:node26
# Studio never pulls images during a run (`--pull=never`); prepare the image once, ahead of time.
FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER 65534:65534
WORKDIR /tmp
