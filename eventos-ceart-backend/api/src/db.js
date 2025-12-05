import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Función de consulta simple
export const q = (text, params) => pool.query(text, params);

// Exportar pool para transacciones
q.pool = pool;