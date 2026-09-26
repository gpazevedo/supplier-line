# syntax=docker/dockerfile:1

# Build stage: runs on the build machine's own platform, so install and compile never use QEMU.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter host build
RUN pnpm --filter host deploy --prod /out

# Runtime stage: takes the target platform (build with --platform linux/arm64 for Fargate). Copy only, no RUN, so nothing executes under emulation.
FROM node:24-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
