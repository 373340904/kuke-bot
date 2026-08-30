// 本地代理服务器：托管网页 + 转发 KukeChat API 请求（解决CORS跨域）
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const API_HOST = 'chat-api.kuke.ink';
const API_BASE = '/api/v1';

const server = http.createServer((req, res) => {
  // API 代理
  if (req.url.startsWith('/api/')) {
    const targetPath = req.url.replace('/api', API_BASE);
    const options = {
      hostname: API_HOST,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: API_HOST }
    };
    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      res.writeHead(500);
      res.end('Proxy error: ' + e.message);
    });
    req.pipe(proxyReq);
    return;
  }

  // WebSocket 代理（Bot连接用）
  if (req.url.startsWith('/bot-ws')) {
    const wsUrl = `wss://${API_HOST}/bot/ws` + req.url.replace('/bot-ws', '');
    // 简单处理，实际WebSocket升级需要额外处理
    res.writeHead(400);
    res.end('WebSocket请直接连接 wss://chat-api.kuke.ink/bot/ws');
    return;
  }

  // 静态文件
  let filePath = '.' + req.url;
  if (filePath === './') filePath = './index.html';
  const ext = path.extname(filePath);
  const contentType = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
  }[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
  console.log(`API代理: /api/* -> https://${API_HOST}${API_BASE}/*`);
});
