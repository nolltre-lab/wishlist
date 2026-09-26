FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
ARG VITE_BASE_PATH=/wishlist/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY --from=frontend-build /backend/public ./public
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server.js"]
