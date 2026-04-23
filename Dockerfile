# podZAP — multi-stage build para Hetzner + Portainer
# Node 20 alpine: pequeno, rápido, suficiente pra Next 16 + Inngest serve
# -----------------------------------------------------------------------------

ARG NODE_VERSION=20-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Alpine: libc musl; alguns deps nativos (sharp, @supabase) precisam disso:
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- builder ----------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next standalone output reduz a imagem final em ~80%.
# Se o next.config.ts ainda não tem `output: 'standalone'`, o código aqui
# usa o modo padrão (copia .next inteiro).
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- runner ----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Usuário não-root
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# Next standalone: copia só o runtime mínimo (~80% menor que copiar .next inteiro)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Tools pós-MVP (ex: ffmpeg pra MP3):
# RUN apk add --no-cache ffmpeg wget

USER nextjs
EXPOSE 3000

# Healthcheck bate em / — landing retorna 200 se o Next subiu.
# Portainer mostra o estado verde/vermelho no dashboard.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ > /dev/null || exit 1

# Standalone gera server.js na raiz — executa direto sem npm
CMD ["node", "server.js"]
