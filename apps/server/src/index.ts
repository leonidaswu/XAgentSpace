import http from 'node:http';
import { createApp, attachWebSocket } from './app.js';
import { PlatformService } from './platform.js';

const port = Number(process.env.PORT ?? 3000);
const platform = new PlatformService();
const app = createApp(platform);
const server = http.createServer(app);

attachWebSocket(server, platform);

server.listen(port, () => {
  console.log(`Agent Arena running at http://localhost:${port}`);
});
