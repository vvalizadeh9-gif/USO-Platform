# ---- Build stage ----
#
# Pinned by digest rather than by tag. `node:20-alpine` points at a different
# image every time it is rebuilt; the digest does not. This is the tag it
# corresponded to when pinned:
#   node:20-alpine  (fetched 2026-08-14)
# Node 20 reaches end of life inside this platform's expected lifetime, so this
# line will need changing one day -- see RUNBOOK.md.
FROM node@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app

# Both files, then `npm ci` -- not `npm install`.
#
# This used to copy only package.json and run `npm install`, which ignores the
# lock file and resolves every dependency afresh. Two builds of the identical
# commit could therefore ship different versions of React, recharts and
# framer-motion, and a bug appearing after a rebuild had no visible cause.
# `npm ci` installs exactly what package-lock.json specifies, and fails loudly
# if the two files disagree rather than quietly picking something newer.
#
# This matters most at the moment the base image above has to change: when one
# variable moves, every other one needs to be held still.
COPY package.json package-lock.json ./

# `--maxsockets 3` and the `test -x` are both here because of one deployment
# failure, and they address its two halves.
#
# npm ci died partway through with "Exit handler never called!" -- an npm bug
# that surfaces when the install process is killed under memory pressure, which
# this dependency set (React, recharts, framer-motion) reaches on a small build
# VM. The half that made it hard to diagnose is that npm exited 0 anyway. Docker
# recorded the layer as DONE, the build carried on with an empty node_modules,
# and the failure finally appeared two steps later as `sh: vite: not found` --
# a message pointing at the build tool rather than at the install that never
# happened.
#
# --maxsockets caps concurrent downloads, which is what keeps the install inside
# the memory it has. --no-audit and --no-fund drop two network round-trips that
# do nothing for a container build.
#
# The `test -x` is the part that matters even so: it asserts the install
# actually produced something, so a silent exit-0 crash stops the build here,
# where the error names the real problem. A build that cannot install its
# dependencies must fail, not ship the previous image's behaviour -- when this
# happened, `docker compose up -d` recreated the container from a stale image
# and reported it healthy, so the deployment looked successful for two days
# while serving old code.
RUN npm ci --no-audit --no-fund --maxsockets 3 \
    && test -x node_modules/.bin/vite

# Copy source after the install so source changes don't invalidate the
# dependency layer. A build-time ARG busts the cache when we explicitly pass
# --build-arg CACHE_BUST=$(date +%s) during deployment.
ARG CACHE_BUST=1
COPY . .
RUN npm run build

# ---- Serve stage ----
#
# nginx-unprivileged rather than plain nginx: the standard nginx image starts
# its master process as root in order to bind port 80. This variant runs
# entirely as an unprivileged user (uid 101) and listens on 8080 instead;
# docker-compose.yml maps the host's port 80 to it.
#   nginxinc/nginx-unprivileged:1.27-alpine  (fetched 2026-08-14)
FROM nginxinc/nginx-unprivileged@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0
COPY --from=build /app/dist /usr/share/nginx/html

# Both server configurations ship in the image; the entrypoint picks one at
# start-up from UEP_ENABLE_TLS. Neither is placed at conf.d/default.conf here,
# so the choice is made once, in one place, by a script that validates it.
COPY conf/ /etc/nginx/snippets/
COPY docker-entrypoint.sh /docker-entrypoint-uep.sh

USER root
RUN chmod +x /docker-entrypoint-uep.sh \
    && chown -R nginx:nginx /etc/nginx/conf.d
USER nginx

# 8080 for HTTP, 8443 for HTTPS. docker-compose.yml maps the host's 80 and 443.
EXPOSE 8080 8443
ENTRYPOINT ["/docker-entrypoint-uep.sh"]
CMD ["nginx", "-g", "daemon off;"]
