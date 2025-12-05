// src/server.js
import app from './app.js';
import { initMetrics } from './metrics.js';

const PORT = process.env.PORT || 3000;

async function start() {
  // Inicializar conexión a MongoDB Atlas para métricas (si MONGO_URI existe)
  try {
    await initMetrics();
  } catch (err) {
    console.error('[Metrics] No se pudieron inicializar:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`[API] listening on http://0.0.0.0:${PORT}`);
  });
}

start();
