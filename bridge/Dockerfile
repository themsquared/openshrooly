FROM node:22-slim
WORKDIR /app
COPY bridge/package.json bridge/package-lock.json ./
RUN npm ci --omit=dev
COPY bridge/src ./src
ENV NODE_ENV=production
ENV MATTER_STORAGE_PATH=/data
CMD ["node", "src/index.js"]
