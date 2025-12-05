import { Router } from 'express';
import { q } from '../db.js';

const router = Router();

/** GET /api/bookings - Listar todas las reservas */
router.get('/', async (req, res, next) => {
    try {
        const result = await q(
            `SELECT b.*, 
                    e.title as event_title,
                    e.start_at as event_date,
                    v.name as venue_name,
                    e.capacity_total as event_capacity
             FROM bookings b
             LEFT JOIN events e ON e.id = b.event_id
             LEFT JOIN venues v ON v.id = e.venue_id
             ORDER BY b.created_at DESC`
        );
        
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

/** GET /api/bookings/event/:eventId - Reservas por evento */
router.get('/event/:eventId', async (req, res, next) => {
    try {
        const result = await q(
            `SELECT b.*, 
                    e.title as event_title,
                    e.capacity_total as event_capacity
             FROM bookings b
             LEFT JOIN events e ON e.id = b.event_id
             WHERE b.event_id = $1
             ORDER BY b.created_at DESC`,
            [req.params.eventId]
        );
        
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

/** POST /api/bookings - Crear nueva reserva */
router.post('/', async (req, res, next) => {
    const client = await q.pool.connect();
    
    try {
        const { event_id, name, email, qty = 1, phone = '', notes = '' } = req.body;

        // Validaciones básicas
        if (!event_id || !name || !email) {
            return res.status(400).json({ 
                error: 'event_id, name y email son requeridos' 
            });
        }

        if (qty < 1) {
            return res.status(400).json({ 
                error: 'La cantidad debe ser al menos 1' 
            });
        }

        await client.query('BEGIN');

        // Verificar disponibilidad del evento
        const availabilityResult = await client.query(
            `SELECT e.*, 
                    COALESCE(SUM(b.qty), 0) as reserved_qty,
                    e.capacity_total - COALESCE(SUM(b.qty), 0) as available_qty
             FROM events e
             LEFT JOIN bookings b ON b.event_id = e.id AND b.status = 'confirmed'
             WHERE e.id = $1
             GROUP BY e.id`,
            [event_id]
        );

        if (!availabilityResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Evento no encontrado' });
        }

        const event = availabilityResult.rows[0];
        const availableQty = Math.max(0, event.available_qty);

        // Verificar si el evento está lleno
        if (event.status === 'soldout') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Este evento está agotado' 
            });
        }

        // Verificar si hay suficientes lugares disponibles
        if (availableQty < qty) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: `Solo quedan ${availableQty} lugares disponibles` 
            });
        }

        // Crear la reserva
        const bookingResult = await client.query(
            `INSERT INTO bookings 
                (event_id, name, email, phone, qty, notes, status, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', NOW())
             RETURNING *`,
            [event_id, name, email, phone, qty, notes]
        );

        // Verificar si después de esta reserva el evento se llena
        const newReservedQty = parseInt(event.reserved_qty) + qty;
        if (newReservedQty >= event.capacity_total) {
            await client.query(
                `UPDATE events SET status = 'soldout' WHERE id = $1`,
                [event_id]
            );
        }

        await client.query('COMMIT');
        
        res.status(201).json({
            ...bookingResult.rows[0],
            message: `Reserva confirmada para ${qty} lugar(es)`
        });

    } catch (err) {
        await client.query('ROLLBACK');
        
        if (err.code === '23505') { // Unique violation
            return res.status(409).json({ 
                error: 'Ya existe una reserva con este email para este evento' 
            });
        }
        
        next(err);
    } finally {
        client.release();
    }
});

/** PATCH /api/bookings/:id - Actualizar reserva */
router.patch('/:id', async (req, res, next) => {
    const client = await q.pool.connect();
    
    try {
        const { status, qty } = req.body;
        const bookingId = req.params.id;

        if (!status && !qty) {
            return res.status(400).json({ 
                error: 'Se requiere status o qty para actualizar' 
            });
        }

        await client.query('BEGIN');

        // Obtener la reserva actual
        const currentBooking = await client.query(
            `SELECT * FROM bookings WHERE id = $1`,
            [bookingId]
        );

        if (!currentBooking.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Reserva no encontrada' });
        }

        const booking = currentBooking.rows[0];

        // Si se está cancelando, liberar los lugares
        if (status === 'cancelled' && booking.status === 'confirmed') {
            // Actualizar estado del evento si era soldout
            const eventResult = await client.query(
                `SELECT * FROM events WHERE id = $1`,
                [booking.event_id]
            );
            
            if (eventResult.rows.length && eventResult.rows[0].status === 'soldout') {
                await client.query(
                    `UPDATE events SET status = 'scheduled' WHERE id = $1`,
                    [booking.event_id]
                );
            }
        }

        // Actualizar la reserva
        const updateFields = [];
        const updateValues = [];
        
        if (status) {
            updateFields.push('status = $' + (updateValues.length + 1));
            updateValues.push(status);
        }
        
        if (qty) {
            updateFields.push('qty = $' + (updateValues.length + 1));
            updateValues.push(qty);
        }

        updateValues.push(bookingId);

        const updateResult = await client.query(
            `UPDATE bookings 
             SET ${updateFields.join(', ')}, updated_at = NOW()
             WHERE id = $${updateValues.length}
             RETURNING *`,
            updateValues
        );

        await client.query('COMMIT');
        
        res.json({
            ...updateResult.rows[0],
            message: 'Reserva actualizada correctamente'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

/** DELETE /api/bookings/:id - Eliminar reserva */
router.delete('/:id', async (req, res, next) => {
    const client = await q.pool.connect();
    
    try {
        const bookingId = req.params.id;

        await client.query('BEGIN');

        // Obtener la reserva para saber cuántos lugares liberar
        const bookingResult = await client.query(
            `SELECT * FROM bookings WHERE id = $1`,
            [bookingId]
        );

        if (!bookingResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Reserva no encontrada' });
        }

        const booking = bookingResult.rows[0];

        // Eliminar la reserva
        const deleteResult = await client.query(
            `DELETE FROM bookings WHERE id = $1 RETURNING *`,
            [bookingId]
        );

        // Si la reserva estaba confirmada, actualizar estado del evento
        if (booking.status === 'confirmed') {
            const eventResult = await client.query(
                `SELECT * FROM events WHERE id = $1`,
                [booking.event_id]
            );
            
            if (eventResult.rows.length && eventResult.rows[0].status === 'soldout') {
                await client.query(
                    `UPDATE events SET status = 'scheduled' WHERE id = $1`,
                    [booking.event_id]
                );
            }
        }

        await client.query('COMMIT');
        
        res.json({
            message: 'Reserva eliminada correctamente',
            deleted: deleteResult.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

export default router;