# Preparation only: pin reviewed image digests before release on the target host.
ARG NODE_IMAGE=node:26-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --include=dev
COPY frontend frontend
COPY shared shared
COPY demo demo
COPY scripts scripts
# Recommended topology is same-origin through Caddy. Only public build args.
ARG BUILD_MAIN=true
ARG VITE_API_ORIGIN=""
ARG VITE_REALTIME_ORIGIN=""
ARG PHONE_API_ORIGIN=""
ARG PHONE_REALTIME_ORIGIN=""
ENV VITE_API_ORIGIN="$VITE_API_ORIGIN" VITE_REALTIME_ORIGIN="$VITE_REALTIME_ORIGIN" PHONE_API_ORIGIN="$PHONE_API_ORIGIN" PHONE_REALTIME_ORIGIN="$PHONE_REALTIME_ORIGIN"
RUN if [ "$BUILD_MAIN" = "true" ]; then npm run build:main; elif [ "$BUILD_MAIN" = "false" ]; then mkdir -p frontend/dist; else echo "BUILD_MAIN must be true or false" >&2; exit 1; fi && npm run build:demo

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libglib2.0-0 libgl1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev
COPY website-smart-bot/package.json website-smart-bot/package-lock.json website-smart-bot/
RUN npm ci --prefix website-smart-bot --omit=dev
COPY backend backend
COPY shared shared
COPY vision vision
COPY scripts scripts
COPY website-smart-bot/src website-smart-bot/src
COPY website-smart-bot/public website-smart-bot/public
COPY --from=build /app/frontend/dist frontend/dist
COPY --from=build /app/dist dist
RUN python3 -m venv /opt/vision && /opt/vision/bin/pip install --no-cache-dir -r vision/requirements-demo.txt && OCR_PYTHON=/opt/vision/bin/python npm run setup:ocr && mkdir -p .local/assistant && chown -R node:node /app/.local
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5000 OCR_PYTHON=/opt/vision/bin/python DEMO_VISION_PYTHON=/opt/vision/bin/python
USER node
EXPOSE 5000
CMD ["node", "backend/src/server.js"]
