// src/app.js
import express from 'express';
import cors from 'cors';
import path from 'node:path';

import events from './routes/events.routes.js';
import venues from './routes/venues.routes.js';
import calendar from './routes/calendar.routes.js';
import bookings from './routes/bookings.routes.js';
import uploadsRouter from './uploads.router.js';
import metricsRoutes from './routes/metrics.routes.js';

import { errorHandler, notFound } from './middleware/error.js';
import { metricsMiddleware } from './metrics.js';

const app = express();

app.use(cors({
  origin: [
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.176.114:5500'
  ],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));

// ==== MÉTRICAS (antes de los routers) ====
app.use(metricsMiddleware);

// archivos estáticos para imágenes
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Routers de negocio
app.use('/api/events', events);
app.use('/api/venues', venues);
app.use('/api/calendar', calendar);
app.use('/api/bookings', bookings);
app.use('/api/uploads', uploadsRouter);

// Router de métricas
app.use('/api/metrics', metricsRoutes);

// 404 + errores
app.use(notFound);
app.use(errorHandler);

export default app;
