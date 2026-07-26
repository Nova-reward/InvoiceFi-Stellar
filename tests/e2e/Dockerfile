FROM mcr.microsoft.com/playwright:v1.48.0-noble

WORKDIR /e2e

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN npx playwright install chromium --with-deps

RUN chmod +x scripts/setup-test-env.sh

ENTRYPOINT ["npx", "playwright", "test"]
