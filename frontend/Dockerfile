# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

# Copy source after npm install so source changes don't invalidate the
# npm install cache layer. A build-time ARG busts the cache when we
# explicitly pass --build-arg CACHE_BUST=$(date +%s) during deployment.
ARG CACHE_BUST=1
COPY . .
RUN npm run build

# ---- Serve stage ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
