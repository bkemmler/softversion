# Build: UI bauen (Vite). Das Backend läuft als TypeScript direkt in Node (Type Stripping), braucht also keinen Build.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    TZ=Europe/Berlin \
    NODE_USE_ENV_PROXY=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/main.ts"]
