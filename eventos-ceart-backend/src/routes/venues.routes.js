import { Router } from 'express';
import { q } from '../db.js'; // IMPORTAR la conexión a BD

const router = Router();

// GET /api/venues
router.get('/', async (_req, res, next) => {
  try {
    const result = await q('SELECT * FROM venues ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/venues
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await q(
      'INSERT INTO venues (name) VALUES ($1) RETURNING *',
      [name]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') { // unique violation
      return res.status(409).json({ error: 'Venue already exists' });
    }
    next(err);
  }
});

// DELETE /api/venues/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await q(
      'DELETE FROM venues WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;