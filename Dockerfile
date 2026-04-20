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


#
# Builder
#
FROM node:22-alpine AS base

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build


#
# Runtime dependencies
#
FROM node:22-alpine AS runtime-deps

WORKDIR /app

COPY package.json ./package.json
RUN node -e "const fs=require('node:fs'); const pkg=require('./package.json'); const pick=(k)=>pkg.dependencies?.[k]||pkg.devDependencies?.[k]; const deps=['@sveltejs/kit','svelte','clsx','minio','mysql2','unified','remark-parse','remark-gfm','remark-breaks','remark-math','remark-rehype','rehype-katex','rehype-highlight','rehype-stringify']; const runtime={name:(pkg.name||'webui')+'-runtime',private:true,type:pkg.type||'module',dependencies:Object.fromEntries(deps.map((k)=>[k,pick(k)]).filter(([,v])=>Boolean(v)))}; fs.writeFileSync('package.json', JSON.stringify(runtime, null, 2));"
RUN npm install --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund && npm cache clean --force

#
# Final image
#
FROM node:22-alpine AS final

ENV NODE_ENV=production

WORKDIR /app

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=base /app/build /app
COPY --from=version /git/.build.json ./version.json


EXPOSE 3000
CMD ["node", "index.js"]