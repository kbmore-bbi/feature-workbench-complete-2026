ARG NODE_BASE_IMAGE=public.ecr.aws/docker/library/node:22-alpine
FROM ${NODE_BASE_IMAGE} AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder

ARG NEXT_PUBLIC_AGENT_STREAM_BATCHING_V1=true
ARG NEXT_PUBLIC_DURABLE_STTM_ROUTE_V1=true
ENV NEXT_PUBLIC_AGENT_STREAM_BATCHING_V1=${NEXT_PUBLIC_AGENT_STREAM_BATCHING_V1} \
    NEXT_PUBLIC_DURABLE_STTM_ROUTE_V1=${NEXT_PUBLIC_DURABLE_STTM_ROUTE_V1}

WORKDIR /app
COPY . .
RUN npm run build

FROM ${NODE_BASE_IMAGE} AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
