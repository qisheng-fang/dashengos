# apps/web/Dockerfile · DaShengOS v0.3 web (Vite + nginx)
#
# Multi-stage: pnpm install + vite build → nginx:alpine serve dist/
# Build context: monorepo root
#
# Usage:
#   docker build -t dasheng/web:latest -f apps/web/Dockerfile .
#   docker run -p 3000:3000 dasheng/web:latest

# ---------- Stage 1: deps + build ----------
FROM node:20-alpine AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9 --activate

# copy manifests (cache 友好)
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# copy 源码
COPY apps/web ./apps/web

# build (vite → dist/)
RUN pnpm --filter web build

# ---------- Stage 2: runtime (nginx) ----------
FROM nginx:alpine AS runtime

# 拷 vite 产物
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

# 拷 nginx 配置 (SPA fallback + /api/ 反代)
COPY apps/web/deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
