# ── Stage 1: prod dependencies (build tools para native modules como bcrypt) ──
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

# ── Stage 2: compile TypeScript ───────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
# Garantiza que el manifiesto APQ exista (vacío si no hay uno); sin él todas las
# queries GraphQL son rechazadas en producción por PersistedQueriesMiddleware
RUN test -f query-manifest.json || echo '{}' > query-manifest.json

# ── Stage 3: imagen final (sin build tools, sin dev deps) ────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Signal handling correcto (PID 1) para graceful shutdown
RUN apk add --no-cache dumb-init

# Usuario non-root
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Directorio temporal para uploads de Multer (Excel imports)
RUN mkdir -p /app/tmp/excel-imports && chown -R nestjs:nodejs /app/tmp

ENV NODE_ENV=production
ENV TZ=America/Bogota

# Solo prod node_modules (con bcrypt ya compilado para alpine) + dist compilado
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules      ./node_modules
COPY --from=builder   --chown=nestjs:nodejs /app/dist              ./dist
COPY --from=builder   --chown=nestjs:nodejs /app/query-manifest.json ./
COPY --chown=nestjs:nodejs package.json ./

RUN chown nestjs:nodejs /app

USER nestjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', r => \
    process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "node -e \"const{default:ds}=require('./dist/core/database/data-source');ds.initialize().then(()=>ds.runMigrations()).then(m=>{console.log('[startup] migrations ran:',m.length)}).catch(e=>{console.error('[startup] migration failed:',e);process.exit(1)})\" && node dist/main"]
