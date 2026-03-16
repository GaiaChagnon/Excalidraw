FROM node:20-alpine
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY server.js .
USER node
ENV PORT=3017
EXPOSE 3017
CMD ["node", "server.js"]
