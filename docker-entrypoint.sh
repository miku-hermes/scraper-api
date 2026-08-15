#!/bin/sh
set -e

echo "[scraper-api] 启动 camofox-browser (9377)..."
cd /app && node server.js &
CAMOFOX_PID=$!

# 等待 camofox 就绪
echo "[scraper-api] 等待 camofox 就绪..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:9377/health >/dev/null 2>&1; then
    echo "[scraper-api] camofox 就绪"
    break
  fi
  sleep 1
done

echo "[scraper-api] 启动 scraper-api (3200)..."
cd /app/scraper && node scraper-server.js &
SCRAPER_PID=$!

# 保持进程存活，任一退出则整体退出
wait $CAMOFOX_PID
wait $SCRAPER_PID
