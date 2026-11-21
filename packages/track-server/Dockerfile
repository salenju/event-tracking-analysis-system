# 构建上下文为仓库根目录：docker build -f packages/track-server/Dockerfile .

FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json ./
COPY packages/track-server/package.json packages/track-server/
RUN npm install --no-audit --no-fund
COPY packages/track-server packages/track-server
RUN npm run build -w @flyway/track-server

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json ./
COPY packages/track-server/package.json packages/track-server/
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /repo/packages/track-server/dist packages/track-server/dist
COPY packages/track-server/migrations packages/track-server/migrations
COPY packages/track-server/config packages/track-server/config
RUN chown -R node:node /repo
WORKDIR /repo/packages/track-server
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
