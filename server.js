// 身心健康评估 — 后端服务
const express = require('express');
const path = require('path');
const cors = require('cors');
const dbModule = require('./db');
const auth = require('./auth');
const { authMiddleware } = require('./middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 静态文件服务 — PWA 前端
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
  }
}));

// SPA fallback — 非 API 路径都返回 index.html
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const result = await auth.register(username, email, password);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = await auth.login(username, password);
    if (result.error) return res.status(401).json({ error: result.error });
    res.json(result);
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

// 微信登录：用 code 换 JWT
app.post('/api/auth/wechat', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: '授权码缺失' });
    const result = await auth.wechatLogin(code);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    console.error('微信登录错误:', e.message, e.stack);
    res.status(500).json({ error: '微信登录失败，请重试' });
  }
});

// 返回微信 OAuth 配置（前端用，不暴露 secret）
app.get('/api/auth/wechat/config', (req, res) => {
  const appId = process.env.WECHAT_APPID || '';
  if (!appId) return res.status(500).json({ error: '微信登录未配置' });
  res.json({
    appId,
    scope: 'snsapi_userinfo',
    // 前端回调地址（微信授权后跳转的页面）
    redirectUri: process.env.WECHAT_REDIRECT_URI || (req.protocol + '://' + req.get('host') + '/wechat-callback.html')
  });
});

app.post('/api/auth/refresh', authMiddleware, (req, res) => {
  res.json(auth.refreshToken(req.userId, req.username));
});

app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    await dbModule.getDb();
    const user = dbModule.get('SELECT id, username, email, created_at FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const count = dbModule.get('SELECT COUNT(*) as total FROM assessments WHERE user_id = ?', [req.userId]);
    res.json({ ...user, assessmentCount: count ? count.total : 0 });
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

app.get('/api/assessments', authMiddleware, async (req, res) => {
  try {
    await dbModule.getDb();
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const records = dbModule.all('SELECT * FROM assessments WHERE user_id = ? ORDER BY ts DESC LIMIT ? OFFSET ?', [req.userId, limit, offset]);
    res.json(records);
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

app.get('/api/assessments/:localId', authMiddleware, async (req, res) => {
  try {
    await dbModule.getDb();
    const record = dbModule.get('SELECT * FROM assessments WHERE user_id = ? AND local_id = ?', [req.userId, parseInt(req.params.localId)]);
    if (!record) return res.status(404).json({ error: '记录不存在' });
    res.json(record);
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/assessments/sync', authMiddleware, async (req, res) => {
  try {
    await dbModule.getDb();
    const { records } = req.body || {};
    if (!Array.isArray(records) || records.length === 0) {
      return res.json({ synced: 0, message: '无数据需要同步' });
    }

    let synced = 0;
    for (const r of records) {
      dbModule.run(
        'INSERT OR REPLACE INTO assessments (user_id, local_id, ts, date, scores, causes, sugg, weather, modifiers, raw_scores) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          req.userId, r.id, r.ts, r.date || (r.ts ? r.ts.slice(0, 10) : ''),
          JSON.stringify(r.scores || {}),
          JSON.stringify(r.causes || []),
          JSON.stringify(r.sugg || {}),
          r.weather ? JSON.stringify(r.weather) : null,
          r.modifiers ? JSON.stringify(r.modifiers) : null,
          r.rawScores ? JSON.stringify(r.rawScores) : null
        ]
      );
      synced++;
    }
    res.json({ synced, message: `成功同步 ${synced} 条记录` });
  } catch (e) {
    console.error('Sync error:', e.message, e.stack);
    res.status(500).json({ error: '同步失败: ' + e.message });
  }
});

app.post('/api/behavior/batch', authMiddleware, async (req, res) => {
  try {
    await dbModule.getDb();
    const { logs } = req.body || {};
    if (!Array.isArray(logs) || logs.length === 0) return res.json({ synced: 0 });

    let synced = 0;
    for (const log of logs) {
      dbModule.run('INSERT INTO behavior_logs (user_id, action, detail, session_id, client_ts) VALUES (?, ?, ?, ?, ?)', [
        req.userId, log.action,
        log.detail ? JSON.stringify(log.detail) : null,
        log.sessionId || null,
        log.ts || Date.now()
      ]);
      synced++;
    }
    res.json({ synced });
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    await dbModule.getDb();
    const ta = dbModule.get('SELECT COUNT(*) as total FROM assessments WHERE user_id = ?', [req.userId]);
    const td = dbModule.get('SELECT COUNT(DISTINCT date) as total FROM assessments WHERE user_id = ?', [req.userId]);
    const dc = dbModule.all("SELECT date, COUNT(*) as count FROM assessments WHERE user_id = ? AND date >= date('now', '-30 days') GROUP BY date ORDER BY date ASC", [req.userId]);
    const ac = dbModule.all('SELECT action, COUNT(*) as count FROM behavior_logs WHERE user_id = ? GROUP BY action ORDER BY count DESC', [req.userId]);
    res.json({
      totalAssessments: ta ? ta.total : 0,
      totalDays: td ? td.total : 0,
      dailyCounts: dc || [],
      topActions: (ac || []).slice(0, 10)
    });
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

dbModule.getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`服务器已启动: http://localhost:${PORT}`);
    console.log(`健康检查: http://localhost:${PORT}/api/health`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});
