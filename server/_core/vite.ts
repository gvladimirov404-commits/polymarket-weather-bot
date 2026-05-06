import express, { Express } from 'express';
import path from 'path';
import fs from 'fs';

export function serveStatic(app: Express) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const rootDir = process.cwd();
    const possiblePaths = [
      path.resolve(rootDir, 'dist', 'public'),
      path.resolve(rootDir, 'dist'),
      path.resolve(rootDir, 'client', 'dist')
    ];

    let finalPath = '';
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        finalPath = p;
        break;
      }
    }

    if (!finalPath) {
      console.error('Static directory not found!');
      return;
    }

    app.use(express.static(finalPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const indexPath = path.join(finalPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Frontend not found.');
      }
    });
  }
}
