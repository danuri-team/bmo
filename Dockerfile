# Build stage
FROM node:20-alpine AS builder

# Install build dependencies for canvas (chartjs-node-canvas)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN yarn build

# Production stage
FROM node:20-alpine AS runner

# Install runtime dependencies for canvas
RUN apk add --no-cache \
    cairo \
    pango \
    libjpeg-turbo \
    giflib \
    librsvg \
    pixman \
    fontconfig \
    ttf-dejavu \
    curl \
    gnupg

RUN apk add --no-cache --virtual .build-deps \
    python3 \
    make \
    g++ \
    pkgconfig \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install production dependencies only
RUN yarn install --frozen-lockfile --production \
    && apk del .build-deps

# Copy built files from builder
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

CMD ["node", "dist/discord-bot.js"]
