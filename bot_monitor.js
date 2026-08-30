/**
 * 机器人云端/本地自动切换监控脚本
 * 功能：定期检测云端(Railway)机器人是否在线，如果离线则自动启动本地机器人
 * 使用：node bot_monitor.js
 * 开机自启动：把 bot_monitor.vbs 加入开机启动项
 */

const https = require('https');
const http = require('http');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  BOT_KEY: 'kcb_live_421_vJhzsuy8kP9ay7EfCUvmNz0CEvZoRQAjoVZXNjyRHi',
  KUKE_API_BASE: 'https://chat.kukechat.com/api',
  CHECK_INTERVAL: 60 * 1000, // 每60秒检查一次
  OFFLINE_THRESHOLD: 3, // 连续3次检测离线才启动本地
  LOCAL_BOT_PATH: __dirname,
  LOCAL_BOT_FILE: 'index.js',
  LOG_FILE: path.join(__dirname, 'monitor_log.txt')
};

let offlineCount = 0;
let localBotProcess = null;

// 日志函数
function log(msg) {
  const time = new Date().toLocaleString('zh-CN');
  const line = `[${time}] ${msg}`;
  console.log(line);
  fs.appendFileSync(CONFIG.LOG_FILE, line + '\n', 'utf8');
}

// 检测云端机器人是否在线
function checkCloudBotOnline() {
  return new Promise((resolve) => {
    const url = `${CONFIG.KUKE_API_BASE}/bot-api/me`;
    const req = https.get(url, {
      headers: { 'Authorization': `Bot ${CONFIG.BOT_KEY}` }
    }, (res) => {
      if (res.statusCode === 200) {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            // 如果返回了机器人信息，说明在线
            if (json && (json.id || json.user_id || json.bot_id)) {
              resolve(true);
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
          }
        });
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
  });
}

// 检查本地机器人是否在运行
function isLocalBotRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', (err, stdout) => {
      if (err) { resolve(false); return; }
      // 检查是否有 node.exe 进程在运行 index.js
      // 简单判断：有 node 进程就算在运行
      const hasNode = stdout.includes('node.exe');
      resolve(hasNode);
    });
  });
}

// 启动本地机器人
function startLocalBot() {
  if (localBotProcess) {
    log('本地机器人已在运行，不重复启动');
    return;
  }
  log('正在启动本地机器人...');
  localBotProcess = spawn('node', [CONFIG.LOCAL_BOT_FILE], {
    cwd: CONFIG.LOCAL_BOT_PATH,
    detached: false,
    stdio: 'inherit'
  });
  localBotProcess.on('exit', (code) => {
    log(`本地机器人退出，code=${code}`);
    localBotProcess = null;
  });
  log('本地机器人已启动');
}

// 停止本地机器人
function stopLocalBot() {
  if (!localBotProcess) {
    // 尝试杀掉所有 node 进程
    exec('taskkill /F /IM node.exe', (err) => {
      if (err) {
        log('停止本地机器人失败: ' + err.message);
      } else {
        log('本地机器人已停止');
      }
    });
    return;
  }
  log('正在停止本地机器人...');
  localBotProcess.kill('SIGTERM');
  localBotProcess = null;
  log('本地机器人已停止');
}

// 主检查循环
async function checkLoop() {
  try {
    const cloudOnline = await checkCloudBotOnline();
    const localRunning = await isLocalBotRunning();

    log(`云端在线: ${cloudOnline}, 本地运行: ${localRunning}, 离线计数: ${offlineCount}`);

    if (cloudOnline) {
      // 云端在线，重置离线计数
      offlineCount = 0;
      // 如果本地也在运行，停止本地（避免冲突）
      if (localRunning) {
        log('云端已在线，停止本地机器人避免冲突');
        stopLocalBot();
      }
    } else {
      // 云端离线
      offlineCount++;
      log(`云端离线，计数 ${offlineCount}/${CONFIG.OFFLINE_THRESHOLD}`);

      if (offlineCount >= CONFIG.OFFLINE_THRESHOLD && !localRunning) {
        log('云端连续离线，启动本地机器人');
        startLocalBot();
      }
    }
  } catch (e) {
    log('检查出错: ' + e.message);
  }
}

// 启动
log('=== 机器人监控脚本启动 ===');
log(`检查间隔: ${CONFIG.CHECK_INTERVAL / 1000}秒, 离线阈值: ${CONFIG.OFFLINE_THRESHOLD}次`);

// 立即检查一次
checkLoop();

// 定期检查
setInterval(checkLoop, CONFIG.CHECK_INTERVAL);

// 优雅退出
process.on('SIGINT', () => {
  log('监控脚本退出');
  if (localBotProcess) localBotProcess.kill();
  process.exit(0);
});
