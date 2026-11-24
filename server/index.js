// Starts the server on localhost only. Run it from the server folder with `npm start`.
import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3001);

createApp().listen(PORT, '127.0.0.1', () => {
  console.log(`Resume Match server on http://localhost:${PORT}`);
  if (!process.env.LABD_API_KEY && !process.env['LABD-API-KEY']) {
    console.warn('LABD_API_KEY is not set. Every request will fail until you set it and restart.');
  }
});
