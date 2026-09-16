require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'share_with_manager',
  waitForConnections: true,
  connectionLimit: 10
});

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type: ' + file.originalname));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Get all entries with their files, ordered by serial number
app.get('/api/entries', async (req, res) => {
  try {
    const [entries] = await pool.query('SELECT * FROM entries ORDER BY serial_no ASC');
    const [files] = await pool.query('SELECT * FROM entry_files ORDER BY id ASC');

    const filesByEntry = {};
    for (const f of files) {
      if (!filesByEntry[f.entry_id]) filesByEntry[f.entry_id] = [];
      filesByEntry[f.entry_id].push(f);
    }

    const result = entries.map(e => ({ ...e, files: filesByEntry[e.id] || [] }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load entries' });
  }
});

// Create a new entry (heading, description, multiple files)
app.post('/api/entries', upload.array('uploads', 20), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { heading, description } = req.body;
    if (!heading || !heading.trim()) {
      return res.status(400).json({ error: 'Heading is required' });
    }

    await conn.beginTransaction();

    const [[{ maxSerial }]] = await conn.query(
      'SELECT COALESCE(MAX(serial_no), 0) AS maxSerial FROM entries'
    );
    const serialNo = maxSerial + 1;

    const [result] = await conn.query(
      'INSERT INTO entries (serial_no, heading, description) VALUES (?, ?, ?)',
      [serialNo, heading.trim(), description ? description.trim() : '']
    );
    const entryId = result.insertId;

    const files = req.files || [];
    for (const file of files) {
      await conn.query(
        'INSERT INTO entry_files (entry_id, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)',
        [entryId, file.originalname, file.filename, file.mimetype, file.size]
      );
    }

    await conn.commit();
    res.status(201).json({ id: entryId, serial_no: serialNo });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create entry' });
  } finally {
    conn.release();
  }
});

// Delete an entry (and its files from disk)
app.delete('/api/entries/:id', async (req, res) => {
  try {
    const [files] = await pool.query('SELECT stored_name FROM entry_files WHERE entry_id = ?', [req.params.id]);
    await pool.query('DELETE FROM entries WHERE id = ?', [req.params.id]);
    for (const f of files) {
      const p = path.join(UPLOAD_DIR, f.stored_name);
      fs.unlink(p, () => {});
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.startsWith('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
