/**
 * Bot Monitor v2 - 可靠的云端/本地切换监控
 * - 只负责检测云端是否在线
 * - 云端在线时，绝对不启动本地机器人
 * - 云端离线超过阈值，才启动本地机器人
 * - 云端恢复在线，立即停掉本地机器人
 */

const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const CONFIG = {
  BOT_KEY: 'kcb_live_421_nNLtaS1IDYmNmGbFk7HVwYj4H7gGDhyfKAbp9T0zyunYSro',
  KUKE_API_BASE: 'https://chat-api.kuke.ink/api/v1',
  CHECK_INTERVAL: 30 * 1000,  // 每30秒检测一次
  OFFLINE_THRESHOLD: 3,         // 离线3次才启动本地
  LOCAL_BOT_PATH: __dirname,
  LOCAL_BOT_FILE: 'index.js',
  LOCAL_PORT: 8080,
  LOG_FILE: path.join(__dirname, 'monitor_log.txt')
};

let offlineCount = 0;
let localBotProcess = null;
let isStartingLocal = false;

function log(msg) {
  const time = new Date().toLocaleString('zh-CN');
  const line = `[${time}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(CONFIG.LOG_FILE, line + '\n'); } catch(e) {}
}

// 检测云端机器人是否在线
function checkCloudOnline() {
  return new Promise((resolve) => {
    const url = `${CONFIG.KUKE_API_BASE}/bot-api/conversations`;
    const req = https.get(url, {
      headers: { 'Authorization': `Bot ${CONFIG.BOT_KEY}` },
      timeout: 10000
    }, (res) => {
      if (res.statusCode === 200) {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(!!(json && (json.data || json.conversations || Array.isArray(json))));
          } catch {
            resolve(false);
          }
        });
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// 检测本地机器人是否在运行（检查端口3000是否被监听）
function isLocalRunning() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(CONFIG.LOCAL_PORT, '127.0.0.1');
  });
}

// 启动本地机器人
function startLocalBot() {
  if (isStartingLocal) {
    log('正在启动本地机器人中，跳过');
    return;
  }
  if (localBotProcess) {
    log('本地机器人已在运行');
    return;
  }
  isStartingLocal = true;
  log('启动本地机器人...');
  try {
    localBotProcess = spawn('node', [CONFIG.LOCAL_BOT_FILE], {
      cwd: CONFIG.LOCAL_BOT_PATH,
      detached: false,
      stdio: 'ignore'
    });
    localBotProcess.on('exit', (code) => {
      log(`本地机器人退出，code=${code}`);
      localBotProcess = null;
      isStartingLocal = false;
    });
    localBotProcess.on('error', (err) => {
      log(`本地机器人启动失败: ${err.message}`);
      localBotProcess = null;
      isStartingLocal = false;
    });
    setTimeout(() => { isStartingLocal = false; }, 5000);
    log('本地机器人已启动');
  } catch (e) {
    log(`启动本地机器人异常: ${e.message}`);
    isStartingLocal = false;
  }
}

// 停掉本地机器人
function stopLocalBot() {
  if (localBotProcess) {
    log('停掉本地机器人...');
    try {
      localBotProcess.kill('SIGTERM');
    } catch(e) {}
    localBotProcess = null;
    log('本地机器人已停掉');
  }
  // 额外检查：如果端口还在监听，强制停掉
  isLocalRunning().then((running) => {
    if (running) {
      log('端口仍在监听，强制停掉node进程...');
      const { exec } = require('child_process');
      // 只停掉监听3000端口的node进程，不影响监控脚本
      exec('netstat -ano | findstr :8080 | findstr LISTENING', (err, stdout) => {
        if (stdout) {
          const lines = stdout.trim().split('\n');
          lines.forEach(line => {
            const match = line.match(/LISTENING\s+(\d+)/);
            if (match) {
              const pid = match[1];
              log(`强制停掉 PID=${pid}`);
              exec(`taskkill /F /PID ${pid}`, () => {});
            }
          });
        }
      });
    }
  });
}

// 主检测循环
async function checkLoop() {
  try {
    const cloudOnline = await checkCloudOnline();
    const localRunning = await isLocalRunning();

    log(`Cloud: ${cloudOnline}, Local: ${localRunning}, Offline: ${offlineCount}/${CONFIG.OFFLINE_THRESHOLD}`);

    if (cloudOnline) {
      // 云端在线：重置离线计数，确保本地不运行
      offlineCount = 0;
      if (localRunning || localBotProcess) {
        log('云端在线，停掉本地机器人（防止重复）');
        stopLocalBot();
      }
    } else {
      // 云端离线
      offlineCount++;
      log(`云端离线，计数 ${offlineCount}/${CONFIG.OFFLINE_THRESHOLD}`);
      if (offlineCount >= CONFIG.OFFLINE_THRESHOLD && !localRunning && !localBotProcess) {
        log('云端离线太久，启动本地机器人');
        startLocalBot();
      }
    }
  } catch (e) {
    log(`检测异常: ${e.message}`);
  }
}

// 启动时先停掉本地机器人
log('=== Bot Monitor v2 启动 ===');
log(`检测间隔: ${CONFIG.CHECK_INTERVAL/1000}秒, 离线阈值: ${CONFIG.OFFLINE_THRESHOLD}次`);
stopLocalBot();
setTimeout(() => {
  checkLoop();
  setInterval(checkLoop, CONFIG.CHECK_INTERVAL);
}, 3000);

// 优雅退出
process.on('SIGINT', () => {
  log('监控退出，停掉本地机器人');
  stopLocalBot();
  process.exit(0);
});
