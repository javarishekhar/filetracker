require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const { put, del } = require('@vercel/blob');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'share_with_manager',
  waitForConnections: true,
  connectionLimit: 5,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type: ' + file.originalname));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

    const files = req.files || [];
    const uploaded = [];
    for (const file of files) {
      const blob = await put(file.originalname, file.buffer, {
        access: 'public',
        addRandomSuffix: true
      });
      uploaded.push({
        original_name: file.originalname,
        file_url: blob.url,
        mime_type: file.mimetype,
        size_bytes: file.size
      });
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

    for (const f of uploaded) {
      await conn.query(
        'INSERT INTO entry_files (entry_id, original_name, file_url, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)',
        [entryId, f.original_name, f.file_url, f.mime_type, f.size_bytes]
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

// Delete an entry (and its files from blob storage)
app.delete('/api/entries/:id', async (req, res) => {
  try {
    const [files] = await pool.query('SELECT file_url FROM entry_files WHERE entry_id = ?', [req.params.id]);
    await pool.query('DELETE FROM entries WHERE id = ?', [req.params.id]);
    for (const f of files) {
      del(f.file_url).catch(() => {});
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
