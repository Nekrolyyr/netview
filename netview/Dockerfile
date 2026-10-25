# Build the static site, then serve it with nginx. The bundle is mounted at runtime (see docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV NETVIEW_DATASET_FILE=network.netview
EXPOSE 80
