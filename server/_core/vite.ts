import express, { Express } from 'express';
import path from 'path';
import fs from 'fs';

export function serveStatic(app: Express) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    // ДИАГНОСТИКА: Нека видим къде се намираме и какво има около нас
    const rootDir = process.cwd();
    console.log(`--- PRODUCTION DIAGNOSTICS ---`);
    console.log(`Current Working Directory: ${rootDir}`);
    
    // Списък с потенциални пътища, които ще проверим
    const potentialPaths = [
      path.join(rootDir, 'client', 'dist'), // Често срещано за монорепо или проекти с отделен клиентски поддиректория
      path.join(rootDir, 'dist'),           // Често срещано, ако Vite билдва директно в корена
      path.join(rootDir, 'public'),          // Понякога се използва за статични файлове
      path.resolve(rootDir, '../client/dist') // За по-сложни структури, ако сървърът е в поддиректория
    ];

    let finalPath = '';

    console.log('--- Checking potential static paths ---');
    potentialPaths.forEach(p => {
      const exists = fs.existsSync(p);
      console.log(`Path: ${p} -> ${exists ? '✅ FOUND' : '❌ NOT FOUND'}`);
      if (exists && !finalPath) {
        finalPath = p; // Взимаме първия намерен път
      }
    });
    console.log('--- End checking potential static paths ---');

    if (!finalPath) {
      console.error('❌ ERROR: No static build directory found! Your frontend build step might be failing or outputting to an unexpected location.');
      console.error('Please ensure your Vite build command runs successfully and outputs to one of the checked paths.');
      
      // В случай на грешка, сервираме информативна страница вместо 404
      app.get('*', (req, res) => {
        res.status(500).send(`<h1>Configuration Error</h1><p>Static files directory not found. Please check your Railway logs for "PRODUCTION DIAGNOSTICS" to identify the correct path or build issue.</p>`);
      });
      return;
    }

    console.log(`🚀 Serving static files from: ${finalPath}`);

    // 1. Сервиране на статични ресурси (js, css, изображения и т.н.)
    app.use(express.static(finalPath));

    // 2. SPA Catch-all: Всички заявки, които не са към API, се пренасочват към index.html
    app.get('*', (req, res, next) => {
      // Пропускаме заявки, които приличат на API (например започват с /api)
      if (req.path.startsWith('/api')) {
        return next();
      }
      
      const indexPath = path.join(finalPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        console.error(`❌ ERROR: index.html not found in ${finalPath}. This is critical for SPA.`);
        res.status(404).send(`<h1>404 Not Found</h1><p>index.html not found in the static directory. Check your build output.</p>`);
      }
    });
  } else {
    console.log('Vite development server is expected to handle requests. Running in development mode.');
  }
}
