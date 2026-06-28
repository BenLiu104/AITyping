# 🚀 前端 Dockerfile - 生產環境多階段構建 (ARM64/AMD64 相容)
# Phase 1: 構建靜態資源
FROM node:20-alpine AS builder

WORKDIR /app

# 複製 package.json 先安裝依賴以利用 Docker 緩存
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Phase 2: 生產伺服器 (使用極輕量 Nginx 託管靜態資源)
FROM nginx:stable-alpine AS runner

# 複製構建好的 dist 檔案到 Nginx 預設靜態目錄
COPY --from=builder /app/dist /usr/share/nginx/html

# 複製自定義 Nginx 配置以支援 React Router SPA 路由與 PWA assets
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
