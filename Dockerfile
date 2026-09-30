# KOMA web: Next.js app + API + AI pipeline. Data (SQLite, art) lives on the
# volume mounted at KOMA_DATA_DIR; the chain is a separate service.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-slim AS build
WORKDIR /app
# Public settings are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_KOMA_NETWORK
ARG NEXT_PUBLIC_KOMA_CHAIN_ID
ARG NEXT_PUBLIC_ARBITRUM_RPC_URL
ARG KOMA_PUBLIC_URL
ENV NEXT_PUBLIC_KOMA_NETWORK=$NEXT_PUBLIC_KOMA_NETWORK \
    NEXT_PUBLIC_KOMA_CHAIN_ID=$NEXT_PUBLIC_KOMA_CHAIN_ID \
    NEXT_PUBLIC_ARBITRUM_RPC_URL=$NEXT_PUBLIC_ARBITRUM_RPC_URL \
    KOMA_PUBLIC_URL=$KOMA_PUBLIC_URL \
    KOMA_DATA_DIR=/tmp/koma-build \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx next build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Launchpad contract addresses per chain (deploy/addresses.<chainId>.json)
COPY --from=build /app/deploy ./deploy
EXPOSE 3000
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
