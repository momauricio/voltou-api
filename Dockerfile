# Build
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# Runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3010

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm install prisma@6.19.3 --no-save && npx prisma generate

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data

EXPOSE 3010

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main.js"]
