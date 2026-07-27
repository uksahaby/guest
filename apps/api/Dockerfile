# The API. Built from the workspace root, because apps/api depends on
# packages/checkin-core through the npm workspace:
#   docker build -f apps/api/Dockerfile -t guest-api .
FROM node:22-alpine

WORKDIR /app

# Manifests first, so a code change does not reinstall the world.
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY packages/checkin-core/package.json packages/checkin-core/
RUN npm ci --workspace api --include-workspace-root

COPY packages/checkin-core packages/checkin-core
COPY apps/api apps/api
# The migration runner reads these at runtime, not at build time.
COPY db/migrations db/migrations
COPY spec/schema-v1.sql spec/schema-v1.sql

ENV NODE_ENV=production
# env.host defaults to 0.0.0.0 under NODE_ENV=production; stated here too
# so it is visible to anyone reading the image rather than the source.
ENV HOST=0.0.0.0
EXPOSE 3001

# Migrations are deliberately NOT run here. They need the superuser URL,
# which the running app must never hold, and a container that migrates on
# boot races itself the moment there is more than one instance. Run
# `npm run migrate --workspace api` as a release step instead.
CMD ["npm", "run", "start", "--workspace", "api"]
