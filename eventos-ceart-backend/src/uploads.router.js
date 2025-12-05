// uploads.router.js (ESM)
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Storage con nombre único legible
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeBase = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .slice(0, 60);
    const ts = Date.now();
    cb(null, `${ts}-${safeBase}${path.extname(file.originalname).toLowerCase()}`);
  }
});

// Sólo imágenes
const fileFilter = (_req, file, cb) => {
  if (!/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i.test(file.mimetype)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024, files: 8 } // 8MB c/u, hasta 8 archivos
});

// ====== Subida de UN archivo (front usa `file`) ======
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo "file".' });

    const publicUrl = `/uploads/${req.file.filename}`;
    return res.status(201).json({
      ok: true,
      url: publicUrl,
      fileName: req.file.filename,
      size: req.file.size,
      mime: req.file.mimetype
    });
  });
});

// ====== Subida múltiple opcional (campo `files[]`) ======
router.post('/batch', (req, res, next) => {
  upload.array('files', 8)(req, res, (err) => {
    if (err) return next(err);
    if (!req.files?.length) return res.status(400).json({ error: 'No se recibieron archivos.' });

    const items = req.files.map(f => ({
      url: `/uploads/${f.filename}`,
      fileName: f.filename,
      size: f.size,
      mime: f.mimetype
    }));
    return res.status(201).json({ ok: true, items });
  });
});

export default router;
  