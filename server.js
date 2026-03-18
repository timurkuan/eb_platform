/**
 * ЭО Платформа — Node.js + MySQL сервері
 * npm start → http://localhost:3000
 */

'use strict';

require('dotenv').config();

const express     = require('express');
const mysql       = require('mysql2/promise');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const cookieParser= require('cookie-parser');
const cors        = require('cors');
const path        = require('path');
const fs          = require('fs');

const app = express();
const PORT    = process.env.PORT    || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'eo_platform_secret_key_2025';

/* ══════════════════════════════════════════
   MySQL байланысы
══════════════════════════════════════════ */
const dbConfig = {
  host    : process.env.DB_HOST     || 'localhost',
  port    : process.env.DB_PORT     || 3306,
  user    : process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'eo_platform',
  charset : 'utf8mb4',
  waitForConnections: true,
  connectionLimit   : 10,
  timezone          : '+00:00',
};

let pool;
async function getPool() {
  if (!pool) pool = mysql.createPool(dbConfig);
  return pool;
}

/* ══════════════════════════════════════════
   Middleware
══════════════════════════════════════════ */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));  // ЭО HTML үлкен болуы мүмкін
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ══════════════════════════════════════════
   Admin seed — бірінші іске қосқанда
══════════════════════════════════════════ */
async function seedAdmin() {
  try {
    const db = await getPool();

    // Автоматты миграция: deleted_at колонкасы жоқ болса қосу
    try {
      await db.query(`ALTER TABLE ebooks ADD COLUMN deleted_at DATETIME DEFAULT NULL AFTER form_data`);
      console.log('✓ Миграция: ebooks.deleted_at колонкасы қосылды');
    } catch (e) {
      // MySQL: "Duplicate column name 'deleted_at'" — колонка бұрыннан бар, OK
      if (e.code !== 'ER_DUP_FIELDNAME') {
        console.error('Migration warning:', e.message);
      }
    }

    const [rows] = await db.query('SELECT id FROM users WHERE email = ?', ['admin@eo.kz']);
    if (rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await db.query(
        `INSERT INTO users (email,password,name,org,role,status,eo_limit)
         VALUES (?,?,?,?,?,?,?)`,
        ['admin@eo.kz', hash, 'Администратор', 'ЭО Платформа', 'admin', 'active', 999]
      );
      console.log('✓ Admin аккаунты жасалды: admin@eo.kz / admin123');
    }
  } catch (e) {
    console.error('seedAdmin error:', e.message);
  }
}

/* ══════════════════════════════════════════
   JWT helper-лары
══════════════════════════════════════════ */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const token = req.cookies.eo_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

/* ══════════════════════════════════════════
   Frontend файлы
══════════════════════════════════════════ */
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/', (req, res) => {
  const htmlPath = path.resolve(__dirname, 'public', 'index.html');
  res.sendFile(htmlPath, err => {
    if (err) res.status(404).send('index.html табылмады: ' + htmlPath);
  });
});
app.use(express.static(path.join(__dirname, 'public')));

/* ══════════════════════════════════════════
   AUTH маршруттары
══════════════════════════════════════════ */

// Тіркелу
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, org } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'Толтырыңыз' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль кемінде 6 символ' });

    const db = await getPool();
    const [exist] = await db.query('SELECT id FROM users WHERE email=?', [email.toLowerCase()]);
    if (exist.length) return res.status(409).json({ error: 'Бұл email тіркелген' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      `INSERT INTO users (email,password,name,org) VALUES (?,?,?,?)`,
      [email.toLowerCase(), hash, name, org || '']
    );
    res.json({ ok: true, message: 'Тіркелу сәтті. Активация күтіп тұр.' });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// Кіру
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email/пароль енгізіңіз' });

    const db = await getPool();
    const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Қате email немесе пароль' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Қате email немесе пароль' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'Аккаунт блокталды' });

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res
      .cookie('eo_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7*24*3600*1000 })
      .json({
        ok: true,
        user: {
          id: user.id, email: user.email, name: user.name, org: user.org,
          role: user.role, status: user.status,
          eoLimit: user.eo_limit, eoCreated: user.eo_created,
        },
        token,
      });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// Шығу
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('eo_token').json({ ok: true });
});

// Ағымдағы пайдаланушы
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.query(
      'SELECT id,email,name,org,role,status,eo_limit,eo_created,created_at FROM users WHERE id=?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Табылмады' });
    const u = rows[0];
    res.json({
      id: u.id, email: u.email, name: u.name, org: u.org,
      role: u.role, status: u.status,
      eoLimit: u.eo_limit, eoCreated: u.eo_created,
    });
  } catch (e) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

/* ══════════════════════════════════════════
   ADMIN маршруттары
══════════════════════════════════════════ */

// Барлық пайдаланушылар
app.get('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = await getPool();
    const [users] = await db.query(
      `SELECT id,email,name,org,role,status,eo_limit,eo_created,created_at
       FROM users WHERE role!='admin' ORDER BY created_at DESC`
    );
    const [eoStats] = await db.query(
      `SELECT user_id, COUNT(*) as cnt FROM ebooks GROUP BY user_id`
    );
    const eoMap = {};
    eoStats.forEach(r => { eoMap[r.user_id] = r.cnt; });

    res.json(users.map(u => ({
      id: u.id, email: u.email, name: u.name, org: u.org,
      role: u.role, status: u.status,
      eoLimit: u.eo_limit, eoCreated: u.eo_created,
      eoTotal: eoMap[u.id] || 0,
      createdAt: u.created_at,
    })));
  } catch (e) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// Пайдаланушыны белсендіру
app.patch('/api/admin/users/:id/activate', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { limit } = req.body;
    const db = await getPool();
    await db.query(
      `UPDATE users SET status='active', eo_limit=? WHERE id=? AND role!='admin'`,
      [parseInt(limit) || 5, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Сервер қатесі' }); }
});

// Блоктау
app.patch('/api/admin/users/:id/block', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = await getPool();
    await db.query(`UPDATE users SET status='blocked' WHERE id=? AND role!='admin'`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Сервер қатесі' }); }
});

// Қалпына келтіру
app.patch('/api/admin/users/:id/unblock', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = await getPool();
    await db.query(
      `UPDATE users SET status='active' WHERE id=? AND role!='admin'`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Сервер қатесі' }); }
});

// Лимит жаңарту
app.patch('/api/admin/users/:id/limit', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { limit } = req.body;
    const db = await getPool();
    await db.query(`UPDATE users SET eo_limit=? WHERE id=? AND role!='admin'`,
      [parseInt(limit) || 0, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Сервер қатесі' }); }
});

// Пайдаланушы мәліметін толық өзгерту (admin үшін)
app.put('/api/admin/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, email, org, role, status, eo_limit, password } = req.body;
    const db = await getPool();
    // Email бірегейлігін тексеру (өзінен басқа)
    if (email) {
      const [exist] = await db.query(
        'SELECT id FROM users WHERE email=? AND id!=?', [email.toLowerCase(), req.params.id]
      );
      if (exist.length) return res.status(400).json({ error: 'Бұл email тіркелген' });
    }
    const fields = [];
    const vals = [];
    if (name !== undefined)     { fields.push('name=?');      vals.push(name); }
    if (email !== undefined)    { fields.push('email=?');     vals.push(email.toLowerCase()); }
    if (org !== undefined)      { fields.push('org=?');       vals.push(org); }
    if (role !== undefined)     { fields.push('role=?');      vals.push(role); }
    if (status !== undefined)   { fields.push('status=?');    vals.push(status); }
    if (eo_limit !== undefined) { fields.push('eo_limit=?');  vals.push(parseInt(eo_limit) || 0); }
    if (password && password.trim()) {
      const hash = await bcrypt.hash(password.trim(), 10);
      fields.push('password=?'); vals.push(hash);
    }
    if (!fields.length) return res.status(400).json({ error: 'Өзгерістер жоқ' });
    vals.push(req.params.id);
    await db.query(`UPDATE users SET ${fields.join(',')} WHERE id=?`, vals);
    const [rows] = await db.query(
      'SELECT id,email,name,org,role,status,eo_limit,eo_created FROM users WHERE id=?', [req.params.id]
    );
    res.json(rows[0] || { ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Сервер қатесі' }); }
});

// Барлық ЭО (admin үшін)
app.get('/api/admin/ebooks', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.query(
      `SELECT e.id, e.title, e.form_data, e.created_at, e.updated_at,
              u.name as user_name, u.email as user_email
       FROM ebooks e JOIN users u ON e.user_id=u.id
       ORDER BY e.created_at DESC`
    );
    res.json(rows.map(r => ({
      ...r,
      formData: r.form_data ? (typeof r.form_data === 'string' ? JSON.parse(r.form_data) : r.form_data) : null,
      form_data: undefined
    })));
  } catch (e) { res.status(500).json({ error: 'Сервер қатесі' }); }
});

/* ══════════════════════════════════════════
   EBOOK маршруттары
══════════════════════════════════════════ */

// Пайдаланушының ЭО тізімі (HTML-сіз, тек active)
app.get('/api/ebooks', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    // IFNULL(deleted_at,0)=0 — колонка жоқ болса да жұмыс істейді (migration кейін болуы мүмкін)
    let rows;
    try {
      [rows] = await db.query(
        `SELECT id, title, form_data, created_at, updated_at
         FROM ebooks WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC`,
        [req.user.id]
      );
    } catch (e) {
      // deleted_at колонкасы жоқ — миграция өткізілмеген, барлығын қайтар
      [rows] = await db.query(
        `SELECT id, title, form_data, created_at, updated_at
         FROM ebooks WHERE user_id=? ORDER BY created_at DESC`,
        [req.user.id]
      );
    }
    res.json(rows.map(r => ({
      id: r.id, title: r.title,
      formData: r.form_data ? (typeof r.form_data === "string" ? JSON.parse(r.form_data) : r.form_data) : null,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })));
  } catch (e) {
    console.error('GET /api/ebooks error:', e.message);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// Жаңа ЭО сақтау
app.post('/api/ebooks', authMiddleware, async (req, res) => {
  try {
    const { title, html, formData } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML жоқ' });

    const db = await getPool();
    // Лимит тексеру
    const [uRows] = await db.query(
      'SELECT eo_limit, eo_created, status FROM users WHERE id=?', [req.user.id]
    );
    const u = uRows[0];
    if (!u || u.status !== 'active') return res.status(403).json({ error: 'Аккаунт белсенді емес' });
    if (u.eo_limit === 0) return res.status(403).json({ error: 'Лимит берілмеген' });
    if (u.eo_created >= u.eo_limit) return res.status(403).json({ error: `Лимит таусылды (${u.eo_created}/${u.eo_limit})` });

    const id = 'eo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    await db.query(
      `INSERT INTO ebooks (id, user_id, title, html_content, form_data) VALUES (?,?,?,?,?)`,
      [id, req.user.id, title || 'ЭО', html, formData ? JSON.stringify(formData) : null]
    );
    await db.query('UPDATE users SET eo_created=eo_created+1 WHERE id=?', [req.user.id]);

    res.json({ ok: true, id });
  } catch (e) {
    console.error('save ebook error:', e);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// Корзина тізімі
app.get('/api/ebooks/trash', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    let rows;
    try {
      [rows] = await db.query(
        `SELECT id, title, form_data, created_at, deleted_at
         FROM ebooks WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
        [req.user.id]
      );
    } catch (e) {
      // deleted_at колонкасы жоқ — бос массив қайтар
      rows = [];
    }
    res.json(rows.map(r => ({
      id: r.id, title: r.title,
      formData: r.form_data ? (typeof r.form_data === "string" ? JSON.parse(r.form_data) : r.form_data) : null,
      createdAt: r.created_at, deletedAt: r.deleted_at,
    })));
  } catch (e) {
    console.error('GET /api/ebooks/trash error:', e.message);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// ЭО жаңарту
app.put('/api/ebooks/:id', authMiddleware, async (req, res) => {
  try {
    const { title, html, formData } = req.body;
    const db = await getPool();
    const [rows] = await db.query(
      'SELECT id FROM ebooks WHERE id=? AND user_id=?',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Табылмады' });

    const sets = [];
    const vals = [];
    if (title) { sets.push('title=?'); vals.push(title); }
    if (html)  { sets.push('html_content=?'); vals.push(html); }
    if (formData !== undefined) { sets.push('form_data=?'); vals.push(JSON.stringify(formData)); }
    if (!sets.length) return res.status(400).json({ error: 'Жаңартылатын мәлімет жоқ' });

    vals.push(req.params.id, req.user.id);
    await db.query(`UPDATE ebooks SET ${sets.join(',')} WHERE id=? AND user_id=?`, vals);
    res.json({ ok: true });
  } catch (e) {
    console.error('update ebook error:', e);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// ЭО HTML жүктеу
app.get('/api/ebooks/:id/html', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    let query, params;
    if (req.user.role === 'admin') {
      query = 'SELECT title, html_content FROM ebooks WHERE id=?';
      params = [req.params.id];
    } else {
      query = 'SELECT title, html_content FROM ebooks WHERE id=? AND user_id=?';
      params = [req.params.id, req.user.id];
    }
    const [rows] = await db.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'Табылмады' });
    const eo = rows[0];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(eo.title)}.html"`);
    res.send(eo.html_content);
  } catch (e) { res.status(500).json({ error: 'Сервер қатесі' }); }
});

// Корзинадан қалпына келтіру — /:id/restore БҰРЫН /:id болуы керек!
app.post('/api/ebooks/:id/restore', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    let rows;
    try {
      [rows] = await db.query(
        'SELECT id FROM ebooks WHERE id=? AND user_id=? AND deleted_at IS NOT NULL',
        [req.params.id, req.user.id]
      );
    } catch(colErr) {
      [rows] = await db.query('SELECT id FROM ebooks WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    }
    if (!rows.length) return res.status(404).json({ error: 'Табылмады немесе корзинада жоқ' });
    try {
      await db.query('UPDATE ebooks SET deleted_at=NULL WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    } catch(colErr) { /* deleted_at жоқ */ }
    res.json({ ok: true });
  } catch (e) {
    console.error('restore error:', e.message);
    res.status(500).json({ error: 'Сервер қатесі: ' + e.message });
  }
});

// Корзинадан мүлдем жою — /:id/permanent БҰРЫН /:id болуы керек!
app.delete('/api/ebooks/:id/permanent', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    let rows;
    try {
      [rows] = await db.query(
        'SELECT id FROM ebooks WHERE id=? AND user_id=? AND deleted_at IS NOT NULL',
        [req.params.id, req.user.id]
      );
    } catch(colErr) {
      [rows] = await db.query('SELECT id FROM ebooks WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    }
    if (!rows.length) return res.status(404).json({ error: 'Табылмады немесе корзинада жоқ' });
    await db.query('DELETE FROM ebooks WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('permanent delete error:', e.message);
    res.status(500).json({ error: 'Сервер қатесі: ' + e.message });
  }
});

// ЭО корзинаға жіберу (soft delete) — /:id СОҢЫНДА болуы керек!
app.delete('/api/ebooks/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.query(
      'SELECT id FROM ebooks WHERE id=? AND user_id=?',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Табылмады' });
    try {
      await db.query('UPDATE ebooks SET deleted_at=NOW() WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    } catch (e) {
      await db.query('DELETE FROM ebooks WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('soft delete error:', e.message);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});


// Статистика (admin dashboard үшін)
app.get('/api/admin/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = await getPool();
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM users WHERE role!="admin"');
    const [[{ pending }]] = await db.query('SELECT COUNT(*) as pending FROM users WHERE status="pending"');
    const [[{ active }]] = await db.query('SELECT COUNT(*) as active FROM users WHERE status="active"');
    const [[{ eoTotal }]] = await db.query('SELECT COUNT(*) as eoTotal FROM ebooks');
    res.json({ total, pending, active, eoTotal });
  } catch (e) { res.status(500).json({ error: 'Сервер қатесі' }); }
});

/* ══════════════════════════════════════════
   Сервер іске қосу
══════════════════════════════════════════ */
async function start() {
  try {
    // DB байланысын тексеру
    const db = await getPool();
    await db.query('SELECT 1');
    console.log('✓ MySQL байланысы орнатылды');

    await seedAdmin();

    app.listen(PORT, () => {
      console.log(`✓ Сервер іске қосылды: http://localhost:${PORT}`);
      console.log(`  Admin: admin@eo.kz / admin123`);
    });
  } catch (e) {
    console.error('✗ Сервер қатесі:', e.message);
    console.error('  .env файлында DB_HOST, DB_USER, DB_PASSWORD, DB_NAME тексеріңіз');
    process.exit(1);
  }
}

start();