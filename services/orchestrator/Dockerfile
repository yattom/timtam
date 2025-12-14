FROM node:20-alpine AS builder
WORKDIR /app

# Copy orchestrator package
COPY services/orchestrator/package.json ./package.json
COPY services/orchestrator/tsconfig.json ./tsconfig.json
COPY services/orchestrator/*.ts ./

# Install deps and build (use npm inside container for simplicity)
RUN npm install --omit=dev=false \
 && npm run build \
 && rm -rf node_modules \
 && npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy production node_modules and dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/worker.js"]
