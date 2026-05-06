import express, { Express } from 'express';
import { serveStatic } from './vite';

export async function setupServer(app: Express) {
  // Новият маршрут, който поиска
  app.get('/', (req, res) => {
    res.send('Hello World!');
  });

  if (process.env.NODE_ENV === 'development') {
    // Разработка
  } else {
    // Production
    serveStatic(app);
  }
}
