// api/app.js
import express from 'express';
import cors from 'cors';
import path from 'node:path';

import events from './routes/events.routes.js';
import venues from './routes/venues.routes.js';
import calendar from './routes/calendar.routes.js';
import uploadsRouter from './uploads.router.js';
import bookings from './routes/bookings.routes.js';

import { errorHandler, notFound } from './middleware/error.js';

const app = express();

// —— CORS ——
// Orígenes permitidos (tu máquina local + tu IP en la red)
const allowedOrigins = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://192.168.176.106:5500', // front estático (Live Server)
  'http://192.168.176.106:3000'  // front React en dev server (si lo usas)
];

app.use(cors({
  origin(origin, callback) {
    // peticiones sin origin (Postman, curl) -> se permiten
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Opcional: responder preflights de cualquier ruta
app.options('*', cors());

// JSON
app.use(express.json({ limit: '5mb' }));

// Servir archivos subidos
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Routers
app.use('/api/events', events);
app.use('/api/venues', venues);
app.use('/api/calendar', calendar);
app.use('/api/uploads', uploadsRouter);
app.use('/api/bookings', bookings);

// 404 y errores
app.use(notFound);
app.use(errorHandler);

export default app;
