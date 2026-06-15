// 认证逻辑 — 注册 / 登录
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dbModule = require('./db');
const https = require('https');
const url = require('url');

const JWT_SECRET = process.env.JWT_SECRET || 'G3m8Wx085e0Sl8QpYE1Ng94XL3xwhpgd3QvFYw-QzvcmMtXX568gl_gDlszBF49_';
const JWT_EXPIRES = '7d';

// 微信 OAuth 配置（从环境变量读取）
const WECHAT_APPID = process.env.WECHAT_APPID || '';
const WECHAT_SECRET = process.env.WECHAT_SECRET || '';
const WECHAT_REDIRECT_URI = process.env.WECHAT_REDIRECT_URI || '';

// 微信 OAuth：用 code 换 openid，获取用户信息，自动注册/登录
async function wechatLogin(code) {
  if (!WECHAT_APPID || !WECHAT_SECRET) {
    return { error: '微信登录未配置，请联系管理员' };
  }
  if (!code) {
    return { error: '微信授权码缺失' };
  }

  // 1. code → access_token + openid
  const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${WECHAT_APPID}&secret=${WECHAT_SECRET}&code=${code}&grant_type=authorization_code`;
  let tokenData;
  try {
    tokenData = await httpGet(tokenUrl);
  } catch (e) {
    return { error: '微信授权请求失败：' + e.message };
  }

  if (tokenData.errcode) {
    return { error: '微信授权失败（' + tokenData.errcode + '）：' + tokenData.errmsg };
  }

  const { access_token, openid, unionid } = tokenData;

  // 2. 获取用户信息
  const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`;
  let userInfo;
  try {
    userInfo = await httpGet(userInfoUrl);
  } catch (e) {
    // 如果获取用户信息失败，至少用 openid 登录
    console.warn('微信用户信息获取失败：', e.message);
  }

  const nickname = userInfo && !userInfo.errcode ? userInfo.nickname || ('wx_' + openid.slice(-8)) : ('wx_' + openid.slice(-8));
  const avatar = userInfo && !userInfo.errcode ? userInfo.headimgurl || '' : '';

  await dbModule.getDb();

  // 3. 查找已有用户（优先 unionid，其次 openid）
  let user = null;
  if (unionid) {
    user = dbModule.get('SELECT id, username, email, avatar FROM users WHERE wechat_unionid = ?', [unionid]);
  }
  if (!user && openid) {
    user = dbModule.get('SELECT id, username, email, avatar FROM users WHERE wechat_openid = ?', [openid]);
  }

  if (user) {
    // 更新头像（如果微信返回了新的）
    if (avatar && avatar !== user.avatar) {
      dbModule.run('UPDATE users SET avatar = ?, updated_at = datetime(\'now\') WHERE id = ?', [avatar, user.id]);
      user.avatar = avatar;
    }
    // 确保 openid/unionid 是最新的
    if (unionid && !user.wechat_unionid) {
      dbModule.run('UPDATE users SET wechat_unionid = ? WHERE id = ?', [unionid, user.id]);
    }
  } else {
    // 4. 新用户：自动注册
    const baseName = nickname.replace(/[^\w\u4e00-\u9fa5]/g, '').substring(0, 20) || '微信用户';
    let username = baseName;
    let counter = 1;
    while (dbModule.get('SELECT id FROM users WHERE username = ?', [username])) {
      username = baseName + counter;
      counter++;
    }

    const result = dbModule.run(
      'INSERT INTO users (username, email, password_hash, wechat_openid, wechat_unionid, avatar, provider) VALUES (?, NULL, ?, ?, ?, ?, ?)',
      [username, '', openid || '', unionid || '', avatar || '', 'wechat']
    );
    user = { id: result.lastInsertRowid, username, email: '', avatar };
  }

  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return {
    token,
    user: { id: user.id, username: user.username, email: user.email || '', avatar: user.avatar || '' }
  };
}

// 简易 httpGet 封装（WeChat API 用，不依赖 axios）
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('解析响应失败：' + data.substring(0, 100)));
        }
      });
    }).on('error', reject);
  });
}

async function register(username, email, password) {
  await dbModule.getDb();

  if (!username || username.length < 2 || username.length > 30) {
    return { error: '用户名需 2-30 个字符' };
  }
  if (password && password.length < 6) {
    return { error: '密码至少 6 位' };
  }

  const existing = dbModule.get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return { error: '用户名已被注册' };

  if (email) {
    const emailExisting = dbModule.get('SELECT id FROM users WHERE email = ?', [email]);
    if (emailExisting) return { error: '邮箱已被注册' };
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = dbModule.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email || null, passwordHash]);

  const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return { token, user: { id: result.lastInsertRowid, username, email: email || '' } };
}

async function login(username, password) {
  await dbModule.getDb();

  if (!username || !password) return { error: '请输入用户名和密码' };

  const user = dbModule.get('SELECT id, username, email, password_hash FROM users WHERE username = ? OR email = ?', [username, username]);
  if (!user) return { error: '用户不存在' };
  if (!bcrypt.compareSync(password, user.password_hash)) return { error: '密码错误' };

  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return { token, user: { id: user.id, username: user.username, email: user.email || '' } };
}

function refreshToken(userId, username) {
  const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return { token };
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

module.exports = { register, login, wechatLogin, refreshToken, verifyToken, JWT_SECRET };
