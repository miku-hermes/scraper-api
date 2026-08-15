# scraper-api：基于 camofox-browser 镜像（自带 Camoufox 浏览器）
# 启动时同时运行：camofox-browser(9377) + scraper-api(3200)
FROM ghcr.io/jo-inc/camofox-browser:latest

WORKDIR /app

# 复制 scraper-api 代码到独立目录（不覆盖 camofox 的 package.json）
COPY server.js /app/scraper/scraper-server.js
COPY package.json /app/scraper/package.json
RUN cd /app/scraper && npm install --omit=dev 2>&1 | tail -2

# 入口脚本：先启动 camofox(9377)，就绪后启动 scraper-api(3200)
COPY docker-entrypoint.sh /app/docker-entrypoint-scraper.sh
RUN chmod +x /app/docker-entrypoint-scraper.sh

EXPOSE 9377 3200

ENTRYPOINT ["/app/docker-entrypoint-scraper.sh"]
