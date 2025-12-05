import { Router } from 'express';
import { q } from '../db.js';

const router = Router();

/** Versión simple: devuelve eventos en un rango (similar a /events) */
router.get('/', async (req, res, next) => {
  try {
    const from = req.query.from ? `${req.query.from}T00:00:00Z` : new Date().toISOString();
    const to   = req.query.to   ? `${req.query.to}T23:59:59Z` : new Date(Date.now() + 1000*60*60*24*60).toISOString();

    const r = await q(
      `SELECT e.*, v.name AS venue_name
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.start_at >= $1 AND e.end_at <= $2
       ORDER BY e.start_at ASC`,
      [from, to]
    );

    res.json(r.rows);
  } catch (err) { next(err); }
});

export default router;
