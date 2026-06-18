# packages/backend/Dockerfile · DaShengOS v0.3 Phase 2+
#
# Multi-stage: builder (tsc) → runtime (prod deps + dist)
# Build context: monorepo root (so we can use pnpm workspaces)
#
# Usage:
#   docker build -t dasheng/backend:latest -f packages/backend/Dockerfile .
#   docker run -p 8000:8000 -e DASHENG_JWT_SECRET=xxx dasheng/backend:latest

# ---------- Stage 1: deps + build ----------
FROM node:20-alpine AS builder
WORKDIR /repo

# 装 pnpm (跟 monorepo 一致)
RUN corepack enable && corepack prepare pnpm@9 --activate

# 只 copy 必要的 manifest 文件先 install (cache 友好)
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY packages/backend/package.json ./packages/backend/

# install (含 dev deps, build 时要用 tsc)
RUN pnpm install --frozen-lockfile

# copy 源码
COPY packages/backend ./packages/backend

# build (tsc → dist/)
RUN pnpm --filter backend build
# dist/ 现在在 /repo/packages/backend/dist/

# ---------- Stage 2: runtime (prod deps + dist) ----------
FROM node:20-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# copy manifests + 装 prod-only deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --prod --frozen-lockfile

# 从 builder 拷编译产物
COPY --from=builder /repo/packages/backend/dist ./packages/backend/dist

# 启动 (production mode)
# Phase 10: 不切到非 root 用户, 因为要连 sandbox unix socket (root 拥有)
#   沙箱隔离靠 sandbox 自己的 namespace+seccomp+cgroup, backend 跑 root 不增加 attack surface
USER root
ENV NODE_ENV=production
ENV BACKEND_PORT=8000
ENV BACKEND_HOST=0.0.0.0
EXPOSE 8000

# 健康检查: GET /docs/ 应该 200 (curl 在 alpine 自带)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8000/docs/ || exit 1

CMD ["node", "packages/backend/dist/server.js"]
