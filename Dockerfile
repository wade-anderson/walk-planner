FROM node:22-alpine
RUN apk upgrade --no-cache zlib
WORKDIR /app
COPY server.js app.js index.html style.css sw.js manifest.json icon.png ./
ENV PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    NODE_ENV=production
# All persistent data lives in /data (mount a volume or host directory there).
# Set ALLOWED_HOSTS to every hostname/IP the app is browsed at, comma-separated.
RUN mkdir /data && chown node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "server.js"]
