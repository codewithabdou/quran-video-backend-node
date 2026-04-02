# ---- Build Stage ----
FROM node:20-slim AS build

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install all dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and generate Prisma client
COPY . .
RUN DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx prisma generate

# Final pruning to keep node_modules small for production
RUN npm prune --production

# ---- Production Stage ----
FROM node:20-slim AS production

# Install runtime dependencies: ffmpeg + canvas native libs + fonts
# We also install build-essential TEMPORARILY to rebuild canvas for this exact environment
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libfreetype6 \
    libfontconfig1 \
    libfribidi0 \
    libpixman-1-0 \
    libuuid1 \
    libxcb1 \
    libxext6 \
    libxrender1 \
    fonts-noto-core \
    fonts-noto-extra \
    # Build tools for rebuild
    build-essential \
    python3 \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser -m appuser

WORKDIR /app

# Copy the node_modules from the build stage
COPY --from=build /app/node_modules /app/node_modules

# FORCE a rebuild of canvas in this exact production environment
# This solves the "Invalid ELF Header" and "ERR_DLOPEN_FAILED"
RUN npm rebuild canvas && \
    # Cleanup build tools to keep image slim
    apt-get purge -y build-essential python3 pkg-config libcairo2-dev libpango1.0-dev && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Copy source code (respecting .dockerignore)
COPY . .

# Copy fonts if they exist
COPY fonts/ /app/fonts/

# Create runtime directories and set permissions
RUN mkdir -p temp uploads outputs && \
    chmod -R 777 temp uploads outputs && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose the application port
EXPOSE 5000

# Start the application
CMD ["node", "src/server.js"]
