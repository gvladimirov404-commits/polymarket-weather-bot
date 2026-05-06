import express from 'express';
import path from 'path';
import fs from 'fs';

/**
 * Сервира статични файлове в Production.
 * Използваме 'any' за app, за да избегнем TypeScript конфликти по време на билд в Railway.
 */
export function serveStatic(app: any) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const rootDir = process.cwd();
    
    // Проверяваме двете най-вероятни локации за билд файловете
    const distPath = path.resolve(rootDir, 'dist');
    const clientDistPath = path.resolve(rootDir, 'client', 'dist');
    
    let finalStaticPath = '';

    if (fs.existsSync(clientDistPath)) {
      finalStaticPath = clientDistPath;
    } else if (fs.existsSync(distPath)) {
      finalStaticPath = distPath;
    }

    if (!finalStaticPath) {
      console.error('❌ ГРЕШКА: Директорията dist не е намерена. Билдът вероятно е неуспешен.');
      return;
    }

    console.log(`🚀 Успешно сервиране от: ${finalStaticPath}`);

    // Сервиране на статични ресурси
    app.use(express.static(finalStaticPath));

    // Catch-all за Single Page Application
    app.get('*', (req: any, res: any, next: any) => {
      // Не пренасочваме API заявки
      if (req.path.startsWith('/api')) return next();
      
      const indexPath = path.join(finalStaticPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Frontend build (index.html) missing.');
      }
    });
  }
}
