# Tahap 1: build halaman web
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Tahap 2: server produksi (satu-satunya dependensi runtime: @resvg/resvg-wasm untuk gambar pratinjau)
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 CACHE_DIR=/app/.cache
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY data ./data
COPY server ./server
COPY src/risk.ts src/report-types.ts src/icons.ts src/impact.ts ./src/
COPY --from=build /app/node_modules/@resvg ./node_modules/@resvg
# Folder cache (laporan BNPB terakhir) milik user node; dipasang sebagai volume saat dijalankan.
RUN mkdir -p /app/.cache && chown node:node /app/.cache
USER node
EXPOSE 8787
CMD ["node", "server/index.ts"]
