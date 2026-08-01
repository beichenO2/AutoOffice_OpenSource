/**
 * Server bootstrap for the Electron desktop app. Run as pure Node (the Electron
 * main spawns this with ELECTRON_RUN_AS_NODE=1) so it can `import` the built ESM
 * server and bind a local port. The desktop app runs the engine directly — no
 * Polar runtime governance — on 127.0.0.1 only.
 */
import { startServer } from '../dist/server.js';

const port = Number(process.env.PORT || 0);
startServer(port).catch((err) => {
  console.error('[autooffice-desktop] server boot failed:', err);
  process.exit(1);
});
