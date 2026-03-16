FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache git && \
    git clone --depth 1 https://github.com/excalidraw/excalidraw-room.git . && \
    npm install && \
    npx tsc && \
    npm prune --production && \
    apk del git

USER node

ENV PORT=80

EXPOSE 80

CMD ["node", "dist/index.js"]
