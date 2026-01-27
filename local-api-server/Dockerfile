# Local API Server for Local Development
# IMPORTANT: Build context must be workspace root (../)
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy shared package
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src

# Copy meeting-api service (has package.json with workspace deps)
COPY services/meeting-api/package.json ./services/meeting-api/
COPY services/meeting-api/*.ts ./services/meeting-api/

# Copy ai-messages service (no package.json, just handler)
COPY services/ai-messages/*.ts ./services/ai-messages/

# Copy local-api-server
COPY local-api-server/package.json ./local-api-server/
COPY local-api-server/tsconfig.json ./local-api-server/
COPY local-api-server/src ./local-api-server/src

# Install all dependencies (workspace-aware)
RUN pnpm install

# Build shared package first (required by services)
RUN cd packages/shared && pnpm build

# Expose port
EXPOSE 3000

# Set working directory to local-api-server for runtime
WORKDIR /app/local-api-server

# Use tsx to run TypeScript directly (no build needed, avoids rootDir issues)
CMD ["npx", "tsx", "src/index.ts"]
