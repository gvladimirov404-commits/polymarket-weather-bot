
import express from 'express';
import { createServer } from 'http';
import { setupServer } from './_core/index';

const app = express();
const server = createServer(app);

async function start() {
  await setupServer(app);
  
  const PORT = parseInt(process.env.PORT || "3000");
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch(console.error);
