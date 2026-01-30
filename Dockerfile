FROM oven/bun:1.3.8-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]

