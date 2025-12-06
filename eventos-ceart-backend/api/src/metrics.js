// src/metrics.js
import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME ?? 'ceart_metrics';
const collectionName = process.env.MONGO_COLLECTION ?? 'http_requests';

let collection = null;

/**
 * Conecta una sola vez a MongoDB Atlas y deja lista la colección.
 */
export async function initMetrics() {
  if (!uri) {
    console.warn('[Metrics] MONGO_URI no definido. Métricas desactivadas.');
    return;
  }

  try {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    collection = db.collection(collectionName);
    console.log('[Metrics] Conectado a MongoDB Atlas. Colección http_requests lista.');
  } catch (err) {
    console.error('[Metrics] Error conectando a MongoDB:', err.message);
  }
}

/**
 * Middleware que registra cada request en la colección http_requests.
 */
export function metricsMiddleware(req, res, next) {
  if (!collection) return next(); // métrica desactivada

  const start = process.hrtime.bigint();

  res.on('finish', async () => {
    try {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6;

      const doc = {
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs,
        ip: req.ip || req.connection?.remoteAddress,
        createdAt: new Date()
      };

      await collection.insertOne(doc);
    } catch (err) {
      console.error('[Metrics] Error guardando métrica:', err.message);
    }
  });

  next();
}

/**
 * Lógica para devolver un resumen de métricas.
 */
export async function getMetricsSummary() {
  if (!collection) {
    return {
      enabled: false,
      message: 'Métricas no inicializadas (MONGO_URI no configurado o error de conexión).'
    };
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    totalCount,
    todayCount,
    byPath,
    byMethod,
    byStatus,
    latest
  ] = await Promise.all([
    collection.countDocuments(),
    collection.countDocuments({ createdAt: { $gte: startOfToday } }),

    // Top 5 rutas
    collection.aggregate([
      {
        $group: {
          _id: '$path',
          count: { $sum: 1 },
          avgDurationMs: { $avg: '$durationMs' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]).toArray(),

    // Top 5 métodos
    collection.aggregate([
      {
        $group: {
          _id: '$method',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]).toArray(),

    // Conteo por status
    collection.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray(),

    // Últimos 20 requests
    collection.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .project({
        _id: 0,
        method: 1,
        path: 1,
        status: 1,
        durationMs: 1,
        createdAt: 1
      })
      .toArray()
  ]);

  return {
    enabled: true,
    totalCount,
    todayCount,
    byPath: byPath.map(p => ({
      path: p._id,
      count: p.count,
      avgDurationMs: p.avgDurationMs
    })),
    byMethod: byMethod.map(m => ({
      method: m._id,
      count: m.count
    })),
    byStatus: byStatus.map(s => ({
      status: s._id,
      count: s.count
    })),
    latest
  };
}
