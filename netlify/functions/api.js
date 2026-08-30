// Netlify Function: 代理 KukeChat API 请求，解决跨域问题
const https = require('https');

exports.handler = async (event) => {
  const path = event.path.replace('/.netlify/functions/api', '');
  const targetPath = '/api/v1' + path;

  return new Promise((resolve) => {
    const headers = { ...event.headers };
    delete headers['content-length'];
    delete headers['host'];
    headers['host'] = 'chat-api.kuke.ink';

    const options = {
      hostname: 'chat-api.kuke.ink',
      path: targetPath,
      method: event.httpMethod,
      headers
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let body = '';
      proxyRes.on('data', chunk => body += chunk);
      proxyRes.on('end', () => {
        const resHeaders = { ...proxyRes.headers };
        delete resHeaders['content-encoding'];
        resolve({
          statusCode: proxyRes.statusCode,
          headers: resHeaders,
          body: body
        });
      });
    });

    proxyReq.on('error', (e) => {
      resolve({ statusCode: 500, body: JSON.stringify({ error: e.message }) });
    });

    if (event.body) {
      proxyReq.write(event.body);
    }
    proxyReq.end();
  });
};
