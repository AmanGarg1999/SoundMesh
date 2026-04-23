# Stage 1: Build Frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production Server
FROM node:20-alpine

WORKDIR /app

# Copy production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy server logic
COPY server ./server

# Ensure src/core and worklets are available for any dynamic URLs
COPY src ./src
COPY worklets ./worklets

# Create certs directory (to be mounted)
RUN mkdir -p certs

# Expose SoundMesh port
EXPOSE 3000

# Start server in production mode
CMD ["node", "server/index.js", "--production"]
