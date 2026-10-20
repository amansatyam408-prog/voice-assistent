# Voxly — AI Voice Sales Bot
# Built-in node:sqlite means no native build step is required.
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# No third-party runtime dependencies; copying manifests first keeps rebuilds fast.
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY voice-sales-bot ./voice-sales-bot

# Persistent volume for the SQLite database and recordings.
RUN mkdir -p /data/recordings && chown -R node:node /app /data
USER node
VOLUME ["/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "voice-sales-bot/server.js"]
