// src/routes/metrics.routes.js
import { Router } from 'express';
import { getMetricsSummary } from '../metrics.js';

const router = Router();

// GET /api/metrics/summary
router.get('/summary', async (req, res, next) => {
  try {
    const data = await getMetricsSummary();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
