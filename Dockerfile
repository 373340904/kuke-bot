FROM node:18-alpine

WORKDIR /app

# 安装基础工具
RUN apk add --no-cache curl

# 复制 package.json
COPY package.json ./

# 安装依赖
RUN npm install --production || true

# 复制所有代码和数据文件
COPY . .

# 暴露端口（如果有 HTTP 服务）
EXPOSE 3000

# 启动机器人
CMD ["node", "index.js"]
