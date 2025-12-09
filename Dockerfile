FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev \
    fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./
COPY src ./src

RUN yarn install --frozen-lockfile \
    && yarn build \
    && yarn install --frozen-lockfile --production --ignore-scripts \
    && apt-get purge -y python3 make g++ pkg-config \
    && apt-get autoremove -y \
    && rm -rf src tsconfig.json /var/lib/apt/lists/* /root/.cache

ENV NODE_ENV=production

CMD ["node", "dist/discord-bot.js"]
