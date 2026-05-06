import express, { Express } from 'express';
import { serveStatic } from './vite';

export async function setupServer(app: Express) {
  // Твоят нов тестов маршрут за Railway
  app.get('/', (req, res) => {
    res.send('✅ Server is running on Railway!');
  });

  // Логика за сервиране на статични файлове
  if (process.env.NODE_ENV === 'development') {
    // В режим на разработка (development)
  } else {
    // В режим на продукция (production)
    serveStatic(app);
  }
}
