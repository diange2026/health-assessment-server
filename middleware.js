// JWT 认证中间件
const { verifyToken } = require('./auth');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }

  req.userId = decoded.userId;
  req.username = decoded.username;
  next();
}

module.exports = { authMiddleware };
