FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
COPY seed ./seed

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4174
ENV LEADS_DATA_DIR=/data
ENV LEADS_LOG_LEVEL=info
ENV LEADS_FORCE_SEED=1

RUN mkdir -p /data

EXPOSE 4174

CMD ["node", "src/server.mjs"]
