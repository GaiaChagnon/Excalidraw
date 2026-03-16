FROM node:20-alpine
WORKDIR /app
COPY server.js .
USER node
ENV PORT=3016
EXPOSE 3016
CMD ["node", "server.js"]
