// middleware/error.js (ESM)
export function notFound(_req, res, _next) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

export function errorHandler(err, _req, res, _next) {
  // Multer: errores “bonitos”
  if (err && err.name === 'MulterError') {
    const map = {
      LIMIT_FILE_SIZE: 'Archivo demasiado grande',
      LIMIT_UNEXPECTED_FILE: 'Campo/archivo no permitido',
    };
    const msg = map[err.code] || 'Error al subir archivo';
    return res.status(400).json({ error: msg, code: err.code });
  }

  const status = err.status || 500;
  const payload = {
    error: err.message || 'Error interno',
  };
  if (process.env.NODE_ENV !== 'production') {
    payload.stack = err.stack;
  }
  res.status(status).json(payload);
}
