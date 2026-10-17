# Tahap 1: build halaman web
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Tahap 2: server produksi (tanpa dependensi npm saat runtime)
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY data ./data
COPY server ./server
COPY src/risk.ts src/report-types.ts ./src/
USER node
EXPOSE 8787
CMD ["node", "server/index.ts"]
