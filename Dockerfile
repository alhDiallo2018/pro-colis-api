FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm install

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `postgresql16-client` fournit pg_dump / pg_restore aux routes de sauvegarde.
# La version majeure suit celle du service `postgres` du compose : un client
# plus ancien que le serveur refuse de lire son catalogue.
RUN apk add --no-cache openssl postgresql16-client
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
EXPOSE 8080
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
