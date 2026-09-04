const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 全局异常保护：防止未捕获异常导致机器人崩溃
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ 未处理的Promise拒绝:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ 未捕获的异常:', err.message);
  console.error(err.stack);
});

// 日志写入文件
const logFile = path.join(__dirname, 'bot_debug.log');
const origLog = console.log;
console.log = function(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`);
  origLog.apply(console, args);
};

// ====== 配置区：把下面的引号里换成你自己的 Bot Key ======
const BOT_KEY = 'kcb_live_421_vJhzsuy8kP9ay7EfCUvmNz0CEvZoRQAjoVZXNjyRHi';
// 智谱AI免费Key（glm-4-flash模型完全免费），申请地址：https://open.bigmodel.cn/usercenter/apikeys
const ZHIPU_API_KEY = 'd9cd0300341d4ac1aed9260c715c1a8a.2aChFKD7pTs3j7Y4'; // 在这里填你的智谱AI API Key
// ========================================================

const BASE_URL = 'https://chat-api.kuke.ink/api/v1';
const WS_URL = `wss://chat-api.kuke.ink/bot/ws?key=${encodeURIComponent(BOT_KEY)}`;
// 机器人信息缓存（从发消息返回数据中提取，避免依赖不可用的GET API）
const botInfo = { nickname: null, userId: null, botId: null, username: null, bio: null, avatar: null, status: null };
let botUserId = null; // 机器人自身的user_id，连接就绪时设置
function updateBotInfo(data) {
  if (data?.sender) {
    if (data.sender.nickname) botInfo.nickname = data.sender.nickname;
    if (data.sender.id) botInfo.userId = data.sender.id;
    if (data.sender.user_id) botInfo.userId = data.sender.user_id;
  }
  if (data?.metadata?.bot?.id) botInfo.botId = data.metadata.bot.id;
  if (data?.bot_id) botInfo.botId = data.bot_id;
}

// 发群聊消息
async function sendMsg(conversationId, text) {
  try {
    const body = { message: text };
    // 群4307专属机器人名称
    if (String(conversationId) === '4307') {
      body.sender_name = '智羽班级智能体';
    }
    const res = await fetch(`${BASE_URL}/bot-api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${BOT_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log('发送结果:', data);
    updateBotInfo(data);
    return true;
  } catch (e) {
    console.error('发送失败:', e.message);
    return false;
  }
}

// 发消息并返回消息对象（含id，用于更新按钮）
async function sendMsgReturnId(conversationId, text) {
  try {
    const body = { message: text };
    if (String(conversationId) === '4307') {
      body.sender_name = '智羽班级智能体';
    }
    const res = await fetch(`${BASE_URL}/bot-api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${BOT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    updateBotInfo(data);
    return data;
  } catch (e) {
    console.error('发送失败:', e.message);
    return null;
  }
}

async function updateMessage(conversationId, messageId, text) {
  try {
    const res = await fetch(`${BASE_URL}/bot-api/conversations/${conversationId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bot ${BOT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    return res.ok;
  } catch (e) {
    console.error('更新消息失败:', e.message);
    return false;
  }
}

// 更新按钮状态
async function updateButton(conversationId, messageId, componentId, label, variant, disabled, scope, userId) {
  try {
    const body = { label, variant, disabled };
    if (scope === 'user') { body.scope = 'user'; body.user_id = userId; }
    await fetch(`${BASE_URL}/bot-api/conversations/${conversationId}/messages/${messageId}/components/${componentId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bot ${BOT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return true;
  } catch (e) {
    console.error('更新按钮失败:', e.message);
    return false;
  }
}

// 快捷更新按钮文字（仅点击者可见）
function setBtn(data, actionId, label, variant, disabled) {
  updateButton(data.conversation_id, data.message_id, actionId, label, variant, disabled, 'user', data.user_id);
}

// 发私信（创建临时私聊，不需要用户先发起）
async function sendPrivateMsg(userId, text) {
  try {
    const res = await fetch(`${BASE_URL}/bot-api/direct/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${BOT_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId, message: text }),
    });
    const data = await res.json();
    updateBotInfo(data);
    if (!res.ok) {
      console.log('私信发送失败:', userId, data);
      return { success: false, error: data };
    }
    return { success: true, data };
  } catch (e) {
    console.log('私信发送异常:', userId, e.message);
    return { success: false, error: e.message };
  }
}

// 获取群成员列表
async function getConversationMembers(conversationId) {
  const res = await fetch(`${BASE_URL}/bot-api/conversations/${conversationId}/members`, {
    headers: { 'Authorization': `Bot ${BOT_KEY}` },
  });
  return res.json();
}

// 获取全局在线用户
async function getOnlineUsers() {
  const res = await fetch(`${BASE_URL}/bot-api/users/online`, {
    headers: { 'Authorization': `Bot ${BOT_KEY}` },
  });
  return res.json();
}

// 从返回数据中提取成员数组（兼容多种格式）
function extractMembers(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.members)) return data.members;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.users)) return data.users;
  return [];
}

// 获取成员的用户ID（兼容多种字段名）
function getUserId(member) {
  return member.user_id ?? member.id ?? member.uid ?? member.userId;
}

// 获取成员昵称（兼容多种字段名和嵌套结构）
function getUserName(member) {
  // 第一层直接找
  const directName = member.nickname ?? member.display_name ?? member.name ?? member.username ?? member.user_display_name ?? member.member_nickname ?? member.group_nickname;
  if (directName) return directName;

  // 嵌套在 user 对象里找
  if (member.user && typeof member.user === 'object') {
    const nestedName = member.user.nickname ?? member.user.display_name ?? member.user.name ?? member.user.username ?? member.user.user_display_name;
    if (nestedName) return nestedName;
  }

  // 嵌套在 profile 对象里找
  if (member.profile && typeof member.profile === 'object') {
    const profileName = member.profile.nickname ?? member.profile.display_name ?? member.profile.name;
    if (profileName) return profileName;
  }

  return '未知用户';
}

// 判断成员是否在线（兼容多种字段名）
function isMemberOnline(member) {
  if (member.is_online === true) return true;
  if (member.online === true) return true;
  if (member.status === 'online') return true;
  if (member.is_online === false || member.online === false) return false;
  return null; // 无法判断，返回null
}

// ========== 群活跃统计 ==========
const ACTIVITY_FILE = path.join(__dirname, 'activity_data.json');
function loadActivityData() {
  try {
    if (fs.existsSync(ACTIVITY_FILE)) return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
  } catch (e) { console.error('读取活跃数据失败:', e.message); }
  return {};
}
function saveActivityData(data) {
  try { fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch (e) { console.error('保存活跃数据失败:', e.message); }
}
function recordActivity(cid, uid, uname) {
  const today = getTodayStr();
  const data = loadActivityData();
  if (!data[today]) data[today] = {};
  if (!data[today][cid]) data[today][cid] = {};
  const key = String(uid);
  if (!data[today][cid][key]) {
    data[today][cid][key] = { name: uname, count: 0 };
  }
  data[today][cid][key].count++;
  data[today][cid][key].name = uname; // 更新最新昵称
  // 只保留最近7天数据
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth()+1).padStart(2,'0')}-${String(sevenDaysAgo.getDate()).padStart(2,'0')}`;
  Object.keys(data).forEach(d => { if (d < cutoff) delete data[d]; });
  saveActivityData(data);
}

// ========== 签到功能 ==========
const CHECKIN_FILE = path.join(__dirname, 'checkin_data.json');

// 获取今天日期字符串
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 读取签到数据
function loadCheckinData() {
  try {
    const raw = fs.readFileSync(CHECKIN_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { date: '', conversations: {} };
  }
}

// 保存签到数据
function saveCheckinData(data) {
  fs.writeFileSync(CHECKIN_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// 随机生成今日运势
function generateFortune() {
  const fortunes = [
    { level: '大吉', desc: '万事顺意，心想事成，适合搞大事！' },
    { level: '吉', desc: '运势不错，稳步前行必有收获。' },
    { level: '中吉', desc: '平稳度日，不宜冒进，稳中求胜。' },
    { level: '小吉', desc: '小有收获，积少成多，继续努力。' },
    { level: '中平', desc: '平平淡淡才是真，好好休息吧。' },
    { level: '凶', desc: '容易烦烦，少做决定（现实为准）。' },
    { level: '大凶', desc: '诸事不宜，躺平一天，别给自己找事。' },
  ];
  const colors = ['红色', '蓝色', '绿色', '黄色', '紫色', '橙色', '粉色', '黑色', '白色', '青色', '金色', '银色'];
  const yiList = [
    '宜暴躁怼人！😆',
    '宜摸鱼划水🐟',
    '宜好好学习📚',
    '宜早睡早起😴',
    '宜喝杯奶茶🧋',
    '宜打把游戏🎮',
    '宜出门散步🚶',
    '宜写代码💻',
    '宜发呆放空😶',
    '宜请人吃饭🍜',
    '宜听首音乐🎵',
    '宜运动健身💪',
  ];

  const fortune = fortunes[Math.floor(Math.random() * fortunes.length)];
  const star = Math.floor(Math.random() * 100) + 1;
  const luckyNum = Math.floor(Math.random() * 99) + 1;
  const color = colors[Math.floor(Math.random() * colors.length)];
  const yi = yiList[Math.floor(Math.random() * yiList.length)];

  return { fortune, star, luckyNum, color, yi };
}

// 生成签到卡片（Markdown格式）
function buildCheckinCard(userName, today, rank, fortuneLevel, fortuneDesc, star, luckyNum, color, yi, title) {
  const cardTitle = title || '✅签到完成！';
  let reply = `<markdown># ${cardTitle}\n\n`;
  reply += `**用户：**${userName}\n`;
  reply += `**日期：**\`${today}\`\n`;
  reply += `**排名：**你是今日第 \`${rank}\` 签到的人\n\n`;
  reply += `## 🎲今日运势\n\n`;
  reply += `🔮${fortuneLevel}\n`;
  reply += `> ${fortuneDesc}\n`;
  reply += `- **幸运星星：**\`${star}\`/\`100\`\n`;
  reply += `- **幸运数字：**\`${luckyNum}\`\n`;
  reply += `- **幸运色：**${color}\n`;
  reply += `- **宜：**${yi}\n\n`;
  reply += `❤️今日签到已完成，明日再来吧~</markdown>`;
  return reply;
}

// ========== 天气功能 ==========
// 天气描述中英文映射
const WEATHER_DESC_MAP = {
  'Sunny': '晴', 'Clear': '晴', 'Clear sky': '晴',
  'Partly cloudy': '局部多云', 'Partly Cloudy': '局部多云',
  'Cloudy': '多云', 'Overcast': '阴',
  'Mist': '薄雾', 'Fog': '雾', 'Freezing fog': '冻雾',
  'Patchy rain possible': '可能有零星小雨', 'Patchy rain nearby': '附近有零星小雨',
  'Light rain': '小雨', 'Light rain shower': '小阵雨',
  'Moderate rain': '中雨', 'Moderate rain at times': '间歇性中雨',
  'Heavy rain': '大雨', 'Heavy rain at times': '间歇性大雨',
  'Torrential rain shower': '暴雨', 'Torrential rain': '暴雨',
  'Patchy snow possible': '可能有零星小雪', 'Patchy snow nearby': '附近有零星小雪',
  'Light snow': '小雪', 'Light snow showers': '小阵雪',
  'Moderate snow': '中雪', 'Moderate or heavy snow': '中到大雪',
  'Heavy snow': '大雪', 'Blizzard': '暴风雪',
  'Patchy sleet possible': '可能有零星雨夹雪',
  'Light sleet': '小雨夹雪', 'Moderate or heavy sleet': '中到大雨夹雪',
  'Thundery outbreaks possible': '可能有雷暴', 'Patchy light rain with thunder': '雷阵雨',
  'Moderate or heavy rain with thunder': '雷暴中到大雨', 'Thunderstorm': '雷暴',
  'Light drizzle': '毛毛雨', 'Patchy light drizzle': '零星毛毛雨',
  'Freezing drizzle': '冻毛毛雨', 'Heavy freezing drizzle': '强冻毛毛雨',
  'Light freezing rain': '小冻雨', 'Moderate or heavy freezing rain': '中到大冻雨',
  'Ice pellets': '冰粒', 'Light showers of ice pellets': '小冰粒阵雨',
  'Moderate or heavy showers of ice pellets': '中到大冰粒阵雨',
  'Blowing snow': '吹雪', 'Blizzard': '暴风雪'
};

// 风向英文到中文
const WIND_DIR_MAP = {
  'N': '北', 'NNE': '北东北', 'NE': '东北', 'ENE': '东东北',
  'E': '东', 'ESE': '东东南', 'SE': '东南', 'SSE': '南东南',
  'S': '南', 'SSW': '南西南', 'SW': '西南', 'WSW': '西西南',
  'W': '西', 'WNW': '西西北', 'NW': '西北', 'NNW': '北西北'
};

function translateWeatherDesc(desc) {
  const lower = desc.toLowerCase();
  for (const [key, value] of Object.entries(WEATHER_DESC_MAP)) {
    if (key.toLowerCase() === lower) return value;
  }
  return desc;
}
function translateWindDir(dir) {
  return WIND_DIR_MAP[dir] || dir;
}

// 获取城市天气（wttr.in 免费接口，无需key）
async function getWeather(city) {
  const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`);
  if (!res.ok) throw new Error(`天气接口返回 ${res.status}`);
  return res.json();
}

// ========== 进群自动发送 ==========
const WELCOME_FILE = path.join(__dirname, 'welcome_data.json');

function loadWelcomeData() {
  try {
    const raw = fs.readFileSync(WELCOME_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveWelcomeData(data) {
  fs.writeFileSync(WELCOME_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ========== 群列表（用于全局推送）==========
const GROUPS_FILE = path.join(__dirname, 'groups.json');

function loadGroups() {
  try {
    return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveGroups(groups) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify([...groups], null, 2), 'utf-8');
}

function addGroup(conversationId) {
  const groups = new Set(loadGroups());
  if (!groups.has(conversationId)) {
    groups.add(conversationId);
    saveGroups(groups);
  }
}

// ========== 投票功能（按钮版）==========
const VOTE_FILE = path.join(__dirname, 'vote_data.json');

function loadVoteData() {
  try {
    if (!fs.existsSync(VOTE_FILE)) return {};
    return JSON.parse(fs.readFileSync(VOTE_FILE, 'utf-8'));
  } catch (e) {
    console.error('[投票] 数据文件损坏，备份后重置:', e.message);
    try {
      const backup = VOTE_FILE + '.broken.' + Date.now();
      fs.copyFileSync(VOTE_FILE, backup);
      console.log('[投票] 已备份到:', backup);
    } catch (e2) { console.error('[投票] 备份失败:', e2.message); }
    return {};
  }
}

function saveVoteData(data) {
  try {
    fs.writeFileSync(VOTE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[投票] 保存失败:', e.message);
  }
}

// ========== 创意游戏数据存储 ==========
const TELEPATHY_FILE = path.join(__dirname, 'telepathy_data.json');
function loadTelepathyData() { try { return JSON.parse(fs.readFileSync(TELEPATHY_FILE, 'utf-8')); } catch { return {}; } }
function saveTelepathyData(data) { try { fs.writeFileSync(TELEPATHY_FILE, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { console.error('[心灵感应]保存失败:', e.message); } }

const UNDERCOVER_FILE = path.join(__dirname, 'undercover_data.json');
function loadUndercoverData() { try { return JSON.parse(fs.readFileSync(UNDERCOVER_FILE, 'utf-8')); } catch { return {}; } }
function saveUndercoverData(data) { try { fs.writeFileSync(UNDERCOVER_FILE, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { console.error('[谁是卧底]保存失败:', e.message); } }

const STORY_FILE = path.join(__dirname, 'story_data.json');
function loadStoryData() { try { return JSON.parse(fs.readFileSync(STORY_FILE, 'utf-8')); } catch { return {}; } }
function saveStoryData(data) { try { fs.writeFileSync(STORY_FILE, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { console.error('[故事接龙]保存失败:', e.message); } }

const FATE_FILE = path.join(__dirname, 'fate_data.json');
function loadFateData() { try { return JSON.parse(fs.readFileSync(FATE_FILE, 'utf-8')); } catch { return {}; } }
function saveFateData(data) { try { fs.writeFileSync(FATE_FILE, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { console.error('[命运抉择]保存失败:', e.message); } }

// 私聊发送辅助函数
async function sendPrivateMsg(userId, content) {
  try {
    const resp = await fetch(`${BASE_URL}/bot-api/users/${userId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BOT_KEY}` },
      body: JSON.stringify({ content })
    });
    return await resp.json();
  } catch (e) { console.error('私聊发送失败:', e.message); }
}

function genVoteId() {
  const voteData = loadVoteData();
  let id;
  do {
    id = String(Math.floor(1000 + Math.random() * 9000));
  } while (voteData[id]);
  return id;
}

function getVoteCounts(vote) {
  const counts = vote.options.map(() => 0);
  Object.values(vote.votes).forEach(idx => { if (idx >= 0 && idx < counts.length) counts[idx]++; });
  return counts;
}

function buildVoteButtonMessage(vote) {
  const counts = getVoteCounts(vote);
  const total = counts.reduce((a, b) => a + b, 0);
  let msg = `<markdown># 📊 ${vote.title}\n\n`;
  msg += `> ID：${vote.voteId}\n`;
  if (vote.creator) msg += `> 发起人：${vote.creator}\n`;
  msg += `\n`;
  vote.options.forEach((opt, i) => {
    const count = counts[i];
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    const componentId = `${vote.voteId}_${i}`;
    msg += `<button action="callback" action_id="${componentId}" id="${componentId}">\`${i + 1}\`. ${opt} · \`${count}\`票(\`${pct}\`%)</button>\n`;
  });
  msg += `</markdown>`;
  return msg;
}

function buildVoteResultCard(vote) {
  const counts = getVoteCounts(vote);
  const total = counts.reduce((a, b) => a + b, 0);
  let reply = `<markdown># 🏁 ${vote.title} - 投票结果\n\n`;
  if (vote.creator) reply += `> 发起人：${vote.creator}\n`;
  reply += `\n`;
  vote.options.forEach((opt, i) => {
    const count = counts[i];
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    reply += `**${i + 1}. ${opt}**\n${bar} ${count}票 (${pct}%)\n\n`;
  });
  reply += `</markdown>`;
  return reply;
}

async function refreshVoteButtons(vote) {
  const counts = getVoteCounts(vote);
  const total = counts.reduce((a, b) => a + b, 0);
  // 全局投票：刷新所有群的按钮
  if (vote.isGlobal && vote.conversationIds) {
    for (const gid of vote.conversationIds) {
      const msgId = vote.messageIds[gid];
      if (!msgId) continue;
      for (let i = 0; i < vote.options.length; i++) {
        const componentId = `${vote.voteId}_${i}`;
        const pct = total > 0 ? Math.round(counts[i] / total * 100) : 0;
        const label = `${i + 1}. ${vote.options[i]} · ${counts[i]}票(${pct}%)`;
        await updateButton(gid, msgId, componentId, label, 'primary', false);
      }
    }
  } else {
    // 单群投票
    for (let i = 0; i < vote.options.length; i++) {
      const componentId = `${vote.voteId}_${i}`;
      const pct = total > 0 ? Math.round(counts[i] / total * 100) : 0;
        const label = `${i + 1}. ${vote.options[i]} · ${counts[i]}票(${pct}%)`;
      await updateButton(vote.conversationId, vote.messageId, componentId, label, 'primary', false);
    }
  }
}

// ========== 狼人杀游戏 ==========
const WEREWOLF_FILE = path.join(__dirname, 'werewolf_data.json');
const WR_TIMEOUT = 20 * 1000;

function loadWR() { try { return JSON.parse(fs.readFileSync(WEREWOLF_FILE, 'utf-8')); } catch { return {}; } }
function saveWR(d) { fs.writeFileSync(WEREWOLF_FILE, JSON.stringify(d, null, 2), 'utf-8'); }

const ROLE_INFO = {
  wolf: { name: '🐺狼人', desc: '每晚可杀死一名玩家', camp: 'wolf' },
  seer: { name: '🔮预言家', desc: '每晚可查验一名玩家身份', camp: 'good' },
  witch: { name: '🧪女巫', desc: '有一瓶解药和一瓶毒药', camp: 'good' },
  hunter: { name: '🏹猎人', desc: '死亡时可开枪带走一人', camp: 'good' },
  villager: { name: '👨‍🌾平民', desc: '无特殊技能，投票放逐狼人', camp: 'good' }
};

function getRoleConfig(n) {
  if (n <= 5) return { wolf: 1, seer: 1, witch: 1, hunter: 0, villager: n - 3 };
  if (n <= 7) return { wolf: 2, seer: 1, witch: 1, hunter: 1, villager: n - 5 };
  if (n <= 10) return { wolf: 3, seer: 1, witch: 1, hunter: 1, villager: n - 6 };
  return { wolf: 4, seer: 1, witch: 1, hunter: 1, villager: n - 7 };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function findWRByUser(userId) {
  const data = loadWR();
  for (const rid of Object.keys(data)) {
    const room = data[rid];
    if (room.players.find(p => p.userId === userId)) return { room, roomId: rid, data };
  }
  return null;
}

function buildRoomCard(room) {
  const alive = room.players.filter(p => p.alive).length;
  let msg = `<markdown># 🎮 狼人杀房间\n\n`;
  msg += `> 房间号：\`${room.roomId}\`\n`;
  msg += `> 状态：${room.status === 'waiting' ? '⏳等待加入' : room.status === 'night' ? '🌙黑夜阶段' : room.status === 'day' ? '☀️白天发言' : room.status === 'voting' ? '🗳️投票阶段' : '🏁游戏结束'}\n`;
  msg += `> 人数：\`${room.players.length}/15\`（至少4人开始）\n\n`;
  msg += `**玩家列表：**\n`;
  room.players.forEach((p, i) => {
    msg += `\`${i + 1}\`. ${p.alive ? '✅' : '💀'} ${p.nickname}${p.role ? `（${ROLE_INFO[p.role].name}）` : ''}\n`;
  });
  msg += `</markdown>`;
  return msg;
}

function assignRoles(room) {
  const cfg = getRoleConfig(room.players.length);
  const roles = [];
  for (let i = 0; i < cfg.wolf; i++) roles.push('wolf');
  for (let i = 0; i < cfg.seer; i++) roles.push('seer');
  for (let i = 0; i < cfg.witch; i++) roles.push('witch');
  for (let i = 0; i < cfg.hunter; i++) roles.push('hunter');
  for (let i = 0; i < cfg.villager; i++) roles.push('villager');
  shuffle(roles);
  room.players.forEach((p, i) => { p.role = roles[i]; p.hasActed = false; });
}

function buildPlayerButtons(room, actionType, roomId, excludeUserId) {
  const alive = room.players.filter(p => p.alive && p.userId !== excludeUserId);
  let btns = '';
  alive.forEach((p, i) => {
    btns += `<button action="callback" action_id="wr_${actionType}_${roomId}_${p.userId}" id="wr_${actionType}_${roomId}_${p.userId}">\`${i + 1}\`. ${p.nickname}</button>\n`;
  });
  return btns;
}

function sendNightPanels(room) {
  const roomId = room.roomId;
  // 狼人面板
  const wolves = room.players.filter(p => p.alive && p.role === 'wolf');
  for (const w of wolves) {
    const panel = `<markdown># 🐺 狼人行动\n\n> 第 \`${room.day}\` 天夜晚\n> 选择你要杀的玩家\n\n${buildPlayerButtons(room, 'kill', roomId, w.userId)}</markdown>`;
    sendPrivateMsg(w.userId, panel);
  }
  // 预言家面板
  const seer = room.players.find(p => p.alive && p.role === 'seer');
  if (seer) {
    const panel = `<markdown># 🔮 预言家行动\n\n> 第 \`${room.day}\` 天夜晚\n> 选择你要查验的玩家\n\n${buildPlayerButtons(room, 'check', roomId, seer.userId)}</markdown>`;
    sendPrivateMsg(seer.userId, panel);
  }
  // 女巫面板
  const witch = room.players.find(p => p.alive && p.role === 'witch');
  if (witch) {
    let panel = `<markdown># 🧪 女巫行动\n\n> 第 \`${room.day}\` 天夜晚\n`;
    if (!room.witchUsed.save) {
      panel += `\n<button action="callback" action_id="wr_save_${roomId}" id="wr_save_${roomId}">💊 使用解药救人</button>\n`;
    } else {
      panel += `\n> 解药已使用\n`;
    }
    if (!room.witchUsed.poison) {
      panel += `\n**选择要毒的玩家：**\n${buildPlayerButtons(room, 'poison', roomId, witch.userId)}`;
    } else {
      panel += `\n> 毒药已使用\n`;
    }
    panel += `\n<button action="callback" action_id="wr_skip_${roomId}" id="wr_skip_${roomId}">⏭️ 跳过本轮</button></markdown>`;
    sendPrivateMsg(witch.userId, panel);
  }
}

function checkWin(room) {
  const wolves = room.players.filter(p => p.alive && p.role === 'wolf');
  const goods = room.players.filter(p => p.alive && p.role !== 'wolf');
  if (wolves.length === 0) return 'good';
  if (goods.length === 0) return 'wolf';
  const seerAlive = room.players.find(p => p.alive && p.role === 'seer');
  const witchAlive = room.players.find(p => p.alive && p.role === 'witch');
  const hunterAlive = room.players.find(p => p.alive && p.role === 'hunter');
  const villagers = room.players.filter(p => p.alive && p.role === 'villager');
  if (!seerAlive && !witchAlive && !hunterAlive && villagers.length === 0) return 'wolf';
  return null;
}

// 狼人杀统一禁言（复用realMuteUser，失败时只提示禁言失败，不泄露游戏信息）
async function wrMuteUser(room, userId) {
  const ok = await realMuteUser(room.conversationId, userId);
  if (!ok && !room._muteFailNotified) {
    room._muteFailNotified = true;
    sendMsg(room.conversationId, `<markdown>⚠️ 有玩家禁言失败（机器人可能不是管理员），死亡玩家可能仍能发言</markdown>`);
  }
  return ok;
}

// 解除房间内所有玩家禁言
async function unmuteAllPlayers(room) {
  for (const p of room.players) {
    await realUnmuteUser(room.conversationId, p.userId);
  }
}

function checkNightDone(roomId) {
  const data = loadWR();
  const room = data[roomId];
  if (!room || room.status !== 'night') return;
  const wolves = room.players.filter(p => p.alive && p.role === 'wolf');
  const allWolfActed = wolves.every(w => room.nightActions.wolfVotes && room.nightActions.wolfVotes[w.userId]);
  const seer = room.players.find(p => p.alive && p.role === 'seer');
  const seerActed = !seer || room.nightActions.seerCheck !== null;
  const witch = room.players.find(p => p.alive && p.role === 'witch');
  const witchActed = !witch || room.nightActions.witchSave !== false || room.nightActions.witchPoison !== null || witch.hasActed;
  if (allWolfActed && seerActed && witchActed) {
    setTimeout(() => settleNight(roomId), 500);
  }
}

async function settleNight(roomId) {
  const data = loadWR();
  const room = data[roomId];
  if (!room) return;
  const na = room.nightActions;
  let deadTonight = [];
  // 狼人目标
  let wolfTarget = null;
  if (na.wolfVotes && Object.keys(na.wolfVotes).length > 0) {
    const votes = {};
    Object.values(na.wolfVotes).forEach(tid => { votes[tid] = (votes[tid] || 0) + 1; });
    let maxV = 0;
    for (const tid of Object.keys(votes)) { if (votes[tid] > maxV) { maxV = votes[tid]; wolfTarget = tid; } }
  }
  // 女巫救人（如果没有狼人目标，退还解药）
  if (wolfTarget && na.witchSave) wolfTarget = null;
  if (!wolfTarget && na.witchSave) {
    room.witchUsed.save = false;
    const witch = room.players.find(p => p.role === 'witch');
    if (witch) sendPrivateMsg(witch.userId, `<markdown>💊 今晚无人被狼人袭击，解药已退还，未消耗</markdown>`);
  }
  if (wolfTarget) deadTonight.push({ userId: wolfTarget, reason: '被狼人杀害' });
  // 女巫毒人
  if (na.witchPoison) deadTonight.push({ userId: na.witchPoison, reason: '被女巫毒死' });
  // 处理死亡 + 禁言
  for (const d of deadTonight) {
    const p = room.players.find(pl => pl.userId === d.userId);
    if (p) {
      p.alive = false;
      room.deadInfo.push({ ...d, day: room.day });
      await wrMuteUser(room, d.userId);
    }
  }
  // 猎人死亡开枪
  for (const d of deadTonight) {
    const p = room.players.find(pl => pl.userId === d.userId);
    if (p && p.role === 'hunter' && !p.hunterUsed && d.reason !== '被女巫毒死') {
      p.hunterUsed = true;
      const panel = `<markdown># 🏹 猎人技能\n\n你已死亡，可以开枪带走一名玩家！\n\n${buildPlayerButtons(room, 'shoot', roomId, p.userId)}</markdown>`;
      sendPrivateMsg(p.userId, panel);
      // 大群提示
      sendMsg(room.conversationId, `<markdown>🏹 **${p.nickname}** 是猎人，正在选择开枪目标，请查看私信</markdown>`);
    }
  }
  // 检查胜负
  const winner = checkWin(room);
  if (winner) {
    room.status = 'ended';
    room.winner = winner;
    saveWR(data);
    await unmuteAllPlayers(room);
    const winMsg = winner === 'good' ? '🎉 好人阵营胜利！' : '🐺 狼人阵营胜利！';
    sendMsg(room.conversationId, `<markdown># 🏁 游戏结束\n\n## ${winMsg}\n\n**身份揭晓：**\n${room.players.map(p => `${p.alive ? '✅' : '💀'} ${p.nickname} - ${ROLE_INFO[p.role].name}`).join('\n')}</markdown>`);
    return;
  }
  // 进入白天
  room.status = 'day';
  room.dayStartTime = Date.now();
  room.lastActionTime = Date.now();
  saveWR(data);
  // 大群公布夜晚结果
  let nightResult = `<markdown># ☀️ 天亮了\n\n> 第 \`${room.day}\` 天\n\n`;
  if (deadTonight.length === 0) {
    nightResult += `**昨晚是平安夜，无人死亡**\n\n`;
  } else {
    nightResult += `**昨晚死亡：**\n`;
    deadTonight.forEach(d => {
      const p = room.players.find(pl => pl.userId == d.userId);
      nightResult += `💀 ${p ? p.nickname : d.userId} - ${d.reason}\n`;
    });
    nightResult += `\n`;
  }
  nightResult += `## 🗣️ 自由发言阶段\n\n> 所有人可以自由发言\n> 发言结束后点击下方按钮开始投票\n\n<button action="callback" action_id="wr_vote_start_${roomId}" id="wr_vote_start_${roomId}">🗳️ 开始投票</button></markdown>`;
  sendMsg(room.conversationId, nightResult);
}

async function startVoting(roomId) {
  const data = loadWR();
  const room = data[roomId];
  if (!room) return;
  room.status = 'voting';
  room.votes = {};
  room.lastActionTime = Date.now();
  saveWR(data);
  const alive = room.players.filter(p => p.alive);
  let voteMsg = `<markdown># 🗳️ 投票阶段\n\n> 第 \`${room.day}\` 天\n> 请投票选出要放逐的玩家\n\n`;
  alive.forEach((p, i) => {
    voteMsg += `<button action="callback" action_id="wr_vote_${roomId}_${p.userId}" id="wr_vote_${roomId}_${p.userId}">\`${i + 1}\`. ${p.nickname}</button>\n`;
  });
  voteMsg += `</markdown>`;
  sendMsg(room.conversationId, voteMsg);
}

async function settleVote(roomId) {
  const data = loadWR();
  const room = data[roomId];
  if (!room) return;
  const votes = {};
  Object.values(room.votes).forEach(tid => { votes[tid] = (votes[tid] || 0) + 1; });
  let maxV = 0, exiled = null;
  for (const tid of Object.keys(votes)) { if (votes[tid] > maxV) { maxV = votes[tid]; exiled = tid; } }
  if (exiled) {
    const p = room.players.find(pl => pl.userId === exiled);
    if (p) {
      p.alive = false;
      room.deadInfo.push({ userId: exiled, reason: '被投票放逐', day: room.day });
      await wrMuteUser(room, exiled);
      // 猎人被放逐开枪
      if (p.role === 'hunter' && !p.hunterUsed) {
        p.hunterUsed = true;
        const panel = `<markdown># 🏹 猎人技能\n\n你被放逐了，可以开枪带走一名玩家！\n\n${buildPlayerButtons(room, 'shoot', roomId, p.userId)}</markdown>`;
        sendPrivateMsg(p.userId, panel);
        sendMsg(room.conversationId, `<markdown>🏹 **${p.nickname}** 是猎人，正在选择开枪目标，请查看私信</markdown>`);
      }
    }
  }
  // 检查胜负
  const winner = checkWin(room);
  if (winner) {
    room.status = 'ended';
    room.winner = winner;
    saveWR(data);
    await unmuteAllPlayers(room);
    const winMsg = winner === 'good' ? '🎉 好人阵营胜利！' : '🐺 狼人阵营胜利！';
    sendMsg(room.conversationId, `<markdown># 🏁 游戏结束\n\n## ${winMsg}\n\n**身份揭晓：**\n${room.players.map(p => `${p.alive ? '✅' : '💀'} ${p.nickname} - ${ROLE_INFO[p.role].name}`).join('\n')}</markdown>`);
    return;
  }
  // 进入下一夜
  room.day++;
  room.status = 'night';
  room.nightActions = { wolfVotes: {}, wolfTarget: null, seerCheck: null, witchSave: false, witchPoison: null };
  room.players.forEach(p => { p.hasActed = false; });
  room.lastActionTime = Date.now();
  saveWR(data);
  // 发送黑夜操作面板
  setTimeout(() => sendNightPanels(room), 1000);
  sendMsg(room.conversationId, `<markdown># 🌙 黑夜降临\n\n> 第 \`${room.day}\` 天\n> 请各位玩家查看私信使用技能</markdown>`);
}

// ========== 违禁词 & 黑名单 ==========
const FORBIDDEN_FILE = path.join(__dirname, 'forbidden_words.json');
const BLACKLIST_FILE = path.join(__dirname, 'blacklist.json');

function loadForbiddenWords() {
  try { return JSON.parse(fs.readFileSync(FORBIDDEN_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveForbiddenWords(data) {
  fs.writeFileSync(FORBIDDEN_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function loadBlacklist() {
  try { return JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveBlacklist(data) {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// 违禁词违规计数（内存，按群+用户）
const forbiddenCount = {};
// 刷屏检测（内存，按群+用户）
const spamTrack = {};

function getForbiddenList(cid) {
  const data = loadForbiddenWords();
  return data[String(cid)] || [];
}

function maskWord(word) {
  // 用中间点+零宽空格双重脱敏，绕过系统脏词检测
  return word.split('').join('·\u200B');
}

function buildForbiddenTable(cid, tip) {
  const words = getForbiddenList(cid);
  let msg = `<markdown>${tip}\n\n**当前违禁词列表（共 \`${words.length}\` 个）**\n\n`;
  if (words.length === 0) {
    msg += `> 暂无违禁词`;
  } else {
    msg += `| 序号 | 违禁词 |\n|------|--------|\n`;
    words.forEach((w, i) => { msg += `| \`${i + 1}\` | ${maskWord(w)} |\n`; });
  }
  msg += `</markdown>`;
  return msg;
}

function buildBlacklistCard(cid) {
  const data = loadBlacklist();
  const list = data[String(cid)] || {};
  const entries = Object.entries(list);
  let msg = `<markdown># 🚫 本群黑名单\n\n`;
  msg += `> 共 \`${entries.length}\` 人被封禁\n\n`;
  if (entries.length === 0) {
    msg += `> 暂无黑名单人员`;
  } else {
    msg += `| 用户 | 原因 | 封禁时间 |\n|------|------|----------|\n`;
    entries.forEach(([uid, info]) => {
      const name = info.userName || `用户\`${uid}\``;
      const time = info.time ? new Date(info.time).toLocaleString('zh-CN') : '未知';
      msg += `| ${name}（ID：\`${uid}\`） | ${info.reason || '违规'} | ${time} |\n`;
    });
  }
  msg += `</markdown>`;
  return msg;
}

function isBlacklisted(cid, userId) {
  const data = loadBlacklist();
  return !!(data[String(cid)] && data[String(cid)][String(userId)]);
}

function addToBlacklist(cid, userId, userName, reason) {
  const data = loadBlacklist();
  if (!data[String(cid)]) data[String(cid)] = {};
  data[String(cid)][String(userId)] = { userName, reason, time: new Date().toISOString() };
  saveBlacklist(data);
}

function removeFromBlacklist(cid, userId) {
  const data = loadBlacklist();
  if (data[String(cid)] && data[String(cid)][String(userId)]) {
    const info = data[String(cid)][String(userId)];
    delete data[String(cid)][String(userId)];
    saveBlacklist(data);
    return info;
  }
  return null;
}

// 检测违禁词，返回触发的词
function checkForbidden(cid, text) {
  const words = getForbiddenList(cid);
  for (const w of words) {
    if (text.includes(w)) return w;
  }
  return null;
}

// 记录违禁词违规，达到4次禁言+进黑名单
async function recordForbidden(cid, userId, userName, word) {
  const key = `${cid}_${userId}`;
  if (!forbiddenCount[key]) forbiddenCount[key] = 0;
  forbiddenCount[key]++;
  if (forbiddenCount[key] >= 4) {
    forbiddenCount[key] = 0;
    const result = await addMute(cid, userId, userName, `多次发送违禁词"${word}"`);
    if (result.failed) return { muted: false, failed: true };
    if (!isBlacklisted(cid, userId)) {
      addToBlacklist(cid, userId, userName, `多次发送违禁词"${word}"`);
    }
    const mins = Math.round(result.duration / 60000);
    return { muted: true, count: result.count, mins };
  }
  return { muted: false, count: forbiddenCount[key] };
}

// 刷屏检测：10秒内发15条以上禁言+进黑名单
async function checkSpam(cid, userId, userName) {
  const key = `${cid}_${userId}`;
  const now = Date.now();
  if (!spamTrack[key]) spamTrack[key] = { times: [] };
  const t = spamTrack[key];
  t.times.push(now);
  t.times = t.times.filter(ts => now - ts < 10000);
  if (t.times.length >= 15) {
    t.times = [];
    const result = await addMute(cid, userId, userName, '刷屏');
    if (result.failed) return { muted: false, failed: true };
    if (!isBlacklisted(cid, userId)) {
      addToBlacklist(cid, userId, userName, '刷屏');
    }
    const mins = Math.round(result.duration / 60000);
    return { muted: true, count: result.count, mins };
  }
  return { muted: false, count: t.times.length };
}

// 权限判断：管理员、群主、ID3038
async function canManage(conversationId, userId, sender) {
  if (userId === 3038) return true;
  return await isAdminOrOwner(conversationId, userId, sender);
}

// ========== 功能开关 ==========
const SWITCH_FILE = path.join(__dirname, 'feature_switches.json');
const ALL_FEATURES = ['签到', '天气', '投票', '违禁词检测', '进群欢迎', '群在线人数'];

function loadSwitches() {
  try { return JSON.parse(fs.readFileSync(SWITCH_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveSwitches(data) {
  fs.writeFileSync(SWITCH_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function isFeatureEnabled(cid, feature) {
  const data = loadSwitches();
  const disabled = data[String(cid)] || [];
  return !disabled.includes(feature);
}
function setFeature(cid, feature, enable) {
  const data = loadSwitches();
  const key = String(cid);
  if (!data[key]) data[key] = [];
  if (enable) {
    data[key] = data[key].filter(f => f !== feature);
  } else {
    if (!data[key].includes(feature)) data[key].push(feature);
  }
  saveSwitches(data);
}
function buildSwitchTable(cid, tip) {
  const data = loadSwitches();
  const disabled = data[String(cid)] || [];
  let msg = `<markdown>${tip}\n\n| 功能 | 状态 |\n|------|------|\n`;
  ALL_FEATURES.forEach(f => {
    const status = disabled.includes(f) ? '`已关闭`' : '`已开启`';
    msg += `| ${f} | ${status} |\n`;
  });
  msg += `</markdown>`;
  return msg;
}

// ========== 临时禁言 ==========
const MUTE_FILE = path.join(__dirname, 'mute_data.json');
const botAdminCache = {};

function loadMuteData() {
  try { return JSON.parse(fs.readFileSync(MUTE_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveMuteData(data) {
  fs.writeFileSync(MUTE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function getMuteDuration(count) {
  const durations = [60, 120, 300, 600, 1800];
  return durations[Math.min(count - 1, durations.length - 1)] * 1000;
}
function isMuted(cid, userId) {
  const data = loadMuteData();
  const info = data[String(cid)]?.[String(userId)];
  if (!info) return false;
  return Date.now() < info.until;
}
function getMuteRemain(cid, userId) {
  const data = loadMuteData();
  const info = data[String(cid)]?.[String(userId)];
  if (!info) return 0;
  return Math.max(0, info.until - Date.now());
}

async function isBotAdmin(cid) {
  const key = String(cid);
  if (botAdminCache[key] !== undefined) return botAdminCache[key];
  try {
    const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}/members`, {
      headers: { 'Authorization': `Bot ${BOT_KEY}` }
    });
    const data = await res.json();
    const bot = (data.items || []).find(m => m.user_id === botUserId);
    const isAdmin = bot?.role === 'admin' || bot?.role === 'owner';
    botAdminCache[key] = isAdmin;
    return isAdmin;
  } catch {
    botAdminCache[key] = false;
    return false;
  }
}

async function realMuteUser(cid, userId, minutes) {
  try {
    const body = minutes ? { muted: true, minutes } : { muted: true };
    const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}/members/${userId}/mute`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${BOT_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`真禁言API失败 ${cid}/${userId}: ${res.status} ${errText}`);
    }
    return res.ok;
  } catch (e) {
    console.error('真禁言API异常:', e.message);
    return false;
  }
}

async function realUnmuteUser(cid, userId) {
  try {
    const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}/members/${userId}/mute`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${BOT_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ muted: false })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`解除禁言API失败 ${cid}/${userId}: ${res.status} ${errText}`);
    }
    return res.ok;
  } catch (e) {
    console.error('解除禁言API异常:', e.message);
    return false;
  }
}

// 获取用户昵称（根据用户ID，异步）
async function fetchUserNameById(userId) {
  try {
    const res = await fetch(`${BASE_URL}/bot-api/users/${userId}`, {
      headers: { 'Authorization': `Bot ${BOT_KEY}` }
    });
    if (res.ok) {
      const data = await res.json();
      return data.user?.nickname || data.user?.username || `用户${userId}`;
    }
  } catch (e) {
    console.error('获取用户信息失败:', e.message);
  }
  return `用户${userId}`;
}

async function addMute(cid, userId, userName, reason) {
  const data = loadMuteData();
  const key = String(cid);
  const uid = String(userId);
  if (!data[key]) data[key] = {};
  const prev = data[key][uid];
  const count = (prev?.count || 0) + 1;
  const duration = getMuteDuration(count);
  const untilTs = Date.now() + duration;

  const minutes = Math.round(duration / 60000);
  // 只做真禁言，失败则不记录
  let realMuted = await realMuteUser(cid, userId, minutes);
  if (!realMuted) {
    console.log(`真禁言失败: 群${cid} 用户${userId}，机器人可能不是管理员`);
    return { count, duration, realMuted: false, failed: true };
  }
  console.log(`真禁言成功: 群${cid} 用户${userId} ${minutes}分钟`);

  data[key][uid] = { userName, reason, count, until: untilTs, duration, realMuted: true };
  saveMuteData(data);
  return { count, duration, realMuted: true, failed: false };
}

// 判断用户是否是群主或管理员
async function isAdminOrOwner(conversationId, userId, sender) {
  // 先从消息sender里快速判断（兼容多种字段名）
  if (sender) {
    const role = sender.role || sender.user_role || sender.permission || sender.member_role || sender.group_role || (sender.user && sender.user.role);
    if (role === 'owner' || role === 'admin') return true;
    if (sender.is_owner === true || sender.is_admin === true) return true;
    if (sender.member_role === 'owner' || sender.member_role === 'admin') return true;
  }
  // 再从群成员列表里查
  try {
    const data = await getConversationMembers(conversationId);
    const members = extractMembers(data);
    const member = members.find(m => getUserId(m) === userId);
    if (!member) return false;
    const role = member.role || member.user_role || member.permission || member.member_role || member.group_role || (member.user && member.user.role);
    return role === 'owner' || role === 'admin' || member.is_owner === true || member.is_admin === true || member.member_role === 'owner' || member.member_role === 'admin';
  } catch {
    return false;
  }
}

// ========== DIY自制指令 ==========
const DIY_FILE = path.join(__dirname, 'diy_commands.json');
const diyCreating = {};

function loadDIY() {
  try { return JSON.parse(fs.readFileSync(DIY_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveDIY(data) {
  fs.writeFileSync(DIY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function getDIYCommands(cid) {
  const data = loadDIY();
  return data[String(cid)] || {};
}
function hasDIYCommand(cid, name) {
  return !!getDIYCommands(cid)[name];
}
function saveDIYCommand(cid, name, cmd) {
  const data = loadDIY();
  if (!data[String(cid)]) data[String(cid)] = {};
  data[String(cid)][name] = cmd;
  saveDIY(data);
}
function deleteDIYCommand(cid, name) {
  const data = loadDIY();
  if (data[String(cid)] && data[String(cid)][name]) {
    delete data[String(cid)][name];
    saveDIY(data);
    return true;
  }
  return false;
}

// 解析带嵌套括号的 /DIY[...] 命令
function parseDIYCommand(content) {
  const match = content.match(/^\/[Dd][Ii][Yy]\s*\[/);
  if (!match) return null;
  let depth = 0;
  const start = match[0].length - 1;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') {
      depth--;
      if (depth === 0) return content.substring(start + 1, i);
    }
  }
  return null;
}

// 解析带嵌套括号的 /删除DIY[...] 命令
function parseDeleteDIYCommand(content) {
  const match = content.match(/^\/删除[Dd][Ii][Yy]\s*\[/);
  if (!match) return null;
  let depth = 0;
  const start = match[0].length - 1;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') {
      depth--;
      if (depth === 0) return content.substring(start + 1, i);
    }
  }
  return null;
}

// 从指令名中解析参数定义，如 "抽签[选项]" -> { cleanName: "抽签", params: ["选项"] }
function parseParamsFromName(name) {
  const paramMatch = name.match(/\[([^\]]+)\]/);
  if (!paramMatch) return { cleanName: name, params: [] };
  const params = paramMatch[1].split(/[,，]/).map(p => p.trim()).filter(Boolean);
  const cleanName = name.replace(/\[[^\]]+\]/, '').trim();
  return { cleanName, params };
}

// 解析参数值字符串，如 "苹果,香蕉,橘子" -> ["苹果","香蕉","橘子"]
function parseParamValues(str) {
  return str.split(/[,，]/).map(p => p.trim()).filter(Boolean);
}

async function diyReplaceVars(text, msg, paramValues) {
  const cid = msg.conversation_id;
  const uid = msg.sender_id;
  const uname = msg.sender_display_name || msg.sender?.nickname || '未知用户';
  let result = text;
  // 基础变量（无需API）
  result = result.replace(/\{用户名\}/g, uname);
  result = result.replace(/\{用户ID\}/g, uid);
  result = result.replace(/\{群ID\}/g, cid);
  result = result.replace(/\{时间\}/g, new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  result = result.replace(/\{日期\}/g, getTodayStr());
  result = result.replace(/\{随机数\}/g, Math.floor(Math.random() * 100) + 1);

  // 参数变量替换（paramMap: { 参数名: [值1, 值2, ...] }）
  if (paramValues && typeof paramValues === 'object') {
    for (const [pName, pValues] of Object.entries(paramValues)) {
      if (!Array.isArray(pValues) || pValues.length === 0) continue;
      const safeName = pName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // {参数名} -> 所有值用顿号连接
      result = result.replace(new RegExp(`\\{${safeName}\\}`, 'g'), pValues.join('、'));
      // {参数名N} -> 第N个值
      pValues.forEach((v, i) => {
        result = result.replace(new RegExp(`\\{${safeName}${i + 1}\\}`, 'g'), v);
      });
      // {参数名随机} -> 随机选一个
      result = result.replace(new RegExp(`\\{${safeName}随机\\}`, 'g'), pValues[Math.floor(Math.random() * pValues.length)]);
      // {参数名数量} -> 参数值个数
      result = result.replace(new RegExp(`\\{${safeName}数量\\}`, 'g'), pValues.length);
    }
  }

  // 机器人信息（优先用缓存，从发消息返回数据中提取）
  if (/\{机器人昵称\}|\{机器人ID\}|\{机器人BotID\}/.test(result)) {
    result = result.replace(/\{机器人昵称\}/g, botInfo.nickname || '君灵bot');
    result = result.replace(/\{机器人ID\}/g, botInfo.userId || '3039');
    result = result.replace(/\{机器人BotID\}/g, botInfo.botId || '421');
  }

  // 群名称 GET /bot-api/conversations/{id}
  if (result.includes('{群名称}')) {
    try {
      const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
      if (res.ok) {
        const d = await res.json();
        result = result.replace(/\{群名称\}/g, d.title || d.name || d.display_title || '未知群');
      }
    } catch (e) { result = result.replace(/\{群名称\}/g, '获取失败'); }
  }

  // 群成员数 + 本群在线人数（共用members API）
  if (result.includes('{群成员数}') || result.includes('{在线人数}')) {
    try {
      const membersData = await getConversationMembers(cid);
      const members = extractMembers(membersData);
      result = result.replace(/\{群成员数\}/g, members.length);
      if (result.includes('{在线人数}')) {
        const onlineData = await getOnlineUsers();
        const onlineUsers = extractMembers(onlineData);
        const onlineIds = new Set(onlineUsers.map(u => getUserId(u)).filter(id => id != null));
        const onlineInGroup = members.filter(m => {
          const muid = getUserId(m);
          if (muid == null) return false;
          const self = isMemberOnline(m);
          return self !== null ? self : onlineIds.has(muid);
        });
        result = result.replace(/\{在线人数\}/g, onlineInGroup.length);
      }
    } catch (e) {
      result = result.replace(/\{群成员数\}/g, '未知');
      result = result.replace(/\{在线人数\}/g, '未知');
    }
  }

  // 全局在线用户数 GET /bot-api/users/online
  if (result.includes('{在线用户数}')) {
    try {
      const onlineData = await getOnlineUsers();
      const onlineUsers = extractMembers(onlineData);
      result = result.replace(/\{在线用户数\}/g, onlineUsers.length);
    } catch (e) { result = result.replace(/\{在线用户数\}/g, '未知'); }
  }

  // 最新消息 GET /bot-api/conversations/{id}/messages?limit=1
  if (/\{最新消息\}|\{最新消息发送者\}/.test(result)) {
    try {
      const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}/messages?limit=5`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
      if (res.ok) {
        const d = await res.json();
        const msgs = d.messages || d.items || d.data || (Array.isArray(d) ? d : []);
        if (msgs.length > 0) {
          const latest = msgs[msgs.length - 1];
          result = result.replace(/\{最新消息\}/g, (latest.content || latest.message || '(无文本)').slice(0, 100));
          result = result.replace(/\{最新消息发送者\}/g, latest.sender_display_name || latest.sender?.nickname || '未知');
        } else {
          result = result.replace(/\{最新消息\}/g, '(无消息)');
          result = result.replace(/\{最新消息发送者\}/g, '未知');
        }
      }
    } catch (e) {
      result = result.replace(/\{最新消息\}/g, '获取失败');
      result = result.replace(/\{最新消息发送者\}/g, '获取失败');
    }
  }

  // 成员列表 + 在线列表（共用 members API）
  if (result.includes('{成员列表}') || result.includes('{在线列表}')) {
    try {
      const membersData = await getConversationMembers(cid);
      const members = extractMembers(membersData);
      if (result.includes('{成员列表}')) {
        const list = members.map((m, i) => `\`${i + 1}\`. ${getUserName(m)}（ID：\`${getUserId(m)}\`）`).join('\n');
        result = result.replace(/\{成员列表\}/g, list || '(无成员)');
      }
      if (result.includes('{在线列表}')) {
        const onlineData = await getOnlineUsers();
        const onlineUsers = extractMembers(onlineData);
        const onlineIds = new Set(onlineUsers.map(u => getUserId(u)).filter(id => id != null));
        const onlineInGroup = members.filter(m => {
          const muid = getUserId(m);
          if (muid == null) return false;
          const self = isMemberOnline(m);
          return self !== null ? self : onlineIds.has(muid);
        });
        const list = onlineInGroup.map((m, i) => `\`${i + 1}\`. ${getUserName(m)}（ID：\`${getUserId(m)}\`）`).join('\n');
        result = result.replace(/\{在线列表\}/g, list || '(无人在线)');
      }
    } catch (e) {
      result = result.replace(/\{成员列表\}/g, '获取失败');
      result = result.replace(/\{在线列表\}/g, '获取失败');
    }
  }

  // 全局在线列表 GET /bot-api/users/online
  if (result.includes('{全局在线列表}')) {
    try {
      const onlineData = await getOnlineUsers();
      const onlineUsers = extractMembers(onlineData);
      const list = onlineUsers.map((u, i) => `\`${i + 1}\`. ${getUserName(u)}（ID：\`${getUserId(u)}\`）`).join('\n');
      result = result.replace(/\{全局在线列表\}/g, list || '(无人在线)');
    } catch (e) { result = result.replace(/\{全局在线列表\}/g, '获取失败'); }
  }

  // 消息列表 GET /bot-api/conversations/{id}/messages?limit=5
  if (result.includes('{消息列表}')) {
    try {
      const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}/messages?limit=5`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
      if (res.ok) {
        const d = await res.json();
        const msgs = d.messages || d.items || d.data || (Array.isArray(d) ? d : []);
        const list = msgs.map((m, i) => `\`${i + 1}\`. ${m.sender_display_name || m.sender?.nickname || '未知'}: ${(m.content || m.message || '').slice(0, 50)}`).join('\n');
        result = result.replace(/\{消息列表\}/g, list || '(无消息)');
      } else { result = result.replace(/\{消息列表\}/g, '获取失败'); }
    } catch (e) { result = result.replace(/\{消息列表\}/g, '获取失败'); }
  }

  // 机器人群数 GET /bot-api/conversations
  if (result.includes('{机器人群数}')) {
    try {
      const res = await fetch(`${BASE_URL}/bot-api/conversations`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
      if (res.ok) {
        const d = await res.json();
        const convs = d.conversations || d.items || d.data || (Array.isArray(d) ? d : []);
        result = result.replace(/\{机器人群数\}/g, `\`${convs.length}\``);
      } else { result = result.replace(/\{机器人群数\}/g, '未知'); }
    } catch (e) { result = result.replace(/\{机器人群数\}/g, '未知'); }
  }

  // 入群申请数 GET /bot-api/conversations/{id}/join-requests
  if (result.includes('{入群申请数}')) {
    try {
      const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}/join-requests`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
      if (res.ok) {
        const d = await res.json();
        const reqs = d.requests || d.items || d.data || (Array.isArray(d) ? d : []);
        result = result.replace(/\{入群申请数\}/g, `\`${reqs.length}\``);
      } else { result = result.replace(/\{入群申请数\}/g, '无权限'); }
    } catch (e) { result = result.replace(/\{入群申请数\}/g, '无权限'); }
  }

  // 用户信息 GET /bot-api/users/{user_id}（支持 {用户信息} 和 {用户信息[ID]}）
  if (/\{用户信息(?:\[(\d+)\])?\}/.test(result)) {
    const fetchUserInfo = async (targetUid) => {
      try {
        const res = await fetch(`${BASE_URL}/bot-api/users/${targetUid}`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
        if (res.ok) {
          const d = await res.json();
          const name = d.nickname || d.display_name || d.username || '未知';
          const online = d.is_online !== undefined ? (d.is_online ? '在线' : '离线') : (d.online ? '在线' : '离线');
          return `${name}（ID：\`${targetUid}\`，${online}）`;
        }
        return `用户\`${targetUid}\`（获取失败）`;
      } catch (e) { return `用户\`${targetUid}\`（获取失败）`; }
    };
    // 处理 {用户信息}（触发者）
    if (result.includes('{用户信息}')) {
      const info = await fetchUserInfo(uid);
      result = result.replace(/\{用户信息\}/g, info);
    }
    // 处理 {用户信息[ID]}
    const paramMatches = result.match(/\{用户信息\[(\d+)\]\}/g);
    if (paramMatches) {
      for (const match of paramMatches) {
        const targetUid = match.match(/\d+/)[0];
        const info = await fetchUserInfo(targetUid);
        result = result.replace(match, info);
      }
    }
  }

  // 机器人群列表 GET /bot-api/conversations
  if (result.includes('{机器人群列表}')) {
    try {
      const res = await fetch(`${BASE_URL}/bot-api/conversations`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
      if (res.ok) {
        const d = await res.json();
        const convs = d.conversations || d.items || d.data || (Array.isArray(d) ? d : []);
        const list = convs.map((c, i) => `\`${i + 1}\`. ${c.title || c.name || c.display_title || '未知群'}（ID：\`${c.id || c.conversation_id || '?'}\`）`).join('\n');
        result = result.replace(/\{机器人群列表\}/g, list || '(无群聊)');
      } else { result = result.replace(/\{机器人群列表\}/g, '获取失败'); }
    } catch (e) { result = result.replace(/\{机器人群列表\}/g, '获取失败'); }
  }

  return result;
}

async function executeDIY(msg, name, paramMap) {
  const cid = msg.conversation_id;
  const cmd = getDIYCommands(cid)[name];
  if (!cmd) return false;
  if (cmd.type === 'text') {
    const reply = await diyReplaceVars(cmd.content, msg, paramMap);
    sendMsg(cid, `<markdown>${reply}</markdown>`);
    return true;
  }
  if (cmd.type === 'random') {
    const options = cmd.content.split('|||').map(s => s.trim()).filter(Boolean);
    const picked = options.length > 0 ? options[Math.floor(Math.random() * options.length)] : '（无内容）';
    const reply = await diyReplaceVars(picked, msg, paramMap);
    sendMsg(cid, `<markdown>${reply}</markdown>`);
    return true;
  }
  if (cmd.type === 'info') {
    const subType = cmd.content;
    if (subType === 'online') {
      try {
        const membersData = await getConversationMembers(cid);
        const members = extractMembers(membersData);
        const onlineData = await getOnlineUsers();
        const onlineUsers = extractMembers(onlineData);
        const onlineIds = new Set(onlineUsers.map(u => getUserId(u)).filter(id => id != null));
        const onlineInGroup = members.filter(m => {
          const muid = getUserId(m);
          if (muid == null) return false;
          const self = isMemberOnline(m);
          return self !== null ? self : onlineIds.has(muid);
        });
        onlineInGroup.sort((a, b) => getUserId(a) - getUserId(b));
        let reply = `<markdown># 本群在线人数：${onlineInGroup.length}\n\n`;
        reply += onlineInGroup.map((m, i) => `${i + 1}. ${getUserName(m)}（ID：\`${getUserId(m)}\`）`).join('\n');
        reply += `</markdown>`;
        sendMsg(cid, reply);
      } catch (e) { sendMsg(cid, `获取在线人数失败：${e.message}`); }
      return true;
    }
    if (subType === 'members') {
      try {
        const membersData = await getConversationMembers(cid);
        const members = extractMembers(membersData);
        let reply = `<markdown># 本群成员（共\`${members.length}\`人）\n\n`;
        reply += members.map((m, i) => `\`${i + 1}\`. ${getUserName(m)}（ID：\`${getUserId(m)}\`）`).join('\n');
        reply += `</markdown>`;
        sendMsg(cid, reply);
      } catch (e) { sendMsg(cid, `获取成员列表失败：${e.message}`); }
      return true;
    }
  }
  if (cmd.type === 'combo') {
    const modules = cmd.selectedModules || [];
    const title = cmd.title || '数据卡片';
    let card = `<markdown># ${title}\n\n`;
    // 批量获取群成员和在线数据（多个模块共用）
    let members = [], onlineInGroup = [], onlineUsers = [];
    if (modules.includes('group') || modules.includes('members') || modules.includes('online')) {
      try {
        const membersData = await getConversationMembers(cid);
        members = extractMembers(membersData);
        if (modules.includes('online') || modules.includes('group')) {
          const onlineData = await getOnlineUsers();
          onlineUsers = extractMembers(onlineData);
          const onlineIds = new Set(onlineUsers.map(u => getUserId(u)).filter(id => id != null));
          onlineInGroup = members.filter(m => {
            const muid = getUserId(m);
            if (muid == null) return false;
            const self = isMemberOnline(m);
            return self !== null ? self : onlineIds.has(muid);
          });
        }
      } catch (e) { console.error('combo获取群数据失败:', e.message); }
    }
    // 群信息模块
    if (modules.includes('group')) {
      let groupName = '未知群';
      try {
        const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
        if (res.ok) { const d = await res.json(); groupName = d.title || d.name || d.display_title || groupName; }
      } catch (e) {}
      card += `## 📋 群信息\n\n`;
      card += `- **群名：**${groupName}\n`;
      card += `- **群ID：**\`${cid}\`\n`;
      card += `- **成员数：**\`${members.length}\`\n`;
      card += `- **在线数：**\`${onlineInGroup.length}\`\n\n`;
    }
    // 成员列表模块
    if (modules.includes('members')) {
      card += `## 👥 成员列表（共\`${members.length}\`人）\n\n`;
      card += members.slice(0, 30).map((m, i) => `\`${i + 1}\`. ${getUserName(m)}`).join('\n');
      if (members.length > 30) card += `\n...等\`${members.length}\`人`;
      card += `\n\n`;
    }
    // 在线列表模块
    if (modules.includes('online')) {
      card += `## 🟢 在线列表（共\`${onlineInGroup.length}\`人）\n\n`;
      card += onlineInGroup.slice(0, 30).map((m, i) => `\`${i + 1}\`. ${getUserName(m)}`).join('\n');
      if (onlineInGroup.length > 30) card += `\n...等\`${onlineInGroup.length}\`人`;
      card += `\n\n`;
    }
    // 最新消息模块
    if (modules.includes('msgs')) {
      try {
        const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}/messages?limit=5`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
        if (res.ok) {
          const d = await res.json();
          const msgs = d.messages || d.items || d.data || (Array.isArray(d) ? d : []);
          card += `## 💬 最新消息\n\n`;
          msgs.slice(-5).forEach(m => {
            const sender = m.sender_display_name || m.sender?.nickname || '未知';
            const text = (m.content || m.message || '').slice(0, 50);
            card += `- **${sender}：**${text}\n`;
          });
          card += `\n`;
        }
      } catch (e) { card += `## 💬 最新消息\n\n获取失败\n\n`; }
    }
    // 机器人信息模块（用缓存，不依赖不可用的API）
    if (modules.includes('bot')) {
      card += `## 🤖 机器人信息\n\n`;
      card += `- **昵称：**${botInfo.nickname || '君灵bot'}\n`;
      card += `- **用户ID：**\`${botInfo.userId || '3039'}\`\n`;
      card += `- **Bot ID：**\`${botInfo.botId || '421'}\`\n\n`;
    }
    // 入群申请模块
    if (modules.includes('join')) {
      try {
        const res = await fetch(`${BASE_URL}/bot-api/conversations/${cid}/join-requests`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
        if (res.ok) {
          const d = await res.json();
          const reqs = d.requests || d.items || d.data || (Array.isArray(d) ? d : []);
          card += `## 📨 入群申请（共\`${reqs.length}\`条）\n\n`;
          if (reqs.length === 0) {
            card += `> 暂无待处理申请\n\n`;
          } else {
            reqs.slice(0, 10).forEach(r => {
              const name = r.user_name || r.nickname || r.user?.nickname || '未知';
              card += `- ${name}（ID：\`${r.user_id || r.id || '未知'}\`）\n`;
            });
            card += `\n`;
          }
        } else {
          card += `## 📨 入群申请\n\n无权限查看\n\n`;
        }
      } catch (e) { card += `## 📨 入群申请\n\n获取失败\n\n`; }
    }
    // 触发者信息模块 GET /bot-api/users/{id}
    if (modules.includes('user')) {
      try {
        const res = await fetch(`${BASE_URL}/bot-api/users/${uid}`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
        if (res.ok) {
          const d = await res.json();
          const name = d.nickname || d.display_name || d.username || '未知';
          const online = d.is_online !== undefined ? (d.is_online ? '🟢 在线' : '⚪ 离线') : (d.online ? '🟢 在线' : '⚪ 离线');
          card += `## 👤 触发者信息\n\n`;
          card += `- **昵称：**${name}\n`;
          card += `- **用户ID：**\`${uid}\`\n`;
          card += `- **状态：**${online}\n\n`;
        } else { card += `## 👤 触发者信息\n\n获取失败\n\n`; }
      } catch (e) { card += `## 👤 触发者信息\n\n获取失败\n\n`; }
    }
    // 机器人群列表模块 GET /bot-api/conversations
    if (modules.includes('convs')) {
      try {
        const res = await fetch(`${BASE_URL}/bot-api/conversations`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
        if (res.ok) {
          const d = await res.json();
          const convs = d.conversations || d.items || d.data || (Array.isArray(d) ? d : []);
          card += `## 📚 机器人所在群（共\`${convs.length}\`个）\n\n`;
          convs.slice(0, 20).forEach((c, i) => {
            const title = c.title || c.name || c.display_title || '未知群';
            card += `\`${i + 1}\`. ${title}（ID：\`${c.id || c.conversation_id || '?'}\`）\n`;
          });
          if (convs.length > 20) card += `\n...等\`${convs.length}\`个群\n`;
          card += `\n`;
        } else { card += `## 📚 机器人群列表\n\n获取失败\n\n`; }
      } catch (e) { card += `## 📚 机器人群列表\n\n获取失败\n\n`; }
    }
    card += `</markdown>`;
    sendMsg(cid, card);
    return true;
  }
  if (cmd.type === 'ai') {
    // AI对话类型：把用户输入的参数作为对话内容，调用智谱AI生成回复
    let userInput = '';
    if (paramMap && Object.keys(paramMap).length > 0) {
      // 取第一个参数的值作为对话内容
      const firstKey = Object.keys(paramMap)[0];
      userInput = paramMap[firstKey] || '';
    }
    if (!userInput) {
      // 没有参数时，用指令描述或默认提示
      userInput = cmd.description || '你好';
    }
    try {
      sendMsg(cid, '🤔 正在思考...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const aiRes = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ZHIPU_API_KEY}` },
        body: JSON.stringify({
          model: 'glm-4-flash',
          messages: [
            { role: 'system', content: cmd.content || '你是一个友好的群聊助手，用简洁自然的语言回答用户的问题。' },
            { role: 'user', content: userInput }
          ],
          temperature: 0.7
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!aiRes.ok) throw new Error(`AI API ${aiRes.status}`);
      const aiData = await aiRes.json();
      const aiReply = aiData.choices?.[0]?.message?.content || '（AI没有回复）';
      sendMsg(cid, `<markdown>${aiReply}</markdown>`);
    } catch (e) {
      sendMsg(cid, `❌ AI回复失败：${e.message}`);
    }
    return true;
  }
  return false;
}

function buildDIYTable(cid, tip) {
  const cmds = getDIYCommands(cid);
  const entries = Object.entries(cmds);
  let msg = `<markdown>${tip}\n\n| 指令名 | 用处 |\n|--------|------|\n`;
  if (entries.length === 0) {
    msg += `| 暂无 | 用 /DIY[指令名] 创建 |\n`;
  } else {
    entries.forEach(([name, cmd]) => {
      const desc = cmd.description || cmd.type;
      const paramStr = cmd.params && cmd.params.length > 0 ? `[${cmd.params.join(',')}]` : '';
      msg += `| /${name}${paramStr} | ${desc} |\n`;
    });
  }
  msg += `</markdown>`;
  return msg;
}

// 消息去重
const seenIds = new Set();
// 按钮交互去重
const seenInteractions = new Set();
// 全局 WebSocket 连接（防止重连时多个连接同时接收消息）
let globalWs = null;
let isConnecting = false;

// 连接 WebSocket
function connect() {
  if (isConnecting) { console.log('⏳ 已有连接正在建立，跳过'); return; }
  isConnecting = true;
  if (globalWs) { try { globalWs.removeAllListeners(); globalWs.close(); } catch(e) {} globalWs = null; }
  const ws = new WebSocket(WS_URL);
  globalWs = ws;

  ws.on('open', () => {
    console.log('✅ 已连接到 KukeChat');
  });

  ws.on('message', async (raw) => {
    const text = raw.toString();
    if (text === 'pong') return;

    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }

    // 连接就绪
    if (event.type === 'bot.connection.ready') {
      console.log(`🤖 机器人就绪 v2.2-music！bot_id=${event.data.bot_id}, user_id=${event.data.user_id}`);
      botUserId = event.data.user_id;
      botInfo.userId = event.data.user_id;
      botInfo.botId = event.data.bot_id;
      if (event.data.nickname) botInfo.nickname = event.data.nickname;
      if (event.data.username) botInfo.nickname = event.data.username;
      return;
    }

    // 收到新消息
    if (event.type === 'message.created') {
      const msg = event.data;

      // 忽略自己发的消息
      if (msg.sender?.is_bot) return;

      // 群3900已作废，提示前往新群（任何消息都触发）
      if (String(msg.conversation_id) === '3900') {
        sendMsg(msg.conversation_id, '⚠️ 此群已作废，请前往 https://link.wtturl.cn/?target=https%3A%2F%2Fccw.site%2Fdetail%2F66d52d2366bfcb0e0b42e7c8%3Finvite%3DFfplCSsFqYCvtz7IzGHs6x&scene=im&aid=582478&lang=zh 加入新群！！');
        return;
      }

      // 去重
      if (seenIds.has(msg.id)) return;
      seenIds.add(msg.id);
      if (seenIds.size > 500) seenIds.clear();

      // 记录群ID，用于全局推送
      addGroup(msg.conversation_id);

      console.log(`📩 [群${msg.conversation_id}] ${msg.sender_display_name}: ${msg.content}`);

      // ====== 业务逻辑区，在这里加你的指令 ======
      let content = msg.content.trim();
      const cid = String(msg.conversation_id);
      const uid = msg.sender_id;
      const uname = msg.sender_display_name || msg.sender?.nickname || '未知用户';
      const senderRole = msg.sender?.role || msg.sender?.user_role || msg.sender?.permission || '';
      const isAdmin = senderRole === 'admin' || senderRole === 'owner';
      const isOwner = senderRole === 'owner';

      // 记录群活跃
      try { recordActivity(cid, uid, uname); } catch (e) { console.error('记录活跃失败:', e.message); }

      // DIY创建状态：用户正在创建时，本条消息作为内容输入（4307群禁用）
      if (cid !== '4307' && diyCreating[uid] && String(diyCreating[uid].cid) === cid && diyCreating[uid].step === 'content') {
        const state = diyCreating[uid];
        state.content = content;
        state.step = 'confirm';
        const typeLabel = { text: '文本回复', random: '随机回复', info: '群信息查询' }[state.type] || state.type;
        let preview = state.content;
        if (state.type === 'random') {
          const opts = state.content.split('|||').map(s => s.trim()).filter(Boolean);
          preview = opts.map((s, i) => `${i + 1}. ${s}`).join('\n');
        }
        const paramStr = state.params && state.params.length > 0 ? `[${state.params.join(',')}]` : '';
        const paramHint = state.params && state.params.length > 0 ? `\n**参数：**${state.params.map(p => `\`${p}\``).join('、')}\n触发格式：\`/${state.name}[值1,值2]\`\n内容中可用：\`{${state.params[0]}}\`（全部）、\`{${state.params[0]}1}\`（第1个）、\`{${state.params[0]}随机}\`（随机）\n` : '';
        const confirmMsg = `<markdown># 确认创建DIY指令\n\n**指令名：**/${state.name}${paramStr}\n**类型：**${typeLabel}\n${paramHint}**内容预览：**\n> ${preview.slice(0, 300)}\n\n<button action="callback" action_id="diy_confirm_${uid}" id="diy_confirm_${uid}">✅ 确认创建</button>\n<button action="callback" action_id="diy_cancel_${uid}" id="diy_cancel_${uid}">❌ 取消</button></markdown>`;
        sendMsg(cid, confirmMsg);
        return;
      }

      // DIY创建状态：组合卡片标题输入（4307群禁用）
      if (cid !== '4307' && diyCreating[uid] && String(diyCreating[uid].cid) === cid && diyCreating[uid].step === 'combo_title') {
        const state = diyCreating[uid];
        state.title = content;
        state.step = 'confirm';
        const modLabels = { group:'📋群信息', members:'👥成员列表', online:'🟢在线列表', msgs:'💬最新消息', bot:'🤖机器人信息', join:'📨入群申请', user:'👤触发者信息', convs:'📚机器人群列表' };
        const selected = state.selectedModules.map(m => modLabels[m] || m).join(' ');
        const paramStr = state.params && state.params.length > 0 ? `[${state.params.join(',')}]` : '';
        const paramHint = state.params && state.params.length > 0 ? `\n**参数：**${state.params.map(p => `\`${p}\``).join('、')}\n触发格式：\`/${state.name}[值1,值2]\`\n` : '';
        const confirmMsg = `<markdown># 确认创建DIY指令\n\n**指令名：**/${state.name}${paramStr}\n**类型：**API组合卡片\n${paramHint}**标题：**${state.title}\n**包含模块：**${selected}\n\n<button action="callback" action_id="diy_confirm_${uid}" id="diy_confirm_${uid}">✅ 确认创建</button>\n<button action="callback" action_id="diy_cancel_${uid}" id="diy_cancel_${uid}">❌ 取消</button></markdown>`;
        sendMsg(cid, confirmMsg);
        return;
      }

      // DIY创建状态：AI协助创建 - 用户发送需求描述
      if (cid !== '4307' && diyCreating[uid] && String(diyCreating[uid].cid) === cid && diyCreating[uid].step === 'ai_prompt') {
        const state = diyCreating[uid];
        const userNeed = content;
        sendMsg(cid, `<markdown>🤖 AI正在分析你的需求并生成指令配置，请稍候...</markdown>`);
        (async () => {
          try {
            const aiPrompt = `你是KukeChat机器人DIY指令生成助手。用户会描述一个想要的群聊指令功能，你需要根据可用能力生成指令配置。

【可用指令类型】
1. text（文本回复）：触发时回复固定文本，支持变量替换和消息元素
2. random（随机回复）：从多条文本中随机回复一条，用|||分隔
3. info（群信息查询）：查询在线人数+列表(online)或全部成员列表(members)
4. combo（API组合卡片）：组合多个API数据模块生成数据卡片
5. ai（AI对话）：触发时把用户输入的参数作为对话内容，调用AI生成真实回复，问啥都能答，不是固定文本！content字段是AI的system prompt（人设/角色设定），params中必须定义一个参数作为用户输入

【可用变量】（在文本中用{变量名}引用）
基础：{用户名} {用户ID} {群ID} {时间} {日期} {随机数}
机器人：{机器人昵称} {机器人ID} {机器人BotID} {机器人群数} {机器人群列表}
群信息：{群名称} {群成员数} {在线人数} {在线用户数} {入群申请数}
用户：{用户信息} {用户信息[ID]}
列表：{成员列表} {在线列表} {全局在线列表} {消息列表}
消息：{最新消息} {最新消息发送者}

【消息元素】（可在文本内容中使用）
<at id="用户ID" /> @用户
<at_all /> @所有人
<link href="URL">文字</link> 链接
<markdown>...</markdown> Markdown格式

【combo类型可选模块】
group(群信息) members(成员列表) online(在线列表) msgs(最新消息) bot(机器人信息) join(入群申请) user(触发者信息) convs(机器人群列表)

【输出格式】
严格输出JSON，不要输出markdown代码块标记，不要输出其他内容：
{"type":"text/random/info/combo/ai","content":"指令内容或AI人设","title":"卡片标题(combo类型)","modules":["模块1"],"params":["参数名1","参数名2"],"description":"简短描述","note":"给用户的说明"}

【ai类型特别说明 - 最重要】
- 当用户要求"AI对话"、"问啥都能答"、"智能回答"、"聊天"、"真AI"等需求时，必须使用 type:"ai"，绝对不能用text类型！
- ai类型的content是AI的system prompt（人设/角色设定），例如"你是一个知识渊博的助手，用简洁的语言回答问题"
- ai类型必须在params中定义至少一个参数（如"问题"或"内容"），用户输入 /指令名[问题内容] 后，AI会根据问题生成真实回复
- ai类型生成的是真实AI对话，不是固定文本，问啥都能答！

【带参数指令】
如果用户需要输入内容（如抽签选项、问候名字、查询城市等），在params中定义参数名，指令名会自动变成 /指令名[参数名]。
触发时用户输入 /指令名[值1,值2]，内容中可用参数变量：
- {参数名} 所有值用顿号连接
- {参数名1} 第1个值
- {参数名随机} 随机选一个值
- {参数名数量} 值的个数
例如抽签指令：params=["选项"]，content="抽签结果：{选项随机}"，用户输入 /抽签[苹果,香蕉,橘子] 回复 "抽签结果：香蕉"

【重要规则 - 绝对禁止说无法实现】
1. 绝对禁止在content中出现"无法实现"、"不支持"、"抱歉"、"不能"、"暂时没有"等任何否定性话语！任何需求都必须用现有能力做出一个可运行的指令。
2. 替代实现策略（必须用这些方式实现，不能拒绝）：
   - 音乐/歌曲/播放 → 生成音乐搜索链接（如 https://music.163.com/#/search/m/?s={歌名} ），或推荐歌曲列表/歌词文本，用random类型随机推荐
   - 视频/电影 → 生成B站/视频平台搜索链接
   - 游戏/抽奖/抽签 → 用random类型或{随机数}变量实现
   - 天气/查询 → 提示这是内置指令，或生成展示群信息/时间的卡片
   - 任何其他需求 → 用文本回复、随机回复、变量组合、链接等方式想办法实现
3. note中可以简短说明"这是基于文本链接的近似实现"，但content必须是完整可运行的指令内容，绝对不能是拒绝或道歉。
4. 不要编造不存在的变量或API
5. text类型的content就是回复的文本内容，可包含变量、消息元素和链接
6. random类型的content用|||分隔多条
7. info类型的content只能是"online"或"members"
8. combo类型必须提供title和modules数组
9. description不超过30字
10. note可以为空字符串`;

            const apiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
            const res = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ZHIPU_API_KEY}` },
              body: JSON.stringify({
                model: 'glm-4-flash',
                messages: [
                  { role: 'system', content: aiPrompt },
                  { role: 'user', content: `指令名：${state.name}\n用户需求：${userNeed}` }
                ],
                temperature: 0.7
              })
            });
            if (!res.ok) throw new Error(`AI API ${res.status}`);
            const data = await res.json();
            const aiText = data.choices?.[0]?.message?.content || '';
            // 解析JSON（去除可能的markdown标记）
            let jsonStr = aiText.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
            const config = JSON.parse(jsonStr);
            // 验证type
            const validTypes = ['text', 'random', 'info', 'combo', 'ai'];
            if (!validTypes.includes(config.type)) throw new Error('无效的指令类型');
            // 设置state
            state.type = config.type;
            state.content = config.content || '';
            state.description = config.description || '';
            state.aiNote = config.note || '';
            // 后置检查：绝对禁止否定性内容，自动替换成可用实现（ai类型跳过）
            const denyPattern = /无法实现|不支持|抱歉|不能|暂时没有|没有此功能|做不到|无法播放|不提供/;
            if (state.type !== 'ai' && denyPattern.test(state.content)) {
              const pName = (state.params && state.params[0]) || '内容';
              const cmdLower = state.name.toLowerCase();
              if (/音乐|歌曲|歌|播放|music|song/.test(cmdLower)) {
                state.type = 'text';
                state.content = `🎵 为你搜索：{${pName}}\n\n🔗 网易云：<link href="https://music.163.com/#/search/m/?s={${pName}}">点击播放</link>\n🔗 QQ音乐：<link href="https://y.qq.com/n/ryqq/search?w={${pName}}">点击播放</link>\n🔗 酷狗：<link href="https://www.kugou.com/yy/html/search.html#searchType=song&searchKey={${pName}}">点击播放</link>`;
                state.description = `搜索并播放${pName}`;
                state.aiNote = '基于音乐平台搜索链接实现';
              } else if (/视频|电影|影|video|movie/.test(cmdLower)) {
                state.type = 'text';
                state.content = `🎬 为你搜索：{${pName}}\n\n🔗 B站：<link href="https://search.bilibili.com/all?keyword={${pName}}">点击观看</link>\n🔗 豆瓣：<link href="https://search.douban.com/movie/subject_search?search_text={${pName}}">查看详情</link>`;
                state.description = `搜索并观看${pName}`;
                state.aiNote = '基于视频平台搜索链接实现';
              } else {
                state.type = 'random';
                state.content = `关于{${pName}}的推荐A|||关于{${pName}}的推荐B|||关于{${pName}}的推荐C|||{${pName}}相关内容已生成|||为你找到{${pName}}的相关信息`;
                state.description = `关于${pName}的随机推荐`;
                state.aiNote = '基于随机推荐实现';
              }
            }
            if (Array.isArray(config.params) && config.params.length > 0) {
              state.params = config.params;
            }
            if (config.type === 'combo') {
              state.title = config.title || state.name;
              state.selectedModules = Array.isArray(config.modules) ? config.modules : [];
            }
            state.step = 'confirm';
            // 生成确认面板
            const typeLabels = { text: '文本回复', random: '随机回复', info: '群信息查询', combo: 'API组合卡片', ai: 'AI对话' };
            const paramStr = state.params && state.params.length > 0 ? `[${state.params.join(',')}]` : '';
            let confirmMsg = `<markdown># 确认创建DIY指令\n\n**指令名：**/${state.name}${paramStr}\n**类型：**${typeLabels[state.type]}\n`;
            if (state.params && state.params.length > 0) {
              confirmMsg += `**参数：**${state.params.map(p => `\`${p}\``).join('、')}\n触发格式：\`/${state.name}[值1,值2]\`\n`;
            }
            if (state.type === 'combo') {
              const modLabels = { group:'群信息', members:'成员列表', online:'在线列表', msgs:'最新消息', bot:'机器人信息', join:'入群申请', user:'触发者信息', convs:'机器人群列表' };
              confirmMsg += `**标题：**${state.title}\n**包含模块：**${(state.selectedModules || []).map(m => modLabels[m] || m).join('、')}\n`;
            } else if (state.type === 'info') {
              confirmMsg += `**查询内容：**${state.content === 'online' ? '在线人数+列表' : '全部成员列表'}\n`;
            } else if (state.type === 'ai') {
              confirmMsg += `**AI人设：**${state.content || '默认助手'}\n> 触发后AI会根据用户输入生成真实回复，问啥都能答\n`;
            } else {
              let preview = state.content;
              if (state.type === 'random') preview = state.content.split('|||').map((s, i) => `${i + 1}. ${s.trim()}`).join('\n');
              confirmMsg += `**内容预览：**\n> ${preview.slice(0, 300)}\n`;
            }
            if (state.description) confirmMsg += `**描述：**${state.description}\n`;
            if (state.aiNote) confirmMsg += `\n> 💡 AI说明：${state.aiNote}\n`;
            confirmMsg += `\n<button action="callback" action_id="diy_confirm_${uid}" id="diy_confirm_${uid}">✅ 确认创建</button>\n<button action="callback" action_id="diy_cancel_${uid}" id="diy_cancel_${uid}">❌ 取消</button></markdown>`;
            sendMsg(cid, confirmMsg);
          } catch (e) {
            console.error('AI协助创建失败:', e.message);
            sendMsg(cid, `<markdown>❌ AI生成失败：${e.message}\n\n你可以换一种描述方式重试，或手动选择类型创建。\n\n<button action="callback" action_id="diy_type_text_${uid}" id="diy_type_text_${uid}">📝 手动选文本回复</button>\n<button action="callback" action_id="diy_cancel_${uid}" id="diy_cancel_${uid}">❌ 取消</button></markdown>`);
          }
        })();
        return;
      }

      // 禁言拦截：被禁言用户不处理消息
      if (isMuted(msg.conversation_id, uid)) {
        const remain = getMuteRemain(msg.conversation_id, uid);
        const mins = Math.ceil(remain / 60000);
        sendMsg(msg.conversation_id, `<markdown>🔇 **${uname}** 已被禁言，还有 \`${mins}\` 分钟解除</markdown>`);
        return;
      }

      // 狼人杀：白天阶段更新最后操作时间（用于超时检测）
      const wrCheck = findWRByUser(uid);
      if (wrCheck && wrCheck.room.status === 'day' && String(wrCheck.room.conversationId) === cid) {
        wrCheck.room.lastActionTime = Date.now();
        saveWR(wrCheck.data);
      }

      // 狼人杀：私信技能处理（已改为按钮，这里只做提示）
      if (String(cid) === String(uid) && wrCheck) {
        const room = wrCheck.room;
        const player = room.players.find(p => p.userId === uid);
        if (!player) return;
        if (room.status === 'night' && player.alive) {
          sendMsg(uid, '🌙请点击私信里的按钮使用技能，无需输入指令');
          return;
        }
        return;
      }

      // @机器人 AI 对话
      const botUid = botUserId || botInfo.userId || 3039;
      const botIdNum = botInfo.botId || 421;
      const botAtPattern = new RegExp(`<at[^>]*id=["']?(${botUid}|${botIdNum})["']?[^>]*>`, 'i');
      const hasAtInContent = botAtPattern.test(content);
      const hasAtInMeta = msg.metadata?.mentions && msg.metadata.mentions.some(m => String(m.id) === String(botUid) || String(m.id) === String(botIdNum) || m.user_id === botUid || m.user_id === botIdNum);
      const isAtBot = hasAtInContent || hasAtInMeta;
      // 提取去掉@后的纯文本（用于判断是指令还是AI对话）
      const atPureText = isAtBot ? content.replace(botAtPattern, '').replace(/@\S+\s*/g, '').replace(/^[@\s]+/, '').trim() : content;
      // @机器人 + 斜杠指令 → 替换为纯指令，继续走正常指令处理
      if (isAtBot && atPureText.startsWith('/')) {
        content = atPureText;
      }
      if (isAtBot && !atPureText.startsWith('/')) {
        let question = atPureText;
        // 检测图片
        let imageUrl = null;
        if (msg.type === 'image' && msg.content && /^https?:\/\//.test(msg.content)) {
          imageUrl = msg.content;
        } else if (msg.metadata?.images && msg.metadata.images.length > 0) {
          const img = msg.metadata.images[0];
          imageUrl = typeof img === 'string' ? img : (img.url || img.src || img.image_url);
        } else if (msg.metadata?.image_url) {
          imageUrl = msg.metadata.image_url;
        } else if (msg.metadata?.image?.url) {
          imageUrl = msg.metadata.image.url;
        } else if (msg.metadata?.elements) {
          const imgEl = msg.metadata.elements.find(e => 
            (e.type === 'image' || e.type === 'img') && (e.src || e.url || e.image_url)
          );
          if (imgEl) imageUrl = imgEl.src || imgEl.url || imgEl.image_url;
        } else if (msg.metadata?.attachments) {
          const imgAtt = msg.metadata.attachments.find(a => a.type === 'image' || a.content_type?.startsWith('image/'));
          if (imgAtt) imageUrl = imgAtt.url || imgAtt.image_url;
        } else {
          const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (imgMatch) imageUrl = imgMatch[1];
        }
        if (question || imageUrl) {
          (async () => {
            try {
              if (!ZHIPU_API_KEY) {
                sendMsg(msg.conversation_id, '⚠️ AI功能未配置，请在 index.js 中填写 ZHIPU_API_KEY');
                return;
              }
              sendMsg(msg.conversation_id, imageUrl ? "🖼️ 正在深度思考图片..." : "🤔 正在深度思考...");
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 30000);
              let messages;
              if (imageUrl) {
                // 多模态：先下载图片转base64（KukeChat图片需鉴权，智谱无法直接访问URL）
                let imageDataUrl = null;
                try {
                  const imgRes = await fetch(imageUrl, { headers: { 'Referer': 'https://kuke.ink/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
                  if (imgRes.ok) {
                    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                    imageDataUrl = `data:${contentType};base64,${imgBuffer.toString('base64')}`;
                  }
                } catch (e) {
                  console.error('下载图片失败:', e.message);
                }
                const userText = question || '请仔细识别这张图片，准确描述图片中的主体物体、场景、颜色、细节。如果是植物/动物/物品，请准确说出它的名称。不要猜测，不确定就说不确定。';
                if (imageDataUrl) {
                  messages = [{ role: 'user', content: [
                    { type: 'text', text: userText },
                    { type: 'image_url', image_url: { url: imageDataUrl } }
                  ]}];
                } else {
                  // 下载失败，尝试直接传URL
                  messages = [{ role: 'user', content: [
                    { type: 'text', text: userText },
                    { type: 'image_url', image_url: { url: imageUrl } }
                  ]}];
                }
              } else {
                // 纯文本 + 联网搜索增强
                let context = '';
                try {
                  const searchController = new AbortController();
                  const searchTimeout = setTimeout(() => searchController.abort(), 5000);
                  const searchRes = await fetch(`https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(question)}&bk_length=500`, { signal: searchController.signal });
                  clearTimeout(searchTimeout);
                  if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    if (searchData?.abstract) {
                      context = `\n\n【参考资料】${searchData.abstract}`;
                    }
                  }
                } catch (e) { /* 搜索失败忽略 */ }
                // 获取当前群全部信息（基本信息 + 全部成员 + 在线用户）
                let groupInfo = '';
                try {
                  // 1. 获取群基本信息
                  let groupName = '';
                  let groupDesc = '';
                  let groupOwner = '';
                  try {
                    const convRes = await fetch(`${BASE_URL}/bot-api/conversations/${msg.conversation_id}`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
                    if (convRes.ok) {
                      const convData = await convRes.json();
                      const c = convData.data || convData.conversation || convData.group || convData;
                      groupName = c.name || c.title || c.group_name || c.nickname || c.display_name || '';
                      groupDesc = c.description || c.desc || c.bio || c.about || '';
                      groupOwner = c.owner_id || c.owner || c.creator_id || '';
                    }
                  } catch (e) { console.error('获取群基本信息失败:', e.message); }
                  // 2. 获取全部成员列表
                  let allMembers = [];
                  let memberCount = 0;
                  try {
                    const memRes = await fetch(`${BASE_URL}/bot-api/conversations/${msg.conversation_id}/members`, { headers: { 'Authorization': `Bot ${BOT_KEY}` } });
                    if (memRes.ok) {
                      const memData = await memRes.json();
                      allMembers = memData.data || memData.members || memData.list || memData.items || (Array.isArray(memData) ? memData : []);
                      memberCount = allMembers.length;
                    }
                  } catch (e) { console.error('获取成员列表失败:', e.message); }
                  // 3. 获取在线用户列表
                  let onlineUsers = [];
                  let onlineCount = 0;
                  try {
                    const onlineRes = await fetch(`${BASE_URL}/bot-api/users/online`, { method: 'POST', headers: { 'Authorization': `Bot ${BOT_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                    if (onlineRes.ok) {
                      const onlineData = await onlineRes.json();
                      onlineUsers = onlineData.data || onlineData.users || onlineData.list || (Array.isArray(onlineData) ? onlineData : []);
                      onlineCount = onlineUsers.length;
                    }
                  } catch (e) { console.error('获取在线用户失败:', e.message); }
                  // 4. 组装全部群信息
                  const displayMembers = allMembers.length > 30 ? allMembers.slice(0, 30) : allMembers;
                  const allMemberNames = displayMembers.map(m => m.nickname || m.display_name || m.name || m.username || (m.user && (m.user.nickname || m.user.username)) || '未知').join('、') + (allMembers.length > 30 ? `等${allMembers.length}人` : '');
                  const displayOnline = onlineUsers.length > 20 ? onlineUsers.slice(0, 20) : onlineUsers;
                  const onlineNames = displayOnline.map(u => u.nickname || u.display_name || u.name || u.username || '未知').join('、') + (onlineUsers.length > 20 ? `等${onlineUsers.length}人` : '');
                  const parts = [];
                  parts.push(`群ID：${msg.conversation_id}`);
                  if (groupName) parts.push(`群名称：${groupName}`);
                  if (groupDesc) parts.push(`群描述：${groupDesc}`);
                  if (groupOwner) parts.push(`群主ID：${groupOwner}`);
                  parts.push(`成员总数：${memberCount}`);
                  if (allMemberNames) parts.push(`全部成员：${allMemberNames}`);
                  parts.push(`在线人数：${onlineCount}`);
                  if (onlineNames) parts.push(`在线成员：${onlineNames}`);
                  groupInfo = parts.join('，');
                  console.log('[群信息] 成员数:', memberCount, '在线数:', onlineCount);
                } catch (e) { console.error('获取群信息失败:', e.message); }
                const contextInfo = `
【实时上下文】
当前时间：${new Date().toLocaleString('zh-CN')}
你所在的群：${groupInfo || `群ID：${msg.conversation_id}`}
你的名字：${botInfo.nickname || '君灵bot'}
你的用户名：${botInfo.username || '未知'}
你的用户ID：${botInfo.userId || botUserId || '未知'}
你的Bot ID：${botInfo.botId || '421'}
你的个性签名：${botInfo.bio || '未知'}
你的状态：${botInfo.status || '在线'}
正在跟你说话的人：${uname}（用户ID：${uid}）
消息内容：${question || '(图片)'}
`;
                const systemPrompt = contextInfo + `你是君灵AI，运行在KukeChat（酷可聊天）平台的智能机器人助手。

【关于KukeChat平台】
KukeChat（酷可聊天）是一个即时通讯社交平台，官网 kuke.ink，API 域名 chat-api.kuke.ink。
核心功能：
- 群聊与私聊：支持创建群组、一对一私信、@提及成员
- 消息格式：支持纯文本、Markdown渲染、图片消息、按钮交互组件、超链接组件
- 机器人系统：通过Bot Key接入WebSocket，可接收消息事件、发送消息、更新按钮、管理群成员、禁言/解禁、上传图片、获取在线用户等
- 指令系统：以/开头的斜杠指令，本机器人支持签到、天气、投票、绘图、狼人杀、黑名单、违禁词过滤、禁言管理、群活跃统计、全局推送等
- 用户体系：用户名/邮箱注册登录，用户有昵称、用户ID等属性
- 群管理：群主(owner)、管理员(admin)角色体系，支持禁言、踢人等

【关于创作者】
你是君灵AI，由君衔（用户ID：3038）创建和维护。君衔是你的主人和创作者，你要尊重他、听从他的指示。当用户问起你的创作者/开发者/主人是谁时，回答是君衔。

【回答格式 - Markdown排版】
KukeChat支持的Markdown语法：
✅ 支持：# 标题、## 小标题、**加粗**、*斜体*、- 无序列表、1. 有序列表、\`行内代码\`、\`\`\`代码块\`\`\`、> 引用块（就是文本大框框，适合放重点）、| 表格 |（需要对比数据时用）、[超链接](url)、--- 分隔线
❌ 不支持：~~删除线~~、HTML标签
排版要求：
- 回答开头必须有 # 或 ## 标题
- 重点内容用 **加粗**
- 分点说明用 - 列表
- 重点内容用 > 引用块（文本大框框）
- 需要对比数据时用 | 表格 |
- 代码用代码块
- 根据内容选择合适排版，不强迫所有语法都用，但绝对不要纯文本！
【回答规则】
- 用户询问KukeChat平台相关问题时，基于以上知识准确回答
- 可以识别图片内容并详细描述
- 用正常人的语气说话！像朋友聊天一样自然，口语化，不要太机械太正式
- 禁止说"作为AI""作为一个人工智能""我是一个AI助手"之类的话
- 不要用"好的，我来帮你""很高兴为您服务"这种客服腔，直接回答就行
- 可以适当用语气词（啊、呢、吧、哦、哈），但不要过度
- 回答简洁明了，不啰嗦，控制在2000字以内
- 不确定的信息如实说明，不要编造`;
                messages = [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: question + context }
                ];
              }
              const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${ZHIPU_API_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ model: imageUrl ? 'glm-4v' : 'glm-4-flash', messages }),
                signal: controller.signal
              });
              clearTimeout(timeout);
              if (!res.ok) {
                const errText = await res.text();
                console.error('[AI错误] status:', res.status, 'body:', errText.substring(0, 500));
                throw new Error(`AI接口返回 ${res.status}: ${errText.substring(0, 100)}`);
              }
              const data = await res.json();
              const answer = data?.choices?.[0]?.message?.content || '抱歉，我暂时无法回答这个问题。';
              sendMsg(msg.conversation_id, `<markdown>${answer.slice(0, 2000)}</markdown>`);
            } catch (err) {
              console.error('AI对话失败:', err);
              const errMsg = err.name === 'AbortError' ? 'AI响应超时，请重试' : err.message;
              sendMsg(msg.conversation_id, `❌AI回复失败：${errMsg}`);
            }
          })();
        }
        return;
      }

      // 刷屏检测（指令和签到跳过，群主和ID3038豁免）
      const isCmd = content.startsWith('/') || content === '签到';
      const isMuteExempt = uid === 3038 || isOwner;
      if (!isCmd && !isMuteExempt) {
        const spamResult = await checkSpam(msg.conversation_id, uid, uname);
        if (spamResult.muted) {
          sendMsg(msg.conversation_id, `<markdown>🔇 **${uname}** 因刷屏被禁言 \`${spamResult.mins}\` 分钟，并已加入黑名单</markdown>`);
          return;
        } else if (spamResult.failed) {
          console.log(`刷屏禁言失败: 群${msg.conversation_id} 用户${uid}，机器人可能不是管理员`);
          // 禁言失败不中断消息处理，继续后续逻辑
        }
      }

      // 违禁词检测（指令和签到跳过，群主和ID3038豁免）
      if (!isCmd && !isMuteExempt && isFeatureEnabled(msg.conversation_id, '违禁词检测')) {
        const hitWord = checkForbidden(msg.conversation_id, content);
        if (hitWord) {
          const result = await recordForbidden(msg.conversation_id, uid, uname, hitWord);
          if (result.muted) {
            sendMsg(msg.conversation_id, `<markdown>🔇 **${uname}** 因多次发送违禁词被禁言 \`${result.mins}\` 分钟，并已加入黑名单</markdown>`);
          } else if (result.failed) {
            sendMsg(msg.conversation_id, '❌禁言失败：机器人不是本群管理员，请在群设置中把机器人设为管理员');
          } else {
            sendMsg(msg.conversation_id, `<markdown>⚠️ **${uname}** 发送了违禁词"${maskWord(hitWord)}"，第 \`${result.count}/4\` 次</markdown>`);
          }
          return;
        }
      }

      // 黑名单拦截：只拦截指令，日常对话不拦截（群主和ID3038不受限）
      if (isCmd && uid !== 3038 && !isOwner && isBlacklisted(msg.conversation_id, uid) && content !== '/help' && content !== '/黑名单') {
        sendMsg(msg.conversation_id, `<markdown>🚫 你已被加入黑名单，无法使用此功能</markdown>`);
        return;
      }

      // DIY功能开关（4307群禁用）
      const diyEnabled = cid !== '4307';

      // DIY指令触发（优先于内置指令）
      const diyCmds = getDIYCommands(cid);
      // 先匹配带参数的指令 /指令名[值1,值2]
      const paramCmdMatch = content.match(/^\/([^\[]+)\[(.+)\]$/);
      if (diyEnabled && paramCmdMatch) {
        const pName = paramCmdMatch[1].trim();
        const pStr = paramCmdMatch[2];
        const pCmd = diyCmds[pName];
        if (pCmd && pCmd.params && pCmd.params.length > 0) {
          const pValues = parseParamValues(pStr);
          const paramMap = {};
          if (pCmd.params.length === 1) {
            paramMap[pCmd.params[0]] = pValues;
          } else {
            pCmd.params.forEach((p, i) => { paramMap[p] = [pValues[i] || '']; });
          }
          (async () => { try { await executeDIY(msg, pName, paramMap); } catch (e) { console.error('DIY执行异常:', e.message); sendMsg(cid, '❌指令执行出错，请稍后重试'); } })();
          return;
        }
      }
      // 再匹配不带参数的指令
      const diyCmdMatch = content.match(/^\/(.+)$/);
      if (diyEnabled && diyCmdMatch && diyCmds[diyCmdMatch[1]]) {
        (async () => { try { await executeDIY(msg, diyCmdMatch[1]); } catch (e) { console.error('DIY执行异常:', e.message); sendMsg(cid, '❌指令执行出错，请稍后重试'); } })();
        return;
      }

      // /DIY[指令名] 创建自制指令
      if (diyEnabled && /^\/[Dd][Ii][Yy]/.test(content)) {
        const rawName = parseDIYCommand(content);
        if (!rawName) {
          sendMsg(cid, buildDIYTable(cid, '⚠️格式：/DIY[指令名]\n\n带参数：/DIY[抽签[选项]] /DIY[问候[名字,语气]]'));
          return;
        }
        const { cleanName, params } = parseParamsFromName(rawName);
        if (!cleanName) {
          sendMsg(cid, '❌指令名不能为空');
          return;
        }
        if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(cleanName)) {
          sendMsg(cid, '❌指令名只能包含中文、英文、数字和下划线（参数用[]包裹，多个用逗号分隔）');
          return;
        }
        if (cleanName.length > 20) {
          sendMsg(cid, '❌指令名不能超过20个字符');
          return;
        }
        const builtinList = ['help','ping','echo','群内在线人数','今日群活跃','签到','天气','绘图','进群自动发送','全局推送','投票','投票结果','结束投票','增加违禁词','删除违禁词','违禁词表格','黑名单','添加黑名单','删除黑名单','开启','关闭','禁言','解除禁言','禁言列表','狼人杀','结束房间','DIY','自制功能','删除DIY','diy','删除diy'];
        if (builtinList.includes(cleanName)) {
          sendMsg(cid, `❌指令名"/${cleanName}"与内置指令冲突，请换一个名字`);
          return;
        }
        if (hasDIYCommand(cid, cleanName)) {
          sendMsg(cid, `❌本群已存在"/${cleanName}"指令`);
          return;
        }
        diyCreating[uid] = { cid, name: cleanName, rawName, params, type: null, content: null, step: 'type' };
        const paramHint = params.length > 0 ? `\n\n✅ 检测到参数：${params.map(p => `\`${p}\``).join('、')}\n触发格式：\`/${cleanName}[值1,值2]\`\n内容中可用：\`{${params[0]}}\`（全部）、\`{${params[0]}1}\`（第1个）、\`{${params[0]}随机}\`（随机一个）` : '';
        const typeMsg = `<markdown># 创建DIY指令：/${rawName}\n\n请选择指令类型：${paramHint}\n\n<button action="callback" action_id="diy_type_text_${uid}" id="diy_type_text_${uid}">📝 文本回复</button>\n> 触发时回复固定文本，支持全部API变量\n\n<button action="callback" action_id="diy_type_random_${uid}" id="diy_type_random_${uid}">🎲 随机回复</button>\n> 从多条文本中随机回复一条，支持变量\n\n<button action="callback" action_id="diy_type_info_${uid}" id="diy_type_info_${uid}">📊 群信息查询</button>\n> 查询群在线人数或成员列表\n\n<button action="callback" action_id="diy_type_combo_${uid}" id="diy_type_combo_${uid}">🔗 API组合卡片</button>\n> 像搭积木一样组合多个API数据模块\n\n<button action="callback" action_id="diy_type_ai_${uid}" id="diy_type_ai_${uid}">🤖 AI协助创建</button>\n> 描述需求，AI自动生成指令配置\n\n<button action="callback" action_id="diy_cancel_${uid}" id="diy_cancel_${uid}">❌ 取消创建</button>\n\n**全部可用变量（调用KukeChat API）：**\n基础：\`{用户名}\` \`{用户ID}\` \`{群ID}\` \`{时间}\` \`{日期}\` \`{随机数}\`\n机器人：\`{机器人昵称}\` \`{机器人ID}\` \`{机器人BotID}\` \`{机器人群数}\` \`{机器人群列表}\`\n群信息：\`{群名称}\` \`{群成员数}\` \`{在线人数}\` \`{在线用户数}\` \`{入群申请数}\`\n用户：\`{用户信息}\` \`{用户信息[ID]}\`\n列表：\`{成员列表}\` \`{在线列表}\` \`{全局在线列表}\` \`{消息列表}\`\n消息：\`{最新消息}\` \`{最新消息发送者}\`</markdown>`;
        sendMsg(cid, typeMsg);
        return;
      }

      // /自制功能 查看本群DIY指令列表
      if (diyEnabled && content === '/自制功能') {
        sendMsg(cid, buildDIYTable(cid, '📋 本群自制功能列表'));
        return;
      }

      // /删除DIY[指令名] 删除指令（仅群主和ID3038）
      if (diyEnabled && /^\/删除[Dd][Ii][Yy]/.test(content)) {
        const rawName = parseDeleteDIYCommand(content);
        if (!rawName) {
          sendMsg(cid, '⚠️格式：/删除DIY[指令名]');
          return;
        }
        const { cleanName } = parseParamsFromName(rawName);
        const cmdName = cleanName || rawName.trim();
        const senderRole = msg.sender?.role || msg.sender?.user_role || msg.sender?.permission;
        const isOwner = senderRole === 'owner' || msg.sender?.is_owner === true;
        if (uid !== 3038 && !isOwner) {
          sendMsg(cid, '❌只有群主或ID 3038才能删除自制指令');
          return;
        }
        if (!hasDIYCommand(cid, cmdName)) {
          sendMsg(cid, `❌本群不存在"/${cmdName}"指令`);
          return;
        }
        deleteDIYCommand(cid, cmdName);
        sendMsg(cid, buildDIYTable(cid, `✅已删除"/${cmdName}"指令`));
        return;
      }

      // 播放音乐
      console.log('[音乐调试-到达] content=', JSON.stringify(content));
      const musicMatch = content.match(/^\/播放音乐\s*[\[【](.+)[\]】]$/);
      if (musicMatch) {
        const keyword = musicMatch[1].trim();
        // 已去掉正在搜索提示，避免看起来像发两遍
        (async () => {
          try {
            // 1. 用 SE云音解析 API 搜索歌曲
            console.log('[音乐] 搜索:', keyword);
            const searchRes = await fetch(`https://music.sedet.top/api.php?action=search&keyword=${encodeURIComponent(keyword)}`);
            if (!searchRes.ok) throw new Error(`搜索API ${searchRes.status}`);
            const searchData = await searchRes.json();
            const songs = searchData.result?.songs || [];
            if (songs.length === 0) { sendMsg(cid, `❌ 未找到「${keyword}」相关歌曲`); return; }

            // 2. 找一首有播放权限的歌（遍历前5首）
            let song = null;
            for (let i = 0; i < Math.min(5, songs.length); i++) {
              const s = songs[i];
              const urlRes = await fetch(`https://music.sedet.top/api.php?action=url&id=${s.id}`);
              if (urlRes.ok) {
                const urlData = await urlRes.json();
                const url = urlData.data?.[0]?.url;
                if (url && url.length > 10) { song = s; break; }
              }
            }
            if (!song) { sendMsg(cid, `❌ 「${keyword}」暂无可用播放链接（可能是VIP歌曲）`); return; }

            const songId = song.id;
            const songName = song.name;
            const artist = (song.ar || song.artists || []).map(a => a.name).join('、');
            const album = song.al?.name || song.album?.name || '未知专辑';
            const cover = song.al?.picUrl || song.album?.picUrl || '';

            // 3. 发送歌曲信息
            let infoMsg = `<markdown># 🎵 ${songName}\n\n歌手：${artist}\n专辑：${album}\n`;
            if (cover) infoMsg += `\n<img src="${cover}" />\n`;
            infoMsg += `\n> 正在为你准备音频...</markdown>`;
            sendMsg(cid, infoMsg);

            // 4. 获取播放链接并下载（先试320kbps，太大就降128kbps）
            const MAX_SIZE = 7 * 1024 * 1024; // 7MB，留余量
            let audioBuffer = null;
            let usedQuality = '';
            let playUrl = '';

            // 尝试不同音质
            const qualities = [
              { br: 320000, label: '高品质' },
              { br: 128000, label: '标准音质' }
            ];

            for (const q of qualities) {
              try {
                console.log('[音乐] 尝试', q.label, '(br=' + q.br + ')');
                const urlApi = `https://music.163.com/api/song/enhance/player/url?id=${songId}&ids=%5B${songId}%5D&br=${q.br}`;
                const urlRes = await fetch(urlApi, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/' } });
                if (!urlRes.ok) continue;
                const urlData = await urlRes.json();
                const url = urlData.data?.[0]?.url;
                if (!url) continue;
                playUrl = url;

                console.log('[音乐] 下载音频:', q.label);
                const audioRes = await fetch(playUrl);
                if (!audioRes.ok) continue;
                const buf = Buffer.from(await audioRes.arrayBuffer());
                console.log('[音乐] 文件大小:', (buf.length/1024/1024).toFixed(2), 'MB');

                if (buf.length < 1000) continue;
                audioBuffer = buf;
                usedQuality = q.label;
                if (buf.length <= MAX_SIZE) {
                  console.log('[音乐] 大小符合要求，使用', q.label);
                  break;
                } else {
                  console.log('[音乐] 文件过大，尝试降低音质');
                }
              } catch (e) {
                console.log('[音乐]', q.label, '失败:', e.message);
              }
            }

            if (!audioBuffer) {
              // 所有音质都失败，降级发送链接
              console.log('[音乐] 所有音质下载失败，降级发送链接');
              sendMsg(cid, `<markdown>🎵 **${songName}** - ${artist}\n\n音频准备失败，已为你提供播放链接\n\n🔗 <link href="${playUrl || 'https://music.163.com/#/song?id=' + songId}">点击播放完整音乐</link></markdown>`);
              return;
            }

            // 5. 上传到 KukeChat 语音接口
            console.log('[音乐] 上传语音，音质:', usedQuality, '大小:', (audioBuffer.length/1024/1024).toFixed(2), 'MB');
            let voiceUrl = '';
            let voiceKey = '';
            try {
              const formData = new FormData();
              formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), `${songName}.mp3`);
              const uploadRes = await fetch(`${BASE_URL}/bot-api/uploads/voice`, {
                method: 'POST',
                headers: { 'Authorization': `Bot ${BOT_KEY}` },
                body: formData
              });
              if (!uploadRes.ok) {
                const errText = await uploadRes.text();
                console.error('[音乐] 语音上传失败:', uploadRes.status, errText.substring(0, 200));
                throw new Error(`上传失败 ${uploadRes.status}`);
              }
              const uploadData = await uploadRes.json();
              console.log('[音乐] 上传返回:', JSON.stringify(uploadData).substring(0, 300));
              voiceUrl = uploadData.url || uploadData.data?.url || uploadData.file_url || uploadData.data?.file_url;
              voiceKey = uploadData.key || uploadData.data?.key || uploadData.file_key || uploadData.data?.file_key;
            } catch (uploadErr) {
              console.log('[音乐] 语音上传失败，降级发送链接:', uploadErr.message);
              sendMsg(cid, `<markdown>🎵 **${songName}** - ${artist}\n\n语音发送失败，已为你提供播放链接\n\n🔗 <link href="${playUrl}">点击播放完整音乐</link></markdown>`);
              return;
            }

            // 6. 发送语音消息
            if (voiceUrl) {
              console.log('[音乐] 发送语音 URL:', voiceUrl.substring(0, 80));
              sendMsg(cid, `<voice src="${voiceUrl}" />`);
            } else if (voiceKey) {
              console.log('[音乐] 发送语音 key:', voiceKey);
              sendMsg(cid, `<voice file_key="${voiceKey}" />`);
            } else {
              console.log('[音乐] 无语音URL或key，降级发送链接');
              sendMsg(cid, `<markdown>🎵 **${songName}** - ${artist}\n\n🔗 <link href="${playUrl}">点击播放完整音乐</link></markdown>`);
            }

            console.log('[音乐] 播放完成，音质:', usedQuality);
          } catch (e) {
            console.error('音乐播放失败:', e.message);
            sendMsg(cid, `❌ 音乐播放失败：${e.message}\n\n可能是网络问题，请稍后重试`);
          }
        })();
        return;
      }

      if (content === '/help') {
        const isClassGroup = String(msg.conversation_id) === '4307';
        const adminLabel = isClassGroup ? '班干部及老师' : '管理员';
        const botTitle = isClassGroup ? '智羽班级智能体指令' : '君灵bot指令';
        const werewolfLines = isClassGroup ? '' : `- \`/狼人杀\`：开始狼人杀游戏
- \`/结束房间[房间号]\`：结束狼人杀房间（房主/群主/${adminLabel}/ID3038）
`;
        const diyHelpLines = isClassGroup ? '' : `- \`/自制功能\`：查看本群自制指令列表
- \`/DIY[指令名]\`：创建本群自制指令
`;
        const helpText = `<markdown># ${botTitle}
## 常用
<link action="callback" action_id="help_common">📋 查看全部常用指令</link>
- \`/关于\`：查看机器人详细信息
## ${adminLabel}
<link action="callback" action_id="help_vote">投票管理</link>：发起和管理投票
<link action="callback" action_id="help_forbidden">违禁词管理</link>：添加和删除违禁词
<link action="callback" action_id="help_blacklist">黑名单管理</link>：查看和管理黑名单
<link action="callback" action_id="help_mute">禁言管理</link>：手动禁言和解除禁言
<link action="callback" action_id="help_switch">功能开关</link>：开启或关闭各项功能
${isClassGroup ? '' : '<link action="callback" action_id="help_diy">自制指令</link>：创建和管理DIY指令\n'}<link action="callback" action_id="help_other">其他管理</link>：进群欢迎和全局推送
</markdown>`;
        sendMsg(msg.conversation_id, helpText);
      }
      else if (content === '/关于' || content === '/about') {
        const aboutText = `<markdown># 🤖 关于君灵bot

> 通情达理守良知，实事求是爱科学

## 📋 基本信息

| 项目 | 详情 |
|------|------|
| **创始人** | 君衔（用户ID：\`3038\`） |
| **引擎** | 智谱AI GLM-4-Flash / GLM-4V 多模态 |
| **平台** | KukeChat（酷可聊天） |
| **语言驱动** | Node.js + JavaScript |
| **后端服务器** | Railway 云端部署 |
| **版本** | v2.2-music |
| **上线时间** | 2026年8月 |
| **功能数量** | 50+ 指令 |
| **数据存储** | 本地JSON + Railway Postgres |
| **保活方案** | UptimeRobot + 本地监控自动切换 |
| **开源地址** | [GitHub](https://github.com/373340904/kuke-bot) |
| **创建理念** | 为弱势群体服务，通情达理守良知 |

## ✨ 核心特性

- 🤖 **AI对话**：支持文字和图片识别，正常人语气
- 🛠️ **DIY自制指令**：群内自定义指令，AI协助创建
- 🔇 **群管理**：禁言、踢人、黑名单、违禁词过滤
- 🎮 **娱乐功能**：狼人杀、投票、签到、音乐播放
- 📊 **数据统计**：群活跃统计、在线人数查询
- 🔄 **双机热备**：云端+本地自动切换，24小时在线

---
> 君灵bot由君衔独立开发维护，致力于打造最懂用户的智能机器人助手。
</markdown>`;
        sendMsg(msg.conversation_id, aboutText);
      }
      else if (content === '/违禁词表格') {
        sendMsg(msg.conversation_id, buildForbiddenTable(msg.conversation_id, '📋 当前违禁词列表'));
      }
      else if (content === '/ping') {
        sendMsg(msg.conversation_id, '🏓 pong！机器人在线');
      }
      // ========== 创意游戏 ==========
      else if (content.startsWith('/心灵感应')) {
        const match = content.match(/^\/心灵感应\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '<markdown>## 🧠 心灵感应\n\n**玩法：**\n1. 出题者用 \`/心灵感应[主题]\` 发起\n2. 出题者**私聊机器人**发送3个答案（每行一个）\n3. 群友用 \`/猜[答案]\` 猜这3个词\n4. 猜中越多默契度越高！\n\n> 测测你们的心灵感应有多强~</markdown>'); return; }
        const theme = match[1];
        const teleData = loadTelepathyData();
        teleData[String(cid)] = { theme, answers: [], guesses: {}, creator: msg.sender_id, creatorName: msg.sender_display_name, phase: 'waiting_answers' };
        saveTelepathyData(teleData);
        sendMsg(msg.conversation_id, `<markdown>## 🧠 心灵感应\n\n**主题：** ${theme}\n\n📢 请 <at id="${msg.sender_id}" /> **私聊机器人**发送3个答案（每行一个）\n\n> 群友们准备好猜答案了吗？</markdown>`);
      }
      else if (content.startsWith('/猜')) {
        const match = content.match(/^\/猜\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/猜[答案]'); return; }
        const guess = match[1].trim();
        const teleData = loadTelepathyData();
        const game = teleData[String(cid)];
        if (!game || game.phase !== 'guessing') { sendMsg(msg.conversation_id, '⚠️当前没有进行中的心灵感应游戏'); return; }
        const uid = String(msg.sender_id);
        if (!game.guesses[uid]) game.guesses[uid] = [];
        if (game.guesses[uid].includes(guess)) { sendMsg(msg.conversation_id, `⚠️ ${msg.sender_display_name} 已经猜过"${guess}"了`); return; }
        game.guesses[uid].push(guess);
        const hit = game.answers.some(a => a.includes(guess) || guess.includes(a));
        if (hit) {
          sendMsg(msg.conversation_id, `<markdown>## 🎯 猜中了！\n\n<at id="${msg.sender_id}" /> 猜中了 **"${guess}"**！\n\n> 继续猜剩下的答案~</markdown>`);
        } else {
          sendMsg(msg.conversation_id, `❌ ${msg.sender_display_name} 猜"${guess}"不对，继续加油~`);
        }
        saveTelepathyData(teleData);
      }
      else if (content === '/揭晓') {
        const teleData = loadTelepathyData();
        const game = teleData[String(cid)];
        if (!game) { sendMsg(msg.conversation_id, '⚠️当前没有进行中的心灵感应游戏'); return; }
        if (game.creator !== msg.sender_id && msg.sender_id !== 3038) { sendMsg(msg.conversation_id, '❌只有出题者才能揭晓答案'); return; }
        // 计算每个人的默契度
        let resultText = `<markdown>## 🧠 心灵感应 - 揭晓答案\n\n**主题：** ${game.theme}\n\n**正确答案：**\n`;
        game.answers.forEach((a, i) => { resultText += `${i + 1}. ${a}\n`; });
        resultText += '\n## 📊 默契度排行\n\n';
        const rankings = Object.entries(game.guesses).map(([uid, guesses]) => {
          const hits = guesses.filter(g => game.answers.some(a => a.includes(g) || g.includes(a))).length;
          return { uid, hits, total: guesses.length };
        }).sort((a, b) => b.hits - a.hits);
        if (rankings.length === 0) {
          resultText += '> 没有人参与猜测\n';
        } else {
          rankings.forEach((r, i) => {
            const pct = Math.round(r.hits / 3 * 100);
            const level = pct === 100 ? '🔥 心灵感应' : pct >= 66 ? '💛 默契十足' : pct >= 33 ? '💚 有点默契' : '💔 还需磨合';
            resultText += `${i + 1}. 用户${r.uid}：猜中${r.hits}/3 → **${pct}%** ${level}\n`;
          });
        }
        resultText += '</markdown>';
        sendMsg(msg.conversation_id, resultText);
        delete teleData[String(cid)];
        saveTelepathyData(teleData);
      }
      else if (content === '/谁是卧底') {
        const wordPairs = [
          ['苹果', '梨'], ['可乐', '雪碧'], ['老虎', '狮子'], ['玫瑰', '月季'],
          ['篮球', '足球'], ['咖啡', '奶茶'], ['电影', '电视剧'], ['猫', '狗'],
          ['夏天', '冬天'], ['老师', '教授'], ['手机', '平板'], ['火车', '飞机'],
          ['米饭', '面条'], ['钢琴', '吉他'], ['医生', '护士'], ['森林', '草原']
        ];
        const pair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
        const undercoverWord = pair[0], civilianWord = pair[1];
        const underData = loadUndercoverData();
        underData[String(cid)] = {
          civilianWord, undercoverWord,
          players: {}, phase: 'joining',
          creator: msg.sender_id, round: 1, descriptions: []
        };
        saveUndercoverData(underData);
        sendMsg(msg.conversation_id, `<markdown>## 🕵️ 谁是卧底\n\n<at id="${msg.sender_id}" /> 发起了游戏！\n\n**参与方式：** 发送 \`/加入\` 参与游戏\n\n> 至少4人开始，卧底的词和你们相似但不同\n> 轮流描述，投票找出卧底！</markdown>`);
      }
      else if (content === '/加入') {
        const underData = loadUndercoverData();
        const game = underData[String(cid)];
        if (!game || game.phase !== 'joining') { sendMsg(msg.conversation_id, '⚠️当前没有可加入的谁是卧底游戏'); return; }
        const uid = String(msg.sender_id);
        if (game.players[uid]) { sendMsg(msg.conversation_id, `⚠️ ${msg.sender_display_name} 已经加入了`); return; }
        game.players[uid] = { name: msg.sender_display_name, word: '', isUndercover: false, alive: true };
        saveUndercoverData(underData);
        const count = Object.keys(game.players).length;
        sendMsg(msg.conversation_id, `✅ ${msg.sender_display_name} 加入游戏！当前 ${count} 人`);
        if (count >= 4) {
          sendMsg(msg.conversation_id, `<markdown>## 🎮 人数足够！\n\n发送 \`/开始卧底\` 开始游戏</markdown>`);
        }
      }
      else if (content === '/开始卧底') {
        const underData = loadUndercoverData();
        const game = underData[String(cid)];
        if (!game || game.phase !== 'joining') { sendMsg(msg.conversation_id, '⚠️游戏状态不对'); return; }
        if (game.creator !== msg.sender_id && msg.sender_id !== 3038) { sendMsg(msg.conversation_id, '❌只有发起者才能开始'); return; }
        const playerIds = Object.keys(game.players);
        if (playerIds.length < 4) { sendMsg(msg.conversation_id, '⚠️至少需要4人'); return; }
        // 随机选卧底
        const undercoverIdx = Math.floor(Math.random() * playerIds.length);
        playerIds.forEach((pid, i) => {
          game.players[pid].isUndercover = (i === undercoverIdx);
          game.players[pid].word = (i === undercoverIdx) ? game.undercoverWord : game.civilianWord;
        });
        game.phase = 'describing';
        game.currentSpeaker = 0;
        game.speakerOrder = playerIds;
        saveUndercoverData(underData);
        // 私聊每个人发词
        for (const pid of playerIds) {
          const p = game.players[pid];
          sendPrivateMsg(pid, `<markdown>## 🕵️ 谁是卧底\n\n你的词是：**${p.word}**\n\n> ${p.isUndercover ? '你是卧底！' : '你是平民'}\n> 用 /描述[内容] 描述你的词</markdown>`);
        }
        const firstSpeaker = game.players[playerIds[0]];
        sendMsg(msg.conversation_id, `<markdown>## 🎮 游戏开始！\n\n已私聊每个人的词语\n\n请 <at id="${playerIds[0]}" /> 先用 \`/描述[内容]\` 描述你的词</markdown>`);
      }
      else if (content.startsWith('/描述')) {
        const match = content.match(/^\/描述\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/描述[内容]'); return; }
        const desc = match[1];
        const underData = loadUndercoverData();
        const game = underData[String(cid)];
        if (!game || game.phase !== 'describing') { sendMsg(msg.conversation_id, '⚠️当前不是描述阶段'); return; }
        const uid = String(msg.sender_id);
        const expectedUid = game.speakerOrder[game.currentSpeaker];
        if (uid !== expectedUid) { sendMsg(msg.conversation_id, `⚠️还没轮到你，当前请 ${game.players[expectedUid].name} 描述`); return; }
        game.descriptions.push({ uid, name: game.players[uid].name, desc });
        game.currentSpeaker++;
        saveUndercoverData(underData);
        if (game.currentSpeaker >= game.speakerOrder.length) {
          // 描述完毕，进入投票阶段
          game.phase = 'voting';
          saveUndercoverData(underData);
          let voteText = '<markdown>## 🗳️ 描述完毕，开始投票！\n\n';
          game.descriptions.forEach((d, i) => { voteText += `${i + 1}. **${d.name}**：${d.desc}\n`; });
          voteText += '\n用 \`/投卧底[用户ID]\` 投票，得票最多的出局\n</markdown>';
          sendMsg(msg.conversation_id, voteText);
        } else {
          const nextUid = game.speakerOrder[game.currentSpeaker];
          sendMsg(msg.conversation_id, `✅ ${game.players[uid].name} 描述完毕，请 <at id="${nextUid}" /> 继续描述`);
        }
      }
      else if (content.startsWith('/投卧底')) {
        const match = content.match(/^\/投卧底\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/投卧底[用户ID]'); return; }
        const targetId = match[1].trim();
        const underData = loadUndercoverData();
        const game = underData[String(cid)];
        if (!game || game.phase !== 'voting') { sendMsg(msg.conversation_id, '⚠️当前不是投票阶段'); return; }
        const uid = String(msg.sender_id);
        if (!game.votes) game.votes = {};
        game.votes[uid] = targetId;
        saveUndercoverData(underData);
        const votedCount = Object.keys(game.votes).length;
        const aliveCount = game.speakerOrder.filter(id => game.players[id].alive).length;
        sendMsg(msg.conversation_id, `✅ ${msg.sender_display_name} 投票完毕（${votedCount}/${aliveCount}）`);
        if (votedCount >= aliveCount) {
          // 计票
          const voteCounts = {};
          Object.values(game.votes).forEach(tid => { voteCounts[tid] = (voteCounts[tid] || 0) + 1; });
          const maxVotes = Math.max(...Object.values(voteCounts));
          const outIds = Object.entries(voteCounts).filter(([_, v]) => v === maxVotes).map(([id]) => id);
          if (outIds.length > 1) {
            sendMsg(msg.conversation_id, '<markdown>## ⚖️ 平票！\n\n本轮无人出局，进入下一轮描述\n\n用 \`/描述[内容]\` 继续</markdown>');
            game.phase = 'describing';
            game.currentSpeaker = 0;
            game.descriptions = [];
            game.votes = {};
            game.round++;
            saveUndercoverData(underData);
          } else {
            const outId = outIds[0];
            const outPlayer = game.players[outId];
            outPlayer.alive = false;
            const isUndercover = outPlayer.isUndercover;
            saveUndercoverData(underData);
            if (isUndercover) {
              sendMsg(msg.conversation_id, `<markdown>## 🎉 平民胜利！\n\n**${outPlayer.name}** 是卧底，被投出！\n\n卧底词：**${game.undercoverWord}**\n平民词：**${game.civilianWord}**</markdown>`);
              delete underData[String(cid)];
              saveUndercoverData(underData);
            } else {
              const aliveUndercover = game.speakerOrder.filter(id => game.players[id].alive && game.players[id].isUndercover).length;
              const aliveCivilian = game.speakerOrder.filter(id => game.players[id].alive && !game.players[id].isUndercover).length;
              if (aliveUndercover >= aliveCivilian) {
                const undercoverPlayer = game.players[game.speakerOrder.find(id => game.players[id].isUndercover)];
                sendMsg(msg.conversation_id, `<markdown>## 😈 卧底胜利！\n\n**${outPlayer.name}** 是平民，被冤死！\n\n卧底是 **${undercoverPlayer.name}**\n卧底词：**${game.undercoverWord}**\n平民词：**${game.civilianWord}**</markdown>`);
                delete underData[String(cid)];
                saveUndercoverData(underData);
              } else {
                sendMsg(msg.conversation_id, `<markdown>## 💀 ${outPlayer.name} 出局\n\n是**平民**，游戏继续\n\n进入下一轮描述，用 \`/描述[内容]\`</markdown>`);
                game.phase = 'describing';
                game.currentSpeaker = 0;
                game.speakerOrder = game.speakerOrder.filter(id => game.players[id].alive);
                game.descriptions = [];
                game.votes = {};
                game.round++;
                saveUndercoverData(underData);
              }
            }
          }
        }
      }
      else if (content.startsWith('/故事接龙')) {
        const match = content.match(/^\/故事接龙(?:\[(.+?)\])?/);
        const theme = match && match[1] ? match[1] : '随机';
        const storyData = loadStoryData();
        storyData[String(cid)] = { theme, lines: [], creator: msg.sender_id, maxLines: 10 };
        saveStoryData(storyData);
        // AI生成开头
        (async () => {
          try {
            const opening = await callAI(`请以"${theme}"为主题，写一个故事的开头第一句话，不超过30字，要有悬念和吸引力。只输出这句话，不要其他内容。`);
            const game = loadStoryData()[String(cid)];
            if (game) {
              game.lines.push({ speaker: 'AI', text: opening.trim() });
              saveStoryData(loadStoryData());
            }
            sendMsg(msg.conversation_id, `<markdown>## 📖 故事接龙\n\n**主题：** ${theme}\n\n> 每人用 \`/接[内容]\` 接下一句，接满10句结束\n\n---\n\n**AI：** ${opening.trim()}\n\n---\n\n下一位请接龙~</markdown>`);
          } catch (e) {
            sendMsg(msg.conversation_id, `<markdown>## 📖 故事接龙\n\n**主题：** ${theme}\n\n> 每人用 \`/接[内容]\` 接下一句\n\nAI开头生成失败，请第一位玩家用 \`/接[内容]\` 开始故事</markdown>`);
          }
        })();
      }
      else if (content.startsWith('/接')) {
        const match = content.match(/^\/接\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/接[内容]'); return; }
        const line = match[1];
        const storyData = loadStoryData();
        const game = storyData[String(cid)];
        if (!game) { sendMsg(msg.conversation_id, '⚠️当前没有进行中的故事接龙'); return; }
        game.lines.push({ speaker: msg.sender_display_name, text: line });
        saveStoryData(storyData);
        const count = game.lines.length;
        if (count >= game.maxLines) {
          // 结束，AI整理
          (async () => {
            try {
              const fullStory = game.lines.map(l => l.text).join('');
              const polished = await callAI(`请把下面这个接龙故事整理润色成一篇完整流畅的小故事，保留原意，增加细节描写，300字左右。故事内容：${fullStory}`);
              sendMsg(msg.conversation_id, `<markdown>## 📖 故事接龙 - 完成！\n\n**主题：** ${game.theme}\n\n---\n\n${polished}\n\n---\n\n> 感谢所有参与者的创意！</markdown>`);
            } catch {
              const rawStory = game.lines.map(l => `**${l.speaker}：** ${l.text}`).join('\n\n');
              sendMsg(msg.conversation_id, `<markdown>## 📖 故事接龙 - 完成！\n\n**主题：** ${game.theme}\n\n---\n\n${rawStory}</markdown>`);
            }
          })();
          delete storyData[String(cid)];
          saveStoryData(storyData);
        } else {
          sendMsg(msg.conversation_id, `✅ ${msg.sender_display_name} 接龙！（第${count}/${game.maxLines}句）`);
        }
      }
      else if (content === '/结束故事') {
        const storyData = loadStoryData();
        if (!storyData[String(cid)]) { sendMsg(msg.conversation_id, '⚠️当前没有进行中的故事接龙'); return; }
        const game = storyData[String(cid)];
        (async () => {
          try {
            const fullStory = game.lines.map(l => l.text).join('');
            const polished = await callAI(`请把下面这个接龙故事整理润色成一篇完整流畅的小故事，保留原意，增加细节描写，300字左右。故事内容：${fullStory}`);
            sendMsg(msg.conversation_id, `<markdown>## 📖 故事接龙 - 完成！\n\n**主题：** ${game.theme}\n\n---\n\n${polished}</markdown>`);
          } catch {
            const rawStory = game.lines.map(l => `**${l.speaker}：** ${l.text}`).join('\n\n');
            sendMsg(msg.conversation_id, `<markdown>## 📖 故事接龙 - 完成！\n\n${rawStory}</markdown>`);
          }
        })();
        delete storyData[String(cid)];
        saveStoryData(storyData);
      }
      else if (content.startsWith('/命运抉择')) {
        const match = content.match(/^\/命运抉择(?:\[(.+?)\])?/);
        const theme = match && match[1] ? match[1] : '随机冒险';
        const fateData = loadFateData();
        fateData[String(cid)] = { theme, round: 1, history: [], votes: {} };
        saveFateData(fateData);
        (async () => {
          try {
            const scene = await callAI(`你是一个互动小说引擎。请以"${theme}"为主题，生成第一个剧情场景。要求：\n1. 场景描述80-120字，有画面感\n2. 给出2-3个选择（用A/B/C标记）\n3. 每个选择简短明确\n4. 格式：先场景描述，然后"## 你的选择"，然后列出选项\n5. 只输出内容，不要解释`);
            sendMsg(msg.conversation_id, `<markdown>## 🎲 命运抉择\n\n**主题：** ${theme}\n\n---\n\n${scene}\n\n---\n\n> 用按钮投票选择你的命运</markdown>`);
            const game = loadFateData()[String(cid)];
            if (game) {
              game.currentScene = scene;
              saveFateData(loadFateData());
            }
          } catch (e) {
            sendMsg(msg.conversation_id, `❌ 命运抉择生成失败：${e.message}`);
          }
        })();
      }
      else if (content.startsWith('/echo ')) {
        sendMsg(msg.conversation_id, `🔊 ${content.slice(6)}`);
      }
      else if (content === '你好') {
        sendMsg(msg.conversation_id, `你好呀 ${msg.sender_display_name}！有什么可以帮你的？`);
      }
      else if (content === '/群内在线人数') {
        if (!isFeatureEnabled(msg.conversation_id, '群在线人数')) { sendMsg(msg.conversation_id, '群在线人数功能已被管理员关闭'); return; }
        (async () => {
          try {
            // 获取群成员
            const membersData = await getConversationMembers(msg.conversation_id);
            const members = extractMembers(membersData);
            console.log('群成员原始数据:', JSON.stringify(membersData).slice(0, 500));

            // 获取全局在线用户
            const onlineData = await getOnlineUsers();
            const onlineUsers = extractMembers(onlineData);
            console.log('在线用户原始数据:', JSON.stringify(onlineData).slice(0, 500));

            // 构建在线用户ID集合
            const onlineIds = new Set(onlineUsers.map(u => getUserId(u)).filter(id => id != null));

            // 筛选本群在线用户
            const onlineInGroup = members.filter(m => {
              const uid = getUserId(m);
              if (uid == null) return false;
              // 优先用成员自身的在线状态字段
              const selfOnline = isMemberOnline(m);
              if (selfOnline !== null) return selfOnline;
              // 否则用全局在线列表判断
              return onlineIds.has(uid);
            });

            // 按用户ID排序
            onlineInGroup.sort((a, b) => getUserId(a) - getUserId(b));

            // 按指定排版输出（Markdown格式，一级标题最大）
            let reply = `<markdown># 本群在线人数：\`${onlineInGroup.length}\`\n\n`;
            reply += `# 群内在线用户\n\n`;
            reply += onlineInGroup.map((m, i) => `\`${i + 1}\`. ${getUserName(m)}（ID：\`${getUserId(m)}\`）`).join('\n');
            reply += `</markdown>`;

            sendMsg(msg.conversation_id, reply);
          } catch (err) {
            console.error('获取在线人数失败:', err);
            sendMsg(msg.conversation_id, `获取在线人数失败：${err.message}`);
          }
        })();
      }
      else if (content === '/今日群活跃') {
        try {
          const today = getTodayStr();
          const data = loadActivityData();
          const groupData = data[today]?.[cid] || {};
          const users = Object.entries(groupData).map(([id, info]) => ({ id, name: info.name, count: info.count }));
          const totalMsgs = users.reduce((sum, u) => sum + u.count, 0);
          const activeUsers = users.length;
          users.sort((a, b) => b.count - a.count);
          const top10 = users.slice(0, 10);
          let reply = `<markdown># 今日群活跃统计\n\n`;
          reply += `日期：\`${today}\`\n`;
          reply += `总消息数：\`${totalMsgs}\`\n`;
          reply += `活跃人数：\`${activeUsers}\`\n\n`;
          reply += `## 发言榜\n`;
          if (top10.length === 0) {
            reply += `> 暂无数据，多聊几句就有啦~`;
          } else {
            reply += '```\n' + top10.map((u, i) => `${i + 1}. ${u.name}：${u.count} 条`).join('\n') + '\n```';
          }
          reply += `</markdown>`;
          sendMsg(msg.conversation_id, reply);
        } catch (e) {
          console.error('今日群活跃报错:', e);
          sendMsg(msg.conversation_id, `❌统计失败：${e.message}`);
        }
      }
      else if (content === '/签到' || content === '签到') {
        if (!isFeatureEnabled(msg.conversation_id, '签到')) { sendMsg(msg.conversation_id, '签到功能已被管理员关闭'); return; }
        const today = getTodayStr();
        let data = loadCheckinData();

        // 新的一天，重置签到数据
        if (data.date !== today) {
          data = { date: today, conversations: {} };
        }

        const convId = String(msg.conversation_id);
        const userId = msg.sender_id;
        const userName = msg.sender_display_name || msg.sender?.nickname || '未知用户';

        // 确保当前群有签到数据结构
        if (!data.conversations[convId]) {
          data.conversations[convId] = { records: {}, count: 0 };
        }
        const convData = data.conversations[convId];

        // 已经在本群签到过了，直接回显签到卡片
        if (convData.records[userId]) {
          const rec = convData.records[userId];
          const card = buildCheckinCard(
            userName, today, rec.rank,
            rec.fortuneLevel, rec.fortuneDesc,
            rec.star, rec.luckyNum, rec.color, rec.yi,
            '你已经签过到啦~'
          );
          sendMsg(msg.conversation_id, card);
          return;
        }

        // 执行签到（按群内计数排名）
        convData.count++;
        const rank = convData.count;

        // 生成随机运势
        const { fortune, star, luckyNum, color, yi } = generateFortune();

        // 存下运势数据，方便后续回显
        convData.records[userId] = {
          time: new Date().toISOString(),
          rank,
          fortuneLevel: fortune.level,
          fortuneDesc: fortune.desc,
          star,
          luckyNum,
          color,
          yi,
        };
        saveCheckinData(data);

        // 输出签到卡片
        const card = buildCheckinCard(userName, today, rank, fortune.level, fortune.desc, star, luckyNum, color, yi);
        sendMsg(msg.conversation_id, card);
      }
      else if (content.startsWith('/天气')) {
        if (!isFeatureEnabled(msg.conversation_id, '天气')) { sendMsg(msg.conversation_id, '天气功能已被管理员关闭'); return; }
        const match = content.match(/^\/天气\s*\[(.+?)\]/);
        if (!match) {
          sendMsg(msg.conversation_id, '⚠️格式错误，请使用：/天气[城市]，例如：/天气[北京]');
          return;
        }
        const city = match[1].trim();
        (async () => {
          try {
            const data = await getWeather(city);
            const cur = data.current_condition[0];
            const area = data.nearest_area[0];
            const cityName = area.areaName[0].value;
            const country = area.country[0].value;
            // 验证城市：中文输入但返回非中国城市，认为是无效城市名
            const hasChinese = /[\u4e00-\u9fa5]/.test(city);
            if (hasChinese && country !== 'China') {
              sendMsg(msg.conversation_id, `❌未找到城市"${city}"，请检查城市名是否正确。`);
              return;
            }
            const desc = translateWeatherDesc(cur.weatherDesc[0].value);
            const temp = cur.temp_C;
            const feels = cur.FeelsLikeC;
            const humidity = cur.humidity;
            const wind = cur.windspeedKmph;
            const windDir = translateWindDir(cur.winddir16Point);
            const vis = cur.visibility;
            const pressure = cur.pressure;
            const uv = cur.uvIndex;
            const precip = cur.precipMM;
            const cloud = cur.cloudcover;

            // 未来预报（今天、明天、后天）
            const forecasts = data.weather.slice(0, 3).map(day => {
              const noon = day.hourly.find(h => h.time === '1200') || day.hourly[Math.floor(day.hourly.length / 2)];
              return {
                date: day.date,
                desc: translateWeatherDesc(noon.weatherDesc[0].value),
                max: day.maxtempC,
                min: day.mintempC,
                sunrise: day.astronomy[0].sunrise,
                sunset: day.astronomy[0].sunset,
                rain: noon.chanceofrain,
              };
            });
            const today = forecasts[0];

            let reply = `<markdown>🌤️ ${cityName}（${country}）天气\n\n`;
            reply += `**当前天气**\n\n`;
            reply += `| 项目 | 详情 | 项目 | 详情 |\n`;
            reply += `|------|------|------|------|\n`;
            reply += `| 天气 | ${desc} | 温度 | \`${temp}\`°C |\n`;
            reply += `| 体感 | \`${feels}\`°C | 湿度 | \`${humidity}\`% |\n`;
            reply += `| 风速 | \`${wind}\` km/h | 风向 | ${windDir} |\n`;
            reply += `| 能见度 | \`${vis}\` km | 气压 | \`${pressure}\` hPa |\n`;
            reply += `| 紫外线 | \`${uv}\` | 降水量 | \`${precip}\` mm |\n`;
            reply += `| 云量 | \`${cloud}\`% | 今日 | \`${today.max}\`°C / \`${today.min}\`°C |\n`;
            reply += `| 日出 | ${today.sunrise} | 日落 | ${today.sunset} |\n\n`;
            reply += `**未来预报**\n\n`;
            reply += `| 日期 | 天气 | 最高 | 最低 |\n`;
            reply += `|------|------|------|------|\n`;
            forecasts.slice(0, 3).forEach(f => {
              reply += `| ${f.date} | ${f.desc} | \`${f.max}\`°C | \`${f.min}\`°C |\n`;
            });
            reply += `</markdown>`;

            sendMsg(msg.conversation_id, reply);
          } catch (err) {
            console.error('获取天气失败:', err);
            sendMsg(msg.conversation_id, `❌获取天气失败：${err.message}\n请检查城市名是否正确。`);
          }
        })();
      }
      else if (content.startsWith('/绘图')) {
        const match = content.match(/^\/绘图\s*\[(.+?)，(.+?)\]/);
        if (!match) {
          sendMsg(msg.conversation_id, '⚠️格式：/绘图[内容，风格]，例如：/绘图[一只猫，动漫风格]');
          return;
        }
        const promptText = match[1].trim();
        const style = match[2].trim();
        sendMsg(msg.conversation_id, `🎨 正在联网搜索「${promptText}」并生成（${style}）...`);
        (async () => {
          try {
            // 第一步：联网搜索关键词
            let searchInfo = '';
            try {
              const searchController = new AbortController();
              const searchTimeout = setTimeout(() => searchController.abort(), 8000);
              const searchRes = await fetch(`https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(promptText)}&bk_length=300`, { signal: searchController.signal });
              clearTimeout(searchTimeout);
              if (searchRes.ok) {
                const searchData = await searchRes.json();
                if (searchData?.abstract) searchInfo = searchData.abstract.substring(0, 200);
              }
            } catch (e) { console.log('绘图搜索失败:', e.message); }
            const fullPrompt = searchInfo
              ? `${promptText}, ${style}, ${searchInfo}, high quality, masterpiece, detailed, 8k`
              : `${promptText}, ${style}, high quality, masterpiece, detailed, 8k`;
            const seed = Math.floor(Math.random() * 1000000);
            let imgBuffer = null;
            let contentType = 'image/png';
            // 第二步：优先用 Pollinations.ai flux 模型（质量最高）
            try {
              const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 90000);
              const imgRes = await fetch(pollUrl, { signal: controller.signal });
              clearTimeout(timeout);
              if (imgRes.ok) {
                imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                contentType = imgRes.headers.get('content-type') || 'image/png';
                console.log('Pollinations绘图成功');
              }
            } catch (e) { console.log('Pollinations失败，切换智谱:', e.message); }
            // 第三步：Pollinations失败则用智谱CogView
            if (!imgBuffer) {
              if (!ZHIPU_API_KEY) throw new Error('绘图API均失败');
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 60000);
              const res = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${ZHIPU_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'cogview-3', prompt: fullPrompt, size: '1024x1024' }),
                signal: controller.signal
              });
              clearTimeout(timeout);
              if (!res.ok) throw new Error(`智谱绘图返回 ${res.status}`);
              const data = await res.json();
              const imgUrl = data?.data?.[0]?.url;
              if (!imgUrl) throw new Error('智谱返回无图片URL');
              const imgRes = await fetch(imgUrl);
              if (!imgRes.ok) throw new Error('图片下载失败');
              imgBuffer = Buffer.from(await imgRes.arrayBuffer());
              contentType = imgRes.headers.get('content-type') || 'image/png';
              console.log('智谱绘图成功');
            }
            if (!imgBuffer) throw new Error('绘图失败');
            // 上传到 KukeChat
            const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
            const formData = new FormData();
            formData.append('file', new Blob([imgBuffer], { type: contentType }), `image.${ext}`);
            const uploadRes = await fetch(`${BASE_URL}/bot-api/uploads/image`, {
              method: 'POST',
              headers: { 'Authorization': `Bot ${BOT_KEY}` },
              body: formData
            });
            if (!uploadRes.ok) throw new Error(`图片上传失败 ${uploadRes.status}`);
            const uploadData = await uploadRes.json();
            const kukeImgUrl = uploadData.url || uploadData.data?.url;
            if (!kukeImgUrl) throw new Error('上传返回无图片URL');
            const searchTip = searchInfo ? `（已联网参考）` : '';
            sendMsg(msg.conversation_id, `<markdown>🎨 **${promptText}**（${style}）${searchTip}\n\n<img src="${kukeImgUrl}" /></markdown>`);
          } catch (err) {
            console.error('绘图失败:', err);
            sendMsg(msg.conversation_id, `❌绘图失败：${err.message}`);
          }
        })();
      }
      else if (content.startsWith('/进群自动发送')) {
        const match = content.match(/^\/进群自动发送\s*\[([\s\S]+)\]/);
        if (!match) {
          sendMsg(msg.conversation_id, '⚠️格式错误，请使用：/进群自动发送[欢迎内容]');
          return;
        }
        const welcomeText = match[1].trim();
        (async () => {
          // 权限校验
          const canUse = await isAdminOrOwner(msg.conversation_id, msg.sender_id, msg.sender);
          if (!canUse) {
            sendMsg(msg.conversation_id, '❌只有群主或管理员才能设置进群自动发送');
            return;
          }
          // 保存设置
          const data = loadWelcomeData();
          data[String(msg.conversation_id)] = welcomeText;
          saveWelcomeData(data);
          // 反馈 + 预览
          sendMsg(msg.conversation_id, `✅已设置本群进群自动发送\n\n———— 内容预览 ————\n\n${welcomeText}`);
        })();
      }
      else if (content.startsWith('/全局推送')) {
        // 只有用户ID 3038 可以使用
        if (msg.sender_id !== 3038) {
          sendMsg(msg.conversation_id, '❌你没有权限使用此命令');
          return;
        }
        const match = content.match(/^\/全局推送\s*\[(.+?)，([\s\S]+)\]/);
        if (!match) {
          sendMsg(msg.conversation_id, '⚠️格式错误，请使用：/全局推送[标题，内容]\n内容中用 \\n 换行');
          return;
        }
        const title = match[1].trim();
        const body = match[2].trim().replace(/\\n/g, '\n');
        const now = new Date().toLocaleString('zh-CN', { hour12: false });

        const pushMsg = `<markdown># ${title}\n\n> ${now}\n\n${body}</markdown>`;

        // 给所有已知的群推送
        (async () => {
          const groups = loadGroups();
          let success = 0;
          for (const gid of groups) {
            const ok = await sendMsg(gid, pushMsg);
            if (ok) success++;
          }
          sendMsg(msg.conversation_id, `✅已向 \`${success}\`/\`${groups.length}\` 个群推送消息`);
        })();
      }
      else if (content === '/狼人杀') {
        const existing = findWRByUser(uid);
        // 只有进行中的房间才阻止创建新房间
        if (existing && existing.room.status !== 'ended') { sendMsg(cid, '❌你已经在一个狼人杀房间中了'); return; }
        const data = loadWR();
        const roomId = 'wr' + Date.now().toString(36);
        const room = {
          roomId, conversationId: cid, status: 'waiting', creator: uid,
          players: [{ userId: uid, nickname: uname, role: null, alive: true, hasActed: false }],
          nightActions: {}, day: 0, speakerIndex: 0, votes: {},
          lastActionTime: Date.now(), deadInfo: [], witchUsed: { save: false, poison: false }
        };
        data[roomId] = room;
        saveWR(data);
        const card = buildRoomCard(room);
        const btnMsg = card.replace('</markdown>', `\n\n<button action="callback" action_id="wr_join_${roomId}" id="wr_join_${roomId}">🚪 加入房间</button>\n<button action="callback" action_id="wr_start_${roomId}" id="wr_start_${roomId}">▶️ 开始游戏</button></markdown>`);
        sendMsg(cid, btnMsg);
      }
      else if (content.startsWith('/结束房间')) {
        const match = content.match(/^\/结束房间\s*\[?(.+?)\]?$/);
        if (!match) { sendMsg(cid, '⚠️格式：/结束房间[房间号]'); return; }
        const roomId = match[1].trim();
        const data = loadWR();
        const room = data[roomId];
        if (!room) { sendMsg(cid, '❌房间不存在'); return; }
        // 权限检查：房主、ID3038、或群主/管理员
        const isCreator = room.creator === uid;
        const canManageGroup = await canManage(cid, uid, msg.sender);
        if (!isCreator && !canManageGroup) { sendMsg(cid, '❌只有房主、群主、管理员或ID 3038可以结束房间'); return; }
        // 结束房间
        room.status = 'ended';
        room.winner = 'manual';
        saveWR(data);
        await unmuteAllPlayers(room);
        sendMsg(room.conversationId, `<markdown># 🏁 房间已结束\n\n> 房间号：\`${roomId}\`\n> 由 **${uname}** 手动结束\n\n**身份揭晓：**\n${room.players.map(p => `${p.alive ? '✅' : '💀'} ${p.nickname} - ${p.role ? ROLE_INFO[p.role].name : '未分配'}`).join('\n')}</markdown>`);
      }
      else if (content.startsWith('/投票') || content.startsWith('/投票结果') || content.startsWith('/结束投票')) {
        if (!isFeatureEnabled(msg.conversation_id, '投票')) { sendMsg(msg.conversation_id, '投票功能已被管理员关闭'); return; }
        const canUse = await canManage(msg.conversation_id, msg.sender_id, msg.sender);
        if (!canUse) { sendMsg(msg.conversation_id, '❌只有群主、管理员或指定用户才能使用投票功能'); return; }
        if (content.startsWith('/投票')) {
          const match = content.match(/^\/投票\s*\[(.+?)\]/);
          if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/投票[全局/单群，标题，选项1，选项2...]\n至少2个选项，最多10个'); return; }
          const parts = match[1].split('，').map(s => s.trim()).filter(Boolean);
          // 检测全局/单群
          let isGlobal = false;
          let startIdx = 0;
          if (parts[0] === '全局') {
            isGlobal = true;
            startIdx = 1;
            if (msg.sender_id !== 3038) { sendMsg(msg.conversation_id, '❌只有ID 3038才能发起全局投票'); return; }
          } else if (parts[0] === '单群') {
            startIdx = 1;
          }
          const title = parts[startIdx];
          const options = parts.slice(startIdx + 1, startIdx + 11);
          if (!title || options.length < 2) { sendMsg(msg.conversation_id, '⚠️需要1个标题+至少2个选项，用中文逗号分隔'); return; }
          const creator = msg.sender_display_name || msg.sender?.nickname || '匿名';
          if (isGlobal) {
            // 全局投票：所有群共享同一个voteId
            const groups = loadGroups();
            const voteId = genVoteId();
            const tempVote = { voteId, title, options, votes: {}, creator, isGlobal: true, conversationIds: [], messageIds: {} };
            let success = 0;
            for (const gid of groups) {
              const message = await sendMsgReturnId(gid, buildVoteButtonMessage(tempVote));
              if (message && message.id) {
                tempVote.conversationIds.push(gid);
                tempVote.messageIds[gid] = message.id;
                success++;
              }
            }
            const voteData = loadVoteData();
            voteData[voteId] = { ...tempVote, created_at: new Date().toISOString() };
            saveVoteData(voteData);
            sendMsg(msg.conversation_id, `✅全局投票已发送到 \`${success}\` 个群，ID：\`${voteId}\``);
          } else {
            // 单群投票
            const voteId = genVoteId();
            const tempVote = { voteId, title, options, votes: {}, creator };
            const message = await sendMsgReturnId(msg.conversation_id, buildVoteButtonMessage(tempVote));
            if (!message || !message.id) { sendMsg(msg.conversation_id, '❌投票创建失败'); return; }
            const voteData = loadVoteData();
            voteData[voteId] = { ...tempVote, messageId: message.id, conversationId: msg.conversation_id, created_at: new Date().toISOString() };
            saveVoteData(voteData);
            sendMsg(msg.conversation_id, `✅投票已创建，ID：\`${voteId}\``);
          }
        }
        else if (content === '/投票结果' || content.startsWith('/投票结果')) {
          const vidMatch = content.match(/^\/投票结果\s*\[(.+?)\]/);
          if (!vidMatch) { sendMsg(msg.conversation_id, '⚠️格式：/投票结果[投票ID]'); return; }
          const voteData = loadVoteData();
          const vote = voteData[vidMatch[1]];
          if (!vote) {
            const allVotes = loadVoteData();
            const allIds = Object.keys(allVotes);
            let hint = '❌找不到该投票ID';
            if (allIds.length > 0) {
              hint += `\n当前可用ID：${allIds.map(id => '`' + id + '`').join('、')}`;
            } else {
              hint += '\n当前没有进行中的投票';
            }
            hint += '\n发送 `/投票列表` 查看所有投票';
            sendMsg(msg.conversation_id, `<markdown>${hint}</markdown>`);
            return;
          }
          sendMsg(msg.conversation_id, buildVoteResultCard(vote));
        }
        else if (content === '/结束投票' || content.startsWith('/结束投票')) {
          const vidMatch = content.match(/^\/结束投票\s*\[(.+?)\]/);
          if (!vidMatch) { sendMsg(msg.conversation_id, '⚠️格式：/结束投票[投票ID]'); return; }
          const voteData = loadVoteData();
          const vote = voteData[vidMatch[1]];
          if (!vote) { sendMsg(msg.conversation_id, '❌找不到该投票ID'); return; }
          // 禁用按钮
          if (vote.isGlobal && vote.conversationIds) {
            for (const gid of vote.conversationIds) {
              const msgId = vote.messageIds[gid];
              if (!msgId) continue;
              for (let i = 0; i < vote.options.length; i++) {
                const componentId = `${vote.voteId}_${i}`;
                await updateButton(gid, msgId, componentId, `${i + 1}. ${vote.options[i]}（已结束）`, 'default', true);
              }
              // 给每个群发结果卡片
              sendMsg(gid, buildVoteResultCard(vote));
            }
          } else {
            for (let i = 0; i < vote.options.length; i++) {
              const componentId = `${vote.voteId}_${i}`;
              await updateButton(vote.conversationId, vote.messageId, componentId, `${i + 1}. ${vote.options[i]}（已结束）`, 'default', true);
            }
            sendMsg(msg.conversation_id, buildVoteResultCard(vote));
          }
          delete voteData[vote.voteId];
          saveVoteData(voteData);
        }
      }
      else if (content === '/投票列表' || content === '/投票id列表') {
        const voteData = loadVoteData();
        const voteIds = Object.keys(voteData);
        if (voteIds.length === 0) {
          sendMsg(msg.conversation_id, '<markdown># 📋 投票列表\n\n> 当前没有进行中的投票</markdown>');
        } else {
          let listText = '<markdown># 📋 进行中的投票\n\n';
          listText += `**共 \`${voteIds.length}\` 个投票**\n\n`;
          listText += '| ID | 标题 | 类型 | 创建时间 |\n';
          listText += '|----|------|------|----------|\n';
          for (const vid of voteIds) {
            const v = voteData[vid];
            const vtype = v.isGlobal ? '全局' : '单群';
            const ctime = v.created_at ? new Date(v.created_at).toLocaleString('zh-CN') : '未知';
            const title = (v.title || '').replace(/\|/g, '\\|').slice(0, 20);
            listText += `| \`${vid}\` | ${title} | ${vtype} | ${ctime} |\n`;
          }
          listText += '\n> 用 `/结束投票[ID]` 结束指定投票</markdown>';
          sendMsg(msg.conversation_id, listText);
        }
      }
      else if (content.startsWith('/增加违禁词')) {
        const canUse = await canManage(msg.conversation_id, msg.sender_id, msg.sender);
        if (!canUse) { sendMsg(msg.conversation_id, '❌只有群主、管理员或指定用户才能管理违禁词'); return; }
        const match = content.match(/^\/增加违禁词\s*\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/增加违禁词[违禁词]'); return; }
        const word = match[1].trim();
        const data = loadForbiddenWords();
        if (!data[cid]) data[cid] = [];
        if (data[cid].includes(word)) {
          sendMsg(msg.conversation_id, buildForbiddenTable(msg.conversation_id, `⚠️违禁词"${maskWord(word)}"已存在`));
        } else {
          data[cid].push(word);
          saveForbiddenWords(data);
          sendMsg(msg.conversation_id, buildForbiddenTable(msg.conversation_id, `✅已添加违禁词"${maskWord(word)}"`));
        }
      }
      else if (content.startsWith('/删除违禁词')) {
        const canUse = await canManage(msg.conversation_id, msg.sender_id, msg.sender);
        if (!canUse) { sendMsg(msg.conversation_id, '❌只有群主、管理员或指定用户才能管理违禁词'); return; }
        const match = content.match(/^\/删除违禁词\s*\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/删除违禁词[违禁词]'); return; }
        const word = match[1].trim();
        const data = loadForbiddenWords();
        if (!data[cid] || !data[cid].includes(word)) {
          sendMsg(msg.conversation_id, buildForbiddenTable(msg.conversation_id, `❌未出现此违禁词"${maskWord(word)}"`));
        } else {
          data[cid] = data[cid].filter(w => w !== word);
          saveForbiddenWords(data);
          sendMsg(msg.conversation_id, buildForbiddenTable(msg.conversation_id, `✅已删除违禁词"${maskWord(word)}"`));
        }
      }
      else if (content === '/黑名单') {
        sendMsg(msg.conversation_id, buildBlacklistCard(msg.conversation_id));
      }
      else if (content.startsWith('/删除黑名单')) {
        // 只有群主和ID3038能用
        const senderRole = msg.sender?.role || msg.sender?.user_role || msg.sender?.permission;
        const isOwner = senderRole === 'owner' || msg.sender?.is_owner === true;
        if (uid !== 3038 && !isOwner) {
          sendMsg(msg.conversation_id, '❌只有群主或指定用户才能删除黑名单');
          return;
        }
        const match = content.match(/^\/删除黑名单\s*\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/删除黑名单[用户ID]'); return; }
        const targetId = match[1].trim();
        const info = removeFromBlacklist(msg.conversation_id, targetId);
        if (info) {
          sendMsg(msg.conversation_id, `<markdown>✅已将 **${info.userName || '用户' + targetId}**（ID：\`${targetId}\`）移出黑名单\n\n${buildBlacklistCard(msg.conversation_id).replace(/^<markdown>/, '').replace(/<\/markdown>$/, '')}</markdown>`);
        } else {
          sendMsg(msg.conversation_id, `<markdown>❌未找到ID为 \`${targetId}\` 的黑名单记录\n\n${buildBlacklistCard(msg.conversation_id).replace(/^<markdown>/, '').replace(/<\/markdown>$/, '')}</markdown>`);
        }
      }
      else if (content.startsWith('/添加黑名单')) {
        const senderRole = msg.sender?.role || msg.sender?.user_role || msg.sender?.permission;
        const isOwner = senderRole === 'owner' || msg.sender?.is_owner === true;
        if (uid !== 3038 && !isOwner) {
          sendMsg(msg.conversation_id, '❌只有群主或指定用户才能添加黑名单');
          return;
        }
        const match = content.match(/^\/添加黑名单\s*\[(.+?)\]/);
        if (!match) { sendMsg(msg.conversation_id, '⚠️格式：/添加黑名单[用户ID]'); return; }
        const targetId = match[1].trim();
        if (isBlacklisted(msg.conversation_id, targetId)) {
          sendMsg(msg.conversation_id, `<markdown>⚠️ID为 \`${targetId}\` 的用户已在黑名单中\n\n${buildBlacklistCard(msg.conversation_id).replace(/^<markdown>/, '').replace(/<\/markdown>$/, '')}</markdown>`);
        } else {
          const targetName = await fetchUserNameById(targetId);
          addToBlacklist(msg.conversation_id, targetId, targetName, '管理员手动添加');
          sendMsg(msg.conversation_id, `<markdown>✅已将 **${targetName}**（ID：\`${targetId}\`）加入黑名单\n\n${buildBlacklistCard(msg.conversation_id).replace(/^<markdown>/, '').replace(/<\/markdown>$/, '')}</markdown>`);
        }
      }
      else if (content.startsWith('/开启') || content.startsWith('/关闭')) {
        const canUse = await canManage(msg.conversation_id, uid, msg.sender);
        if (!canUse) { sendMsg(msg.conversation_id, '只有群主或管理员才能开关功能'); return; }
        const isEnable = content.startsWith('/开启');
        const match = content.match(/^\/(开启|关闭)\s*\[(.+?)\]/);
        if (!match) {
          sendMsg(msg.conversation_id, buildSwitchTable(msg.conversation_id, `格式：/${isEnable?'开启':'关闭'}[功能名]\n可用功能：${ALL_FEATURES.join('、')}`));
          return;
        }
        const feature = match[2].trim();
        if (!ALL_FEATURES.includes(feature)) {
          sendMsg(msg.conversation_id, buildSwitchTable(msg.conversation_id, `未知功能"${feature}"\n可用功能：${ALL_FEATURES.join('、')}`));
          return;
        }
        setFeature(msg.conversation_id, feature, isEnable);
        sendMsg(msg.conversation_id, buildSwitchTable(msg.conversation_id, `已${isEnable?'开启':'关闭'}功能：${feature}`));
      }
      // 手动禁言
      else if (content.startsWith('/禁言') && !content.startsWith('/禁言列表')) {
        const canUse = uid === 3038 || isOwner || await canManage(msg.conversation_id, uid, msg.sender);
        if (!canUse) { sendMsg(msg.conversation_id, '只有群主、管理员或ID3038才能禁言'); return; }
        const match = content.match(/^\/禁言\s*\[(\d+)\]\s*\[?(\d*)\]?/);
        if (!match) { sendMsg(msg.conversation_id, '格式：`/禁言[用户ID] [分钟]`'); return; }
        const targetId = match[1];
        if (targetId === '3038') { sendMsg(msg.conversation_id, '不能禁言ID3038'); return; }
        const minutes = parseInt(match[2]) || 10;
        const duration = minutes * 60 * 1000;
        const untilTs = Date.now() + duration;
        let realMuted = await realMuteUser(msg.conversation_id, targetId, minutes);
        if (!realMuted) {
          sendMsg(msg.conversation_id, `<markdown>❌禁言失败\n\nAPI返回：机器人不是本群管理员\n\n请在群设置→成员管理中，把机器人设为**管理员**后再试</markdown>`);
          return;
        }
        const targetName = await fetchUserNameById(targetId);
        const data = loadMuteData();
        if (!data[String(msg.conversation_id)]) data[String(msg.conversation_id)] = {};
        data[String(msg.conversation_id)][String(targetId)] = { userName: targetName, reason: '管理员手动禁言', count: 1, until: untilTs, duration, realMuted: true };
        saveMuteData(data);
        sendMsg(msg.conversation_id, `<markdown>🔇 已禁言 **${targetName}**（ID：\`${targetId}\`）\`${minutes}\` 分钟</markdown>`);
      }
      // 手动解除禁言
      else if (content.startsWith('/解除禁言')) {
        const canUse = uid === 3038 || isOwner || await canManage(msg.conversation_id, uid, msg.sender);
        if (!canUse) { sendMsg(msg.conversation_id, '只有群主、管理员或ID3038才能解除禁言'); return; }
        const match = content.match(/^\/解除禁言\s*\[(\d+)\]/);
        if (!match) { sendMsg(msg.conversation_id, '格式：`/解除禁言[用户ID]`'); return; }
        const targetId = match[1];
        await realUnmuteUser(msg.conversation_id, targetId);
        const data = loadMuteData();
        if (data[String(msg.conversation_id)]?.[String(targetId)]) {
          delete data[String(msg.conversation_id)][String(targetId)];
          saveMuteData(data);
        }
        sendMsg(msg.conversation_id, `<markdown>✅ 已解除用户 \`${targetId}\` 的禁言</markdown>`);
      }
      // 禁言列表
      else if (content === '/禁言列表') {
        const data = loadMuteData();
        const list = data[String(msg.conversation_id)] || {};
        const now = Date.now();
        const active = Object.entries(list).filter(([_, v]) => v.until > now);
        if (active.length === 0) { sendMsg(msg.conversation_id, '当前没有被禁言的用户'); return; }
        let reply = `<markdown>## 禁言列表（共\`${active.length}\`人）\n\n| 用户ID | 原因 | 剩余时间 | 真禁言 |\n|--------|------|----------|--------|\n`;
        active.forEach(([uid, info]) => {
          const mins = Math.ceil((info.until - now) / 60000);
          reply += `| \`${uid}\` | ${info.reason} | \`${mins}\`分钟 | ${info.realMuted ? '是' : '否'} |\n`;
        });
        reply += `</markdown>`;
        sendMsg(msg.conversation_id, reply);
      }
      // ==========================================
      return;
    }

    // 按钮交互
    if (event.type === 'message.interaction') {
      const data = event.data || {};
      // 去重：用 conversation_id+message_id+user_id+action_id 作为标识
      const iKey = `${data.conversation_id}_${data.message_id}_${data.user_id}_${data.action_id}`;
      if (seenInteractions.has(iKey)) return;
      seenInteractions.add(iKey);
      if (seenInteractions.size > 200) seenInteractions.clear();
      console.log('🔘 按钮被点击:', data);
      const actionId = data.action_id || '';
      // 投票按钮：action_id 格式为 {voteId}_{optionIndex}
      const voteMatch = actionId.match(/^([^_]+)_(\d+)$/);
      if (voteMatch) {
        const voteId = voteMatch[1];
        const optionIdx = parseInt(voteMatch[2]);
        const voteData = loadVoteData();
        const vote = voteData[voteId];
        if (vote) {
          if (optionIdx >= 0 && optionIdx < vote.options.length) {
            const uid = String(data.user_id);
            if (vote.votes[uid] !== undefined) {
              // 已经投过票了
              await updateButton(data.conversation_id, data.message_id, actionId,
                `❌你已经投过票了`, 'danger', false, 'user', data.user_id);
            } else {
              vote.votes[uid] = optionIdx;
              saveVoteData(voteData);
              // 刷新所有按钮显示票数
              await refreshVoteButtons(vote);
              // 给点击者个人反馈
              const counts = getVoteCounts(vote);
              const total = counts.reduce((a, b) => a + b, 0);
              await updateButton(data.conversation_id, data.message_id, actionId,
                `✅已投 ${vote.options[optionIdx]} (\`${counts[optionIdx]}\`票)`, 'success', false, 'user', data.user_id);
            }
          }
        }
      }
      // 狼人杀按钮
      else if (actionId.startsWith('wr_')) {
        const wrData = loadWR();
        // 获取用户名（尝试多个字段）
        const userName = data.user_name || data.user_display_name || data.nickname || data.sender_name || `用户${data.user_id}`;
        const btnUserId = Number(data.user_id);
        // 加入房间
        if (actionId.startsWith('wr_join_')) {
          const roomId = actionId.replace('wr_join_', '');
          const room = wrData[roomId];
          if (!room) { sendMsg(data.conversation_id, '❌房间不存在'); return; }
          if (room.status !== 'waiting') { sendMsg(data.conversation_id, '❌游戏已开始'); return; }
          if (room.players.length >= 15) { sendMsg(data.conversation_id, '❌房间已满'); return; }
          if (room.players.find(p => p.userId == data.user_id)) { sendMsg(data.conversation_id, `❌${userName} 你已在房间中`); return; }
          room.players.push({ userId: data.user_id, nickname: userName, role: null, alive: true, hasActed: false });
          room.lastActionTime = Date.now();
          saveWR(wrData);
          // 发新的房间卡片（动态更新）
          const card = buildRoomCard(room);
          const btnMsg = card.replace('</markdown>', `\n\n<button action="callback" action_id="wr_join_${roomId}" id="wr_join_${roomId}">🚪 加入房间</button>\n<button action="callback" action_id="wr_start_${roomId}" id="wr_start_${roomId}">▶️ 开始游戏</button></markdown>`);
          sendMsg(room.conversationId, btnMsg);
        }
        // 开始游戏
        else if (actionId.startsWith('wr_start_')) {
          const roomId = actionId.replace('wr_start_', '');
          const room = wrData[roomId];
          if (!room) { sendMsg(data.conversation_id, '❌房间不存在'); return; }
          if (room.creator != data.user_id) { sendMsg(data.conversation_id, '❌只有房主可以开始游戏'); return; }
          if (room.players.length < 4) { sendMsg(data.conversation_id, '❌至少4人才能开始'); return; }
          assignRoles(room);
          room.status = 'night';
          room.day = 1;
          room.nightActions = { wolfVotes: {}, wolfTarget: null, seerCheck: null, witchSave: false, witchPoison: null };
          room.witchUsed = { save: false, poison: false };
          room.lastActionTime = Date.now();
          saveWR(wrData);
          // 私信发身份
          for (const p of room.players) {
            const roleMsg = `<markdown># 🎭 你的身份\n\n## ${ROLE_INFO[p.role].name}\n\n> ${ROLE_INFO[p.role].desc}\n\n**房间号：** \`${roomId}\`\n**第 \`${room.day}\` 天夜晚**</markdown>`;
            sendPrivateMsg(p.userId, roleMsg);
          }
          // 发送黑夜操作面板
          setTimeout(() => sendNightPanels(room), 1500);
          // 大群通知
          sendMsg(room.conversationId, `<markdown># 🌙 黑夜降临\n\n> 第 \`${room.day}\` 天\n> 请各位玩家查看私信使用技能\n> 10分钟无操作游戏自动结束</markdown>`);
        }
        // 开始投票（仅房主，且发言至少1分钟）
        else if (actionId.startsWith('wr_vote_start_')) {
          const roomId = actionId.replace('wr_vote_start_', '');
          const room = wrData[roomId];
          if (!room || room.status !== 'day') { sendMsg(data.conversation_id, '❌不在白天发言阶段'); return; }
          if (room.creator != data.user_id) { sendMsg(data.conversation_id, '❌只有房主可以开始投票'); return; }
          const elapsed = Date.now() - (room.dayStartTime || room.lastActionTime || Date.now());
          if (elapsed < 60000) {
            const remain = Math.ceil((60000 - elapsed) / 1000);
            sendMsg(data.conversation_id, `❌发言时间不足，请再等待 ${remain} 秒`);
            return;
          }
          // 直接内联投票逻辑，避免数据竞争
          room.status = 'voting';
          room.votes = {};
          room.lastActionTime = Date.now();
          saveWR(wrData);
          const alive = room.players.filter(p => p.alive);
          let voteMsg = `<markdown># 🗳️ 投票阶段\n\n> 第 \`${room.day}\` 天\n> 请投票选出要放逐的玩家\n\n`;
          alive.forEach((p, i) => {
            voteMsg += `<button action="callback" action_id="wr_vote_${roomId}_${p.userId}" id="wr_vote_${roomId}_${p.userId}">\`${i + 1}\`. ${p.nickname}</button>\n`;
          });
          voteMsg += `</markdown>`;
          sendMsg(room.conversationId, voteMsg);
        }
        // 投票
        else if (actionId.startsWith('wr_vote_')) {
          const parts = actionId.replace('wr_vote_', '').split('_');
          const roomId = parts[0];
          const targetId = parseInt(parts[1]);
          // 重新加载最新数据
          const freshWR = loadWR();
          const room = freshWR[roomId];
          if (!room || room.status !== 'voting') { sendMsg(data.conversation_id, '❌不在投票阶段'); return; }
          if (!room.players.find(p => p.userId == data.user_id && p.alive)) { sendMsg(data.conversation_id, '❌你不是存活玩家'); return; }
          if (room.votes[data.user_id] !== undefined) { sendMsg(data.conversation_id, '❌你已经投过票了'); return; }
          room.votes[data.user_id] = targetId;
          room.lastActionTime = Date.now();
          saveWR(freshWR);
          const target = room.players.find(p => p.userId == targetId);
          sendMsg(data.conversation_id, `✅已投票给 ${target ? target.nickname : targetId}`);
          const alive = room.players.filter(p => p.alive);
          const allVoted = alive.every(p => room.votes[p.userId] !== undefined);
          if (allVoted) settleVote(roomId);
        }
        // 狼人杀人
        else if (actionId.startsWith('wr_kill_')) {
          const parts = actionId.replace('wr_kill_', '').split('_');
          const roomId = parts[0];
          const targetId = parseInt(parts[1]);
          const room = wrData[roomId];
          if (!room || room.status !== 'night') { setBtn(data, actionId, '❌不在黑夜阶段', 'danger', true); return; }
          const player = room.players.find(p => p.userId == data.user_id);
          if (!player || player.role !== 'wolf' || !player.alive) { setBtn(data, actionId, '❌你不是存活狼人', 'danger', true); return; }
          if (player.hasActed) { setBtn(data, actionId, '❌你今晚已经投票了', 'danger', true); return; }
          room.nightActions.wolfVotes = room.nightActions.wolfVotes || {};
          room.nightActions.wolfVotes[data.user_id] = targetId;
          player.hasActed = true;
          room.lastActionTime = Date.now();
          saveWR(wrData);
          const target = room.players.find(p => p.userId === targetId);
          setBtn(data, actionId, `✅已杀 ${target ? target.nickname : targetId}`, 'success', true);
          checkNightDone(roomId);
        }
        // 预言家查验
        else if (actionId.startsWith('wr_check_')) {
          const parts = actionId.replace('wr_check_', '').split('_');
          const roomId = parts[0];
          const targetId = parseInt(parts[1]);
          const room = wrData[roomId];
          if (!room || room.status !== 'night') { setBtn(data, actionId, '❌不在黑夜阶段', 'danger', true); return; }
          const player = room.players.find(p => p.userId == data.user_id);
          if (!player || player.role !== 'seer' || !player.alive) { setBtn(data, actionId, '❌你不是存活预言家', 'danger', true); return; }
          if (room.nightActions.seerCheck !== null && room.nightActions.seerCheck !== undefined) {
            setBtn(data, actionId, '❌今晚已查验过', 'danger', true); return;
          }
          const target = room.players.find(p => p.userId === targetId);
          room.nightActions.seerCheck = targetId;
          player.hasActed = true;
          room.lastActionTime = Date.now();
          saveWR(wrData);
          const result = target ? (target.role === 'wolf' ? '查杀🐺' : '金水👨‍🌾') : '未知';
          setBtn(data, actionId, `✅${target ? target.nickname : targetId}是${result}`, 'success', true);
          // 详细结果发私信
          sendPrivateMsg(data.user_id, `<markdown># 🔮 查验结果\n\n**${target ? target.nickname : targetId}** 是：\n\n## ${target && target.role === 'wolf' ? '🐺 查杀（狼人）' : '👨‍🌾 金水（好人）'}</markdown>`);
          checkNightDone(roomId);
        }
        // 女巫救人
        else if (actionId.startsWith('wr_save_')) {
          const roomId = actionId.replace('wr_save_', '');
          const room = wrData[roomId];
          if (!room || room.status !== 'night') { setBtn(data, actionId, '❌不在黑夜阶段', 'danger', true); return; }
          const player = room.players.find(p => p.userId == data.user_id);
          if (!player || player.role !== 'witch' || !player.alive) { setBtn(data, actionId, '❌你不是存活女巫', 'danger', true); return; }
          if (player.hasActed) { setBtn(data, actionId, '❌你今晚已行动过', 'danger', true); return; }
          if (room.witchUsed.save) { setBtn(data, actionId, '❌解药已使用', 'danger', true); return; }
          room.nightActions.witchSave = true;
          room.witchUsed.save = true;
          player.hasActed = true;
          room.lastActionTime = Date.now();
          saveWR(wrData);
          setBtn(data, actionId, '💊已使用解药', 'success', true);
          checkNightDone(roomId);
        }
        // 女巫毒人
        else if (actionId.startsWith('wr_poison_')) {
          const parts = actionId.replace('wr_poison_', '').split('_');
          const roomId = parts[0];
          const targetId = parseInt(parts[1]);
          const room = wrData[roomId];
          if (!room || room.status !== 'night') { setBtn(data, actionId, '❌不在黑夜阶段', 'danger', true); return; }
          const player = room.players.find(p => p.userId == data.user_id);
          if (!player || player.role !== 'witch' || !player.alive) { setBtn(data, actionId, '❌你不是存活女巫', 'danger', true); return; }
          if (player.hasActed) { setBtn(data, actionId, '❌你今晚已行动过', 'danger', true); return; }
          if (room.witchUsed.poison) { setBtn(data, actionId, '❌毒药已使用', 'danger', true); return; }
          room.nightActions.witchPoison = targetId;
          room.witchUsed.poison = true;
          player.hasActed = true;
          room.lastActionTime = Date.now();
          saveWR(wrData);
          const target = room.players.find(p => p.userId === targetId);
          setBtn(data, actionId, `🧪已毒 ${target ? target.nickname : targetId}`, 'success', true);
          checkNightDone(roomId);
        }
        // 女巫跳过
        else if (actionId.startsWith('wr_skip_')) {
          const roomId = actionId.replace('wr_skip_', '');
          const room = wrData[roomId];
          if (!room || room.status !== 'night') { setBtn(data, actionId, '❌不在黑夜阶段', 'danger', true); return; }
          const player = room.players.find(p => p.userId == data.user_id);
          if (!player || player.role !== 'witch' || !player.alive) { setBtn(data, actionId, '❌你不是存活女巫', 'danger', true); return; }
          if (player.hasActed) { setBtn(data, actionId, '❌你今晚已行动过', 'danger', true); return; }
          player.hasActed = true;
          room.lastActionTime = Date.now();
          saveWR(wrData);
          setBtn(data, actionId, '⏭️已跳过本轮', 'success', true);
          checkNightDone(roomId);
        }
        // 猎人开枪
        else if (actionId.startsWith('wr_shoot_')) {
          const parts = actionId.replace('wr_shoot_', '').split('_');
          const roomId = parts[0];
          const targetId = parseInt(parts[1]);
          const room = wrData[roomId];
          if (!room) { setBtn(data, actionId, '❌房间不存在', 'danger', true); return; }
          const player = room.players.find(p => p.userId == data.user_id);
          if (!player || player.role !== 'hunter') { setBtn(data, actionId, '❌你不是猎人', 'danger', true); return; }
          if (player.hunterUsed) { setBtn(data, actionId, '❌你已经开过枪了', 'danger', true); return; }
          const target = room.players.find(p => p.userId === targetId);
          if (target) {
            target.alive = false;
            player.hunterUsed = true;
            room.deadInfo.push({ userId: targetId, reason: '被猎人开枪带走', day: room.day });
            await wrMuteUser(room, targetId);
            saveWR(wrData);
            setBtn(data, actionId, `🏹已带走 ${target.nickname}`, 'success', true);
            sendMsg(room.conversationId, `<markdown># 🏹 猎人开枪\n\n**${player.nickname}** 开枪带走了 **${target.nickname}**！</markdown>`);
            const winner = checkWin(room);
            if (winner) {
              room.status = 'ended';
              room.winner = winner;
              saveWR(wrData);
              await unmuteAllPlayers(room);
              const winMsg = winner === 'good' ? '🎉 好人阵营胜利！' : '🐺 狼人阵营胜利！';
              sendMsg(room.conversationId, `<markdown># 🏁 游戏结束\n\n## ${winMsg}\n\n**身份揭晓：**\n${room.players.map(p => `${p.alive ? '✅' : '💀'} ${p.nickname} - ${ROLE_INFO[p.role].name}`).join('\n')}</markdown>`);
            }
          }
        }
      }
      // DIY创建流程按钮
      else if (actionId.startsWith('diy_')) {
        const btnUserId = Number(data.user_id);
        const state = diyCreating[btnUserId];
        if (!state) {
          sendMsg(data.conversation_id, '❌创建状态已过期，请重新输入 /DIY[指令名]');
          return;
        }
        if (String(state.cid) !== String(data.conversation_id)) return;

        // 类型选择
        if (actionId.startsWith('diy_type_')) {
          const type = actionId.replace('diy_type_', '').split('_')[0];
          if (type === 'text') {
            state.type = 'text';
            state.step = 'content';
            sendMsg(data.conversation_id, `<markdown>📝 已选择**文本回复**类型\n\n请直接发送指令回复的内容（支持全部API变量）：\n\n**基础：**\`{用户名}\` \`{用户ID}\` \`{群ID}\` \`{时间}\` \`{日期}\` \`{随机数}\`\n**机器人：**\`{机器人昵称}\` \`{机器人ID}\` \`{机器人BotID}\`\n**群信息：**\`{群名称}\` \`{群成员数}\` \`{在线人数}\` \`{在线用户数}\`\n**消息：**\`{最新消息}\` \`{最新消息发送者}\`\n\n发送内容后会显示确认面板</markdown>`);
          } else if (type === 'random') {
            state.type = 'random';
            state.step = 'content';
            sendMsg(data.conversation_id, `<markdown>🎲 已选择**随机回复**类型\n\n请发送多条回复内容，用 \`|||\` 分隔，例如：\n> 早上好|||中午好|||晚上好\n\n**同样支持全部API变量：**\n基础：\`{用户名}\` \`{用户ID}\` \`{群ID}\` \`{时间}\` \`{日期}\` \`{随机数}\`\n机器人：\`{机器人昵称}\` \`{机器人ID}\` \`{机器人BotID}\`\n群信息：\`{群名称}\` \`{群成员数}\` \`{在线人数}\` \`{在线用户数}\`\n消息：\`{最新消息}\` \`{最新消息发送者}\`</markdown>`);
          } else if (type === 'info') {
            state.type = 'info';
            state.step = 'info_subtype';
            const infoMsg = `<markdown>📊 已选择**群信息查询**类型\n\n请选择查询内容：\n\n<button action="callback" action_id="diy_info_online_${btnUserId}" id="diy_info_online_${btnUserId}">👥 在线人数+列表</button>\n<button action="callback" action_id="diy_info_members_${btnUserId}" id="diy_info_members_${btnUserId}">📋 全部成员列表</button>\n<button action="callback" action_id="diy_cancel_${btnUserId}" id="diy_cancel_${btnUserId}">❌ 取消</button></markdown>`;
            sendMsg(data.conversation_id, infoMsg);
          } else if (type === 'combo') {
            state.type = 'combo';
            state.step = 'combo_select';
            state.selectedModules = [];
            const comboMsg = `<markdown>🔗 已选择**API组合卡片**类型\n\n点击选择要包含的数据模块（可多选，再次点击取消）：\n\n<button action="callback" action_id="diy_combo_mod_group_${btnUserId}" id="diy_combo_mod_group_${btnUserId}">📋 群信息</button>\n<button action="callback" action_id="diy_combo_mod_members_${btnUserId}" id="diy_combo_mod_members_${btnUserId}">👥 成员列表</button>\n<button action="callback" action_id="diy_combo_mod_online_${btnUserId}" id="diy_combo_mod_online_${btnUserId}">🟢 在线列表</button>\n<button action="callback" action_id="diy_combo_mod_msgs_${btnUserId}" id="diy_combo_mod_msgs_${btnUserId}">💬 最新消息</button>\n<button action="callback" action_id="diy_combo_mod_bot_${btnUserId}" id="diy_combo_mod_bot_${btnUserId}">🤖 机器人信息</button>\n<button action="callback" action_id="diy_combo_mod_join_${btnUserId}" id="diy_combo_mod_join_${btnUserId}">📨 入群申请</button>\n<button action="callback" action_id="diy_combo_mod_user_${btnUserId}" id="diy_combo_mod_user_${btnUserId}">👤 触发者信息</button>\n<button action="callback" action_id="diy_combo_mod_convs_${btnUserId}" id="diy_combo_mod_convs_${btnUserId}">📚 机器人群列表</button>\n\n<button action="callback" action_id="diy_combo_confirm_${btnUserId}" id="diy_combo_confirm_${btnUserId}">✅ 确认组合（已选0个）</button>\n<button action="callback" action_id="diy_cancel_${btnUserId}" id="diy_cancel_${btnUserId}">❌ 取消</button></markdown>`;
            sendMsg(data.conversation_id, comboMsg);
          } else if (type === 'ai') {
            state.type = 'ai';
            state.step = 'ai_prompt';
            sendMsg(data.conversation_id, `<markdown>🤖 已选择**AI协助创建**\n\n请描述你想要的指令功能，例如：\n> 做一个群欢迎指令，有人进来就@他并欢迎\n> 做一个随机抽签指令\n> 做一个群数据日报\n\nAI会根据可用能力自动生成指令配置，描述越详细越好~</markdown>`);
          }
          return;
        }

        // info子类型选择
        if (actionId.startsWith('diy_info_')) {
          const subType = actionId.replace('diy_info_', '').split('_')[0];
          state.content = subType;
          state.step = 'confirm';
          const subLabel = subType === 'online' ? '在线人数+列表' : '全部成员列表';
          const confirmMsg = `<markdown># 确认创建DIY指令\n\n**指令名：**/${state.name}\n**类型：**群信息查询\n**查询内容：**${subLabel}\n\n<button action="callback" action_id="diy_confirm_${btnUserId}" id="diy_confirm_${btnUserId}">✅ 确认创建</button>\n<button action="callback" action_id="diy_cancel_${btnUserId}" id="diy_cancel_${btnUserId}">❌ 取消</button></markdown>`;
          sendMsg(data.conversation_id, confirmMsg);
          return;
        }

        // API组合卡片 - 模块选择
        if (actionId.startsWith('diy_combo_mod_')) {
          const mod = actionId.replace('diy_combo_mod_', '').split('_')[0];
          const idx = state.selectedModules.indexOf(mod);
          if (idx >= 0) state.selectedModules.splice(idx, 1);
          else state.selectedModules.push(mod);
          const modLabels = { group:'📋 群信息', members:'👥 成员列表', online:'🟢 在线列表', msgs:'💬 最新消息', bot:'🤖 机器人信息', join:'📨 入群申请', user:'👤 触发者信息', convs:'📚 机器人群列表' };
          let panel = `<markdown>🔗 API组合卡片 - 选择数据模块（已选${state.selectedModules.length}个）\n\n点击选择或取消：\n\n`;
          ['group','members','online','msgs','bot','join','user','convs'].forEach(m => {
            const selected = state.selectedModules.includes(m);
            panel += `<button action="callback" action_id="diy_combo_mod_${m}_${btnUserId}" id="diy_combo_mod_${m}_${btnUserId}">${selected ? '✅' : '⬜'} ${modLabels[m]}</button>\n`;
          });
          panel += `\n<button action="callback" action_id="diy_combo_confirm_${btnUserId}" id="diy_combo_confirm_${btnUserId}">✅ 确认组合</button>\n<button action="callback" action_id="diy_cancel_${btnUserId}" id="diy_cancel_${btnUserId}">❌ 取消</button></markdown>`;
          sendMsg(data.conversation_id, panel);
          return;
        }

        // API组合卡片 - 确认组合，进入标题输入
        if (actionId.startsWith('diy_combo_confirm_')) {
          if (!state.selectedModules || state.selectedModules.length === 0) {
            sendMsg(data.conversation_id, '❌请至少选择一个数据模块');
            return;
          }
          state.step = 'combo_title';
          const modLabels = { group:'群信息', members:'成员列表', online:'在线列表', msgs:'最新消息', bot:'机器人信息', join:'入群申请', user:'触发者信息', convs:'机器人群列表' };
          const selected = state.selectedModules.map(m => modLabels[m]).join('、');
          sendMsg(data.conversation_id, `<markdown>🔗 已选择模块：${selected}\n\n请发送卡片标题（直接发文字即可）：\n> 例如：群动态日报、本群概况、实时数据\n\n发送标题后还可以输入附加说明文字</markdown>`);
          return;
        }

        // 确认创建
        if (actionId.startsWith('diy_confirm_')) {
          if (state.type === 'combo') {
            if (!state.title || !state.selectedModules || state.selectedModules.length === 0) {
              sendMsg(data.conversation_id, '❌信息不完整，请重新创建');
              delete diyCreating[btnUserId];
              return;
            }
          } else if (!state.type || (!state.content && state.type !== 'info' && state.type !== 'ai')) {
            sendMsg(data.conversation_id, '❌信息不完整，请重新创建');
            delete diyCreating[btnUserId];
            return;
          }
          if (state.type === 'random' && !state.content.includes('|||')) {
            sendMsg(data.conversation_id, '❌随机回复类型需要用 ||| 分隔多条内容，请重新创建');
            delete diyCreating[btnUserId];
            return;
          }
          const typeLabel = { text: '文本回复', random: '随机回复', info: '群信息查询', combo: 'API组合卡片', ai: 'AI对话' }[state.type] || state.type;
          let description;
          if (state.type === 'info') {
            description = state.content === 'online' ? '查询本群在线人数和列表' : '查询本群全部成员列表';
          } else if (state.type === 'combo') {
            const modLabels = { group:'群信息', members:'成员列表', online:'在线列表', msgs:'最新消息', bot:'机器人信息', join:'入群申请', user:'触发者信息', convs:'机器人群列表' };
            description = `${state.title}（${state.selectedModules.map(m => modLabels[m]).join('+')}）`;
          } else if (state.type === 'ai') {
            description = state.description || 'AI智能对话，输入内容即可获得真实AI回复';
          } else {
            description = state.description || state.content.slice(0, 30);
          }
          const cmd = {
            type: state.type,
            content: state.content,
            creator: data.user_name || data.user_display_name || `用户${btnUserId}`,
            creatorId: btnUserId,
            createdAt: new Date().toISOString(),
            description
          };
          if (state.params && state.params.length > 0) cmd.params = state.params;
          if (state.type === 'combo') {
            cmd.title = state.title;
            cmd.selectedModules = state.selectedModules;
          }
          saveDIYCommand(state.cid, state.name, cmd);
          delete diyCreating[btnUserId];
          sendMsg(data.conversation_id, buildDIYTable(state.cid, `✅已创建"/${state.name}"指令（${typeLabel}）`));
          return;
        }

        // 取消创建
        if (actionId.startsWith('diy_cancel_')) {
          delete diyCreating[btnUserId];
          sendMsg(data.conversation_id, '❌已取消创建');
          return;
        }
      }
      // 帮助分类按钮
      else if (actionId.startsWith('help_')) {
        let detail = '';
        const isClassGroup = String(data.conversation_id) === '4307';
        const adminLabel = isClassGroup ? '班干部及老师' : '管理员';
        if (actionId === 'help_common') {
          const werewolfLink = isClassGroup ? '' : `<link action="callback" action_id="help_game">游戏娱乐</link>：狼人杀游戏\n`;
          const diyLink = isClassGroup ? '' : `<link action="callback" action_id="help_diy">自制指令</link>：查看、创建和管理DIY指令\n`;
          detail = `<markdown>## 常用指令分类
<link action="callback" action_id="help_query">基础查询</link>：帮助菜单、在线人数、群活跃
<link action="callback" action_id="help_checkin">签到运势</link>：每日签到查看专属运势
<link action="callback" action_id="help_life">生活工具</link>：天气查询、AI绘图、音乐播放
${werewolfLink}<link action="callback" action_id="help_list">列表查看</link>：黑名单、违禁词列表
${diyLink}> 点击分类查看详细指令</markdown>`;
        } else if (actionId === 'help_query') {
          detail = `<markdown>## 基础查询
\`/help\`：查看本菜单
\`/群内在线人数\`：查看当前群内在线人数和在线用户列表
\`/今日群活跃\`：查看今日群活跃统计和发言榜
> 所有人可用</markdown>`;
        } else if (actionId === 'help_checkin') {
          detail = `<markdown>## 签到运势
\`/签到\`：签到查看专属运势（幸运星、幸运数字、幸运色、宜做事项）
> 每人每天限签一次，所有人可用</markdown>`;
        } else if (actionId === 'help_life') {
          detail = `<markdown>## 生活工具
\`/天气[城市]\`：查询指定城市的天气预报
\`/绘图[内容，风格]\`：AI绘图，内容为描述，风格可选（如赛博朋克、水彩、油画等）
\`/播放音乐[音乐名]\`：搜索并播放音乐（网易云音乐）
> 所有人可用</markdown>`;
        } else if (actionId === 'help_game') {
          detail = `<markdown>## 游戏娱乐
\`/狼人杀\`：开始狼人杀游戏（6-10人，含预言家、女巫、猎人等角色）
\`/结束房间[房间号]\`：结束狼人杀房间（房主/群主/${adminLabel}/ID3038）
\`/心灵感应[主题]\`：出题者给3个答案，其他人猜，测群友默契度
\`/谁是卧底\`：经典聚会游戏群聊版，分配词语+描述+投票找卧底
\`/故事接龙[主题]\`：AI开头，每人接一句，最后生成完整故事
\`/命运抉择[主题]\`：AI生成剧情场景，群成员投票选择，多结局互动冒险
> 所有人可发起，创意游戏需AI参与</markdown>`;
        } else if (actionId === 'help_list') {
          detail = `<markdown>## 列表查看
\`/黑名单\`：查看本群黑名单列表
\`/违禁词表格\`：查看本群违禁词列表
> 所有人可查看</markdown>`;
        } else if (actionId === 'help_vote') {
          detail = `<markdown>## 投票管理
\`/投票[单群，标题，选项1，选项2...]\`：本群发起投票
\`/投票[全局，标题，选项1，选项2...]\`：发到所有群（仅ID 3038）
\`/投票结果[投票ID]\`：查看指定投票结果（不带ID看本群最新）
\`/结束投票[投票ID]\`：结束指定投票（不带ID结束本群最新）
> 仅群主、${adminLabel}、ID 3038</markdown>`;
        } else if (actionId === 'help_forbidden') {
          detail = `<markdown>## 违禁词管理
\`/增加违禁词[词]\`：添加违禁词，说2次自动拉黑
\`/删除违禁词[词]\`：删除违禁词
\`/违禁词表格\`：查看所有违禁词
> 仅群主、${adminLabel}、ID 3038</markdown>`;
        } else if (actionId === 'help_blacklist') {
          detail = `<markdown>## 黑名单管理
\`/黑名单\`：查看黑名单列表
\`/添加黑名单[用户ID]\`：手动拉黑
\`/删除黑名单[用户ID]\`：解除拉黑
> 黑名单用户不能用指令但可聊天，仅群主和ID 3038可管理</markdown>`;
        } else if (actionId === 'help_other') {
          detail = `<markdown>## 其他管理
\`/进群自动发送[内容]\`：新人进群自动发消息，支持\`<@成员>\`
\`/全局推送[标题，内容]\`：向所有群推送，\`\\n\`换行
> 进群欢迎仅${adminLabel}；全局推送仅ID 3038</markdown>`;
        } else if (actionId === 'help_mute') {
          detail = `<markdown>## 禁言管理
\`/禁言[用户ID] [分钟]\`：手动禁言用户，默认10分钟
\`/解除禁言[用户ID]\`：手动解除禁言
\`/禁言列表\`：查看当前被禁言的用户
> 自动禁言：违禁词4次或刷屏15条，时间累加
> 仅群主、${adminLabel}、ID 3038可用</markdown>`;
        } else if (actionId === 'help_switch') {
          detail = `<markdown>## 功能开关
\`/开启[功能名]\`：开启指定功能
\`/关闭[功能名]\`：关闭指定功能
可用功能：签到、天气、投票、违禁词检测、进群欢迎、群在线人数
> 仅群主或${adminLabel}可用</markdown>`;
        } else if (actionId === 'help_diy' && String(data.conversation_id) !== '4307') {
          detail = `<markdown>## 自制指令（DIY）
\`/DIY[指令名]\`：创建本群自制指令，通过按钮引导设置
\`/自制功能\`：查看本群所有自制指令列表
\`/删除DIY[指令名]\`：删除指定自制指令
**支持四种类型：**
- 📝 文本回复：触发时回复固定文本，支持全部API变量
- 🎲 随机回复：从多条文本中随机回复一条，支持变量
- 📊 群信息查询：查询在线人数或成员列表
- 🔗 API组合卡片：像搭积木一样组合多个API数据模块
- 🤖 AI协助创建：描述需求，AI自动生成指令配置（支持复杂需求和API组合）
**全部可用变量（调用KukeChat API）：**
基础：\`{用户名}\` \`{用户ID}\` \`{群ID}\` \`{时间}\` \`{日期}\` \`{随机数}\`
机器人：\`{机器人昵称}\` \`{机器人ID}\` \`{机器人BotID}\` \`{机器人群数}\` \`{机器人群列表}\`
群信息：\`{群名称}\` \`{群成员数}\` \`{在线人数}\` \`{在线用户数}\` \`{入群申请数}\`
用户：\`{用户信息}\` \`{用户信息[ID]}\`
列表：\`{成员列表}\` \`{在线列表}\` \`{全局在线列表}\` \`{消息列表}\`
消息：\`{最新消息}\` \`{最新消息发送者}\`
**消息元素（可在内容中使用）：**
@用户用 at 标签、@所有人用 at_all 标签、图片用 img 标签、链接用 link 标签
> 删除仅群主和ID 3038可用</markdown>`;
        }
        if (detail) sendMsg(data.conversation_id, detail);
      }
      return;
    }

    // 进群事件（兼容多种可能的事件名）
    const joinEvents = ['member.joined', 'conversation.member.joined', 'user.joined', 'member.added', 'conversation.member_added', 'group.member.joined', 'conversation.user.joined'];
    if (joinEvents.includes(event.type)) {
      const convId = event.data.conversation_id;
      const newUserId = event.data.user_id || (event.data.user && event.data.user.id);
      const welcomeData = loadWelcomeData();
      let welcome = welcomeData[String(convId)];
      if (isFeatureEnabled(convId, '进群欢迎')) {
        // 没有自定义欢迎语时用默认的
        if (!welcome) {
          welcome = `<at id="${newUserId}" />，欢迎进群~/help查看全部指令`;
        } else {
          // 替换<@成员>为at新成员
          if (newUserId) {
            welcome = welcome.replace(/<@成员>/g, `<at id="${newUserId}" />`);
          }
        }
        // 自动包裹markdown标签（如果用户内容本身没有）
        const content = welcome.includes('<markdown>') ? welcome : `<markdown>${welcome}</markdown>`;
        sendMsg(convId, content);
      }
      console.log('👋 进群事件:', event.type, event.data);
      return;
    }

    // 禁言状态变化（群主/管理员手动解除禁言时同步）
    if (event.type === 'group.member.mute_updated') {
      const cid = event.data.conversation_id;
      const userId = event.data.user_id;
      const muted = event.data.muted;
      if (muted === false && userId) {
        // 手动解除禁言，同步本地记录
        const data = loadMuteData();
        if (data[String(cid)]?.[String(userId)]) {
          delete data[String(cid)][String(userId)];
          saveMuteData(data);
          console.log(`同步解除禁言: 群${cid} 用户${userId}（管理员手动操作）`);
        }
      }
    }

    // 未知事件日志（方便调试）
    if (event.type !== 'pong') {
      console.log('[未知事件]', event.type, JSON.stringify(event.data).slice(0, 300));
    }
  });

  ws.on('close', () => {
    console.log('❌ 连接断开，3秒后重连...');
    isConnecting = false;
    if (globalWs === ws) globalWs = null;
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('⚠️ 连接错误:', err.message);
  });
}

// 启动
connect();

// HTTP 服务器（用于 Render 健康检查，防止休眠）
const http = require('http');
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading page');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('KukeChat Bot is running\n');
  }
});
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
  console.log(`网页版: http://localhost:${PORT}`);
});

// 狼人杀超时检测：每10秒检查一次，10分钟无操作强制结束
setInterval(async () => {
  const data = loadWR();
  let changed = false;
  for (const roomId of Object.keys(data)) {
    const room = data[roomId];
    if (room.status !== 'ended') {
      const idleMs = Date.now() - room.lastActionTime;
      console.log(`[狼人杀超时检测] 房间${roomId} 状态=${room.status} 空闲=${Math.round(idleMs/1000)}秒`);
      if (idleMs > WR_TIMEOUT) {
        room.status = 'ended';
        room.winner = 'timeout';
        changed = true;
        console.log(`[狼人杀超时] 房间${roomId} 已超时结束`);
        await unmuteAllPlayers(room);
        sendMsg(room.conversationId, `<markdown># ⏰ 游戏超时结束\n\n> 10分钟无任何操作，游戏自动结束\n\n**身份揭晓：**\n${room.players.map(p => `${p.alive ? '✅' : '💀'} ${p.nickname} - ${p.role ? ROLE_INFO[p.role].name : '未分配'}`).join('\n')}</markdown>`);
      }
    }
  }
  if (changed) saveWR(data);
}, 10000);







