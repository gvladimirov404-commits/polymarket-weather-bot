
import express, { Express } from 'express';
import { serveStatic } from './vite';

export async function setupServer(app: Express) {
  // Добавяме тестовия маршрут за Railway
  app.get('/', (req, res) => {
    res.send('✅ Railway deployment successful! Server is running.');
  });

  if (process.env.NODE_ENV === 'development') {
    // В режим на разработка (development)
  } else {
    // В режим на продукция (production)
    serveStatic(app);
  }
}
