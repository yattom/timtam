FROM node:20-alpine AS builder
WORKDIR /app

# Copy orchestrator package (worker only, not Lambda handlers)
COPY package.json ./package.json
COPY tsconfig.json ./tsconfig.json
COPY worker.ts ./worker.ts
COPY grasp.ts ./grasp.ts
COPY graspConfigParser.ts ./graspConfigParser.ts

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
