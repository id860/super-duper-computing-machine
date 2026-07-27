FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server-v3.mjs ./
COPY src ./src
COPY public ./public
ENV PORT=3000 DATA_DIR=/app/data NODE_ENV=production
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server-v3.mjs"]
