# ── Etapa 1: construir el front ──
FROM node:22-slim AS front
WORKDIR /front
COPY front/package*.json ./
RUN npm ci
COPY front/ ./
# Mismo origen: el backend sirve el front, así que la API es relativa.
ENV VITE_API_URL=""
RUN npm run build

# ── Etapa 2: backend + front servido como un único servicio ──
FROM node:22-slim AS app
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
# El build del front se sirve desde /app/public
COPY --from=front /front/dist ./public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# node:sqlite es experimental; tsx ejecuta el TypeScript directamente.
CMD ["node", "--no-warnings", "--experimental-sqlite", "--import", "tsx", "src/server.ts"]
