import { Router } from 'express';
import { q } from '../db.js';

const router = Router();

/** Helpers */
function buildFilters(query) {
  const where = [];
  const params = [];

  // rango de fechas — default: mes actual hasta +2 meses
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const defaultTo   = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();

  const from = query.from ? `${query.from}T00:00:00Z` : defaultFrom;
  const to   = query.to   ? `${query.to}T23:59:59Z` : defaultTo;

  params.push(from); where.push(`e.start_at >= $${params.length}`);
  params.push(to);   where.push(`e.end_at   <= $${params.length}`);

  if (query.status) {
    params.push(query.status);
    where.push(`e.status = $${params.length}`);
  }

  if (query.category) {
    params.push(query.category);
    where.push(`e.category = $${params.length}`);
  }

  const venueId = query.venue_id || query.venueId;
  if (venueId) {
    params.push(venueId);
    where.push(`e.venue_id = $${params.length}`);
  }

  if (query.q) {
    params.push(query.q);
    where.push(`e.search_vector @@ websearch_to_tsquery('spanish', $${params.length})`);
  }

  return { where, params };
}

/** GET /api/events */
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 500);
    const offset = (page - 1) * pageSize;

    const { where, params } = buildFilters(req.query);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await q(`SELECT COUNT(*) FROM events e ${whereSql}`, params);
    const items = await q(
      `
      SELECT e.*, v.name AS venue_name
      FROM events e
      LEFT JOIN venues v ON v.id = e.venue_id
      ${whereSql}
      ORDER BY e.start_at ASC
      LIMIT ${pageSize} OFFSET ${offset}
      `,
      params
    );

    res.json({
      items: items.rows,
      total: Number(total.rows[0].count),
      page,
      pageSize
    });
  } catch (err) { next(err); }
});

/** GET /api/events/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const ev = await q(
      `SELECT e.*, v.name AS venue_name
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = $1
      `, [req.params.id]
    );
    if (!ev.rows.length) return res.status(404).json({ error: 'Event not found' });

    const images = await q(
      `SELECT * FROM event_images WHERE event_id = $1 ORDER BY position ASC`,
      [req.params.id]
    );

    res.json({ ...ev.rows[0], images: images.rows });
  } catch (err) { next(err); }
});

/** POST /api/events */
router.post('/', async (req, res, next) => {
  try {
    const {
      title, summary, description, category, tags,
      venue_id, start_at, end_at,
      capacity_total = 0, status = 'scheduled'
    } = req.body;

    const r = await q(
      `INSERT INTO events
        (title, summary, description, category, tags, venue_id, start_at, end_at, capacity_total, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
       RETURNING *`,
      [title, summary, description, category || null, tags || null,
       venue_id || null, start_at, end_at, capacity_total, status]
    );

    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

/** PATCH /api/events/:id */
router.patch('/:id', async (req, res, next) => {
  try {
    const fields = [];
    const params = [];
    const allowed = [
      'title','summary','description','category','tags',
      'venue_id','start_at','end_at','capacity_total','capacity_reserved','status'
    ];
    for (const k of allowed) {
      if (k in req.body) {
        params.push(req.body[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields' });
    params.push(req.params.id);

    const r = await q(
      `UPDATE events SET ${fields.join(', ')}, updated_at = now()
       WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (!r.rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

/** DELETE /api/events/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const r = await q(`DELETE FROM events WHERE id = $1`, [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Event not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

/** POST /api/events/:id/images - MEJORADO CON PORTADAS */
router.post('/:id/images', async (req, res, next) => {
  const client = await q.pool.connect();
  try {
    const eventId = req.params.id;
    const { url, alt = '', position = 1, is_cover = false } = req.body;

    if (!url) return res.status(400).json({ error: 'url requerida' });

    await client.query('BEGIN');

    // Obtener el máximo position actual para este evento
    const maxPosResult = await client.query(
      `SELECT COALESCE(MAX(position), 0) as max_position FROM event_images WHERE event_id = $1`,
      [eventId]
    );
    const nextPosition = maxPosResult.rows[0].max_position + 1;

    // Si esta imagen será portada, quitar portada actual
    if (is_cover === true) {
      await client.query(
        `UPDATE event_images SET is_cover = false WHERE event_id = $1 AND is_cover = true`,
        [eventId]
      );
    }

    // Insertar nueva imagen
    const result = await client.query(
      `INSERT INTO event_images (event_id, url, alt, position, is_cover, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id, event_id, url, alt, position, is_cover, created_at`,
      [eventId, url, alt, position || nextPosition, !!is_cover]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/** PATCH /api/events/:id/images/:imageId/set-cover - NUEVA RUTA PARA PORTADA */
router.patch('/:id/images/:imageId/set-cover', async (req, res, next) => {
  const client = await q.pool.connect();
  try {
    const { id: eventId, imageId } = req.params;

    await client.query('BEGIN');

    // Primero, quitar portada actual
    await client.query(
      `UPDATE event_images SET is_cover = false WHERE event_id = $1 AND is_cover = true`,
      [eventId]
    );

    // Luego, establecer nueva portada
    const result = await client.query(
      `UPDATE event_images 
       SET is_cover = true 
       WHERE id = $1 AND event_id = $2
       RETURNING id, event_id, url, alt, position, is_cover, created_at`,
      [imageId, eventId]
    );

    await client.query('COMMIT');

    if (!result.rows.length) return res.status(404).json({ error: 'Imagen no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/** DELETE /api/events/:id/images/:imageId */
router.delete('/:id/images/:imageId', async (req, res, next) => {
  try {
    const r = await q(
      `DELETE FROM event_images WHERE id = $1 AND event_id = $2`,
      [req.params.imageId, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Image not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

// Listar imágenes del evento
router.get('/:id/images', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await q(
      `SELECT id, url, alt, position, is_cover, created_at
       FROM event_images
       WHERE event_id = $1
       ORDER BY position ASC, created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Actualizar una imagen (alt, position, is_cover)
router.patch('/:id/images/:imageId', async (req, res, next) => {
  const client = await q.pool.connect();
  try {
    const { id, imageId } = req.params;
    const { alt, position, is_cover } = req.body;

    await client.query('BEGIN');

    if (is_cover === true) {
      await client.query(
        `UPDATE event_images SET is_cover = false WHERE event_id = $1 AND id <> $2 AND is_cover = true`,
        [id, imageId]
      );
    }

    const result = await client.query(
      `UPDATE event_images
       SET alt = COALESCE($1, alt),
           position = COALESCE($2, position),
           is_cover = COALESCE($3, is_cover)
       WHERE id = $4 AND event_id = $5
       RETURNING id, event_id, url, alt, position, is_cover, created_at`,
      [alt ?? null, position ?? null, (is_cover === undefined ? null : !!is_cover), imageId, id]
    );

    await client.query('COMMIT');

    if (!result.rows.length) return res.status(404).json({ error: 'Imagen no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/** GET /api/events/:id/availability - Verificar disponibilidad */
router.get('/:id/availability', async (req, res, next) => {
    try {
        const eventId = req.params.id;
        
        // Obtener el evento con información de capacidad
        const eventResult = await q(
            `SELECT e.*, 
                    COALESCE(SUM(b.qty), 0) as reserved_qty,
                    e.capacity_total - COALESCE(SUM(b.qty), 0) as available_qty
             FROM events e
             LEFT JOIN bookings b ON b.event_id = e.id AND b.status = 'confirmed'
             WHERE e.id = $1
             GROUP BY e.id`,
            [eventId]
        );

        if (!eventResult.rows.length) {
            return res.status(404).json({ error: 'Evento no encontrado' });
        }

        const event = eventResult.rows[0];
        const available = Math.max(0, event.available_qty);
        const isSoldOut = available <= 0;

        res.json({
            event_id: eventId,
            capacity_total: event.capacity_total,
            reserved_qty: parseInt(event.reserved_qty),
            available_qty: available,
            is_sold_out: isSoldOut,
            status: event.status
        });
    } catch (err) {
        next(err);
    }
});

export default router;