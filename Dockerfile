#
# Version
#
FROM node:22-alpine AS version

RUN apk add --no-cache git

WORKDIR /git

COPY package.json ./
COPY .git .git

# Generate version.json in the final stage (fast, no cache invalidation of earlier layers)
RUN \
    BUILD_TIME=$(TZ='America/Chicago' date -Iseconds) && \
    FRONTEND_VERSION=$(node -p "require('/git/package.json').version" 2>/dev/null || echo "0.0.0") && \
    GIT_TAG=$(git describe --abbrev=0 --tags --match="v[0-9]*" 2>/dev/null || echo "no-tag") && \
    GIT_COMMIT=$(git rev-parse HEAD) && \
    GIT_COMMIT_SHORT=$(git rev-parse --short HEAD) && \
    GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD) && \
    echo '{ "frontend": "'${FRONTEND_VERSION}'", "gitTag": "'${GIT_TAG}'", "gitCommit": "'${GIT_COMMIT}'", "gitCommitShort": "'${GIT_COMMIT_SHORT}'", "gitBranch": "'${GIT_BRANCH}'", "buildTime": "'${BUILD_TIME}'" }' > .build.json && \
    echo "Generated version.json:" && cat .build.json


FROM node:20-bookworm-slim AS base
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build


FROM node:20-bookworm-slim AS final
WORKDIR /app
COPY --from=version /git/.build.json ./version.json
COPY --from=base /app/build ./build
EXPOSE 3000
CMD ["node", "build"]