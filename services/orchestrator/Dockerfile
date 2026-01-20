# syntax=docker/dockerfile:1

# ============================================
# Base stage: Node.js + pnpm
# ============================================
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app

# ============================================
# Dependencies stage: Install all dependencies
# ============================================
FROM base AS deps

# Copy workspace configuration files
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy package.json files for workspace dependency resolution
# This layer is cached unless package.json files change
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY services/orchestrator/package.json ./services/orchestrator/

# Install all dependencies including workspace dependencies
# --frozen-lockfile: ensure lockfile is not modified
# --filter orchestrator...: install orchestrator and its workspace dependencies
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter orchestrator...

# ============================================
# Builder stage: Build shared library and orchestrator
# ============================================
FROM deps AS builder

# Copy shared library source code
COPY packages/shared ./packages/shared

# Copy orchestrator source code
COPY services/orchestrator/tsconfig.json ./services/orchestrator/
COPY services/orchestrator/worker.ts ./services/orchestrator/
COPY services/orchestrator/grasp.ts ./services/orchestrator/
COPY services/orchestrator/graspConfigParser.ts ./services/orchestrator/
COPY services/orchestrator/selfSetup.ts ./services/orchestrator/
COPY services/orchestrator/orchestratorManager.ts ./services/orchestrator/
COPY services/orchestrator/meetingOrchestrator.ts ./services/orchestrator/

# Build shared library first (required for orchestrator)
RUN pnpm --filter @timtam/shared build

# Build orchestrator
RUN pnpm --filter orchestrator build

# ============================================
# Runner stage: Production image
# ============================================
FROM base AS runner

ENV NODE_ENV=production
WORKDIR /app/services/orchestrator

# Copy workspace configuration (needed for pnpm to resolve workspace deps)
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc /app/

# Copy package.json files
COPY package.json /app/
COPY packages/shared/package.json /app/packages/shared/
COPY services/orchestrator/package.json /app/services/orchestrator/

# Install production dependencies only
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    cd /app && pnpm install --frozen-lockfile --filter orchestrator... --prod

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/services/orchestrator/dist /app/services/orchestrator/dist

# Run the worker
CMD ["node", "dist/worker.js"]
