FROM node:20-alpine AS base
WORKDIR /app

# 国内构建加速（服务器在海外可删）
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# ── deps：用 npm install（不用 npm ci）────────────────────────────────────────
# 若仓库里 package-lock.json 未与 package.json 同步（常见于只提交了 package.json），
# `npm ci` 会直接失败；install 会按 package.json 补全依赖，保证线上能编过。
# 建议在开发机执行 `npm install` 后提交更新后的 package-lock.json，便于版本可复现。
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm install

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY next.config.mjs tsconfig.json postcss.config.mjs ./
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
COPY styles ./styles
COPY .env* ./

ARG NEXT_PUBLIC_APP_NAME=AI-StoryFlow
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
