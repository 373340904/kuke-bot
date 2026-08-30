/**
 * Bot Monitor - auto switch between cloud and local
 * - Check every 60s if cloud bot is online
 * - If offline for 3 checks, start local bot
 * - If online, stop local bot to avoid conflict
 */

const https = require('https');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  BOT_KEY: 'kcb_live_421_vJhzsuy8kP9ay7EfCUvmNz0CEvZoRQAjoVZXNjyRHi',
  KUKE_API_BASE: 'https://chat-api.kuke.ink/api/v1',
  CHECK_INTERVAL: 60 * 1000,
  OFFLINE_THRESHOLD: 3,
  LOCAL_BOT_PATH: __dirname,
  LOCAL_BOT_FILE: 'index.js',
  LOG_FILE: path.join(__dirname, 'monitor_log.txt')
};

let offlineCount = 0;
let localBotProcess = null;

function log(msg) {
  const time = new Date().toLocaleString('zh-CN');
  const line = `[${time}] ${msg}`;
  console.log(line);
  fs.appendFileSync(CONFIG.LOG_FILE, line + '\n');
}

function checkCloudBotOnline() {
  return new Promise((resolve) => {
    // 用获取群列表接口检测，比 /bot-api/me 更可靠
    const url = `${CONFIG.KUKE_API_BASE}/bot-api/conversations`;
    const req = https.get(url, {
      headers: { 'Authorization': `Bot ${CONFIG.BOT_KEY}` }
    }, (res) => {
      if (res.statusCode === 200) {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            // 能获取到数据说明云端在线
            if (json && (json.data || json.conversations || Array.isArray(json))) {
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

function isLocalBotRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', (err, stdout) => {
      if (err) { resolve(false); return; }
      const lines = stdout.trim().split('\n').filter(l => l.includes('node.exe'));
      // 如果有2个以上node进程（监控脚本+机器人），说明机器人在运行
      resolve(lines.length >= 2);
    });
  });
}

function startLocalBot() {
  if (localBotProcess) {
    log('Local bot already running');
    return;
  }
  log('Starting local bot...');
  localBotProcess = spawn('node', [CONFIG.LOCAL_BOT_FILE], {
    cwd: CONFIG.LOCAL_BOT_PATH,
    detached: false,
    stdio: 'ignore'
  });
  localBotProcess.on('exit', (code) => {
    log(`Local bot exited, code=${code}`);
    localBotProcess = null;
  });
  log('Local bot started');
}

function stopLocalBot() {
  if (localBotProcess) {
    log('Stopping local bot...');
    localBotProcess.kill('SIGTERM');
    localBotProcess = null;
    log('Local bot stopped');
  } else {
    exec('taskkill /F /IM node.exe /FI "WINDOWTITLE ne *monitor*"', () => {
      log('Killed local bot processes');
    });
  }
}

async function checkLoop() {
  try {
    const cloudOnline = await checkCloudBotOnline();
    const localRunning = await isLocalBotRunning();

    log(`Cloud: ${cloudOnline}, Local: ${localRunning}, Offline count: ${offlineCount}`);

    if (cloudOnline) {
      offlineCount = 0;
      if (localRunning) {
        log('Cloud online, stopping local to avoid conflict');
        stopLocalBot();
      }
    } else {
      offlineCount++;
      log(`Cloud offline, count ${offlineCount}/${CONFIG.OFFLINE_THRESHOLD}`);
      if (offlineCount >= CONFIG.OFFLINE_THRESHOLD && !localRunning) {
        log('Cloud offline for too long, starting local bot');
        startLocalBot();
      }
    }
  } catch (e) {
    log('Check error: ' + e.message);
  }
}

log('=== Bot Monitor Started ===');
log(`Interval: ${CONFIG.CHECK_INTERVAL / 1000}s, Threshold: ${CONFIG.OFFLINE_THRESHOLD}`);

checkLoop();
setInterval(checkLoop, CONFIG.CHECK_INTERVAL);

process.on('SIGINT', () => {
  log('Monitor exiting');
  if (localBotProcess) localBotProcess.kill();
  process.exit(0);
});
