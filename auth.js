// 认证逻辑 — 注册 / 登录
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dbModule = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'G3m8Wx085e0Sl8QpYE1Ng94XL3xwhpgd3QvFYw-QzvcmMtXX568gl_gDlszBF49_';
const JWT_EXPIRES = '7d';

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

module.exports = { register, login, refreshToken, verifyToken, JWT_SECRET };
