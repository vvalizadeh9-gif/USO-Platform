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
RUN npm ci

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
FROM nginxinc/nginx-unprivileged@sha256:a7caff5bdcb3e3ba5dafacbdfc8f2d6d4d9f256d63f47cfeee9e1f9c289dd833
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
