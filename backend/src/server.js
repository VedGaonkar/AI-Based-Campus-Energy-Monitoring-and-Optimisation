import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb } from './db.js';
import { attachLive } from './live.js';
import { User } from './models/index.js';
import { seedDemo } from './seed/index.js';
import { startWorker } from './workers/jobRunner.js';

const cfg = config();

try {
  await connectDb();
} catch (err) {
  console.error(`Could not connect to MongoDB at ${cfg.mongoUri.replace(/\/\/[^@/]*@/, '//***@')}: ${err.message}`);
  console.error('Start MongoDB, or run "npm run db:memory" in another terminal for a local development database.');
  process.exit(1);
}

if (cfg.demoMode && (await User.countDocuments()) === 0) {
  console.log('[seed] empty database in demo mode: loading demo data');
  await seedDemo();
}

const { app, sessionMiddleware } = createApp();
const server = http.createServer(app);
attachLive(server, sessionMiddleware);

if (cfg.workerInline) {
  const worker = startWorker();
  console.log(`[worker] running inside the API process as ${worker.owner}`);
} else {
  console.log('[worker] WORKER_INLINE=false: start "npm run worker" separately or escalation will not run');
}

server.listen(cfg.port, () => {
  console.log(`API listening on http://localhost:${cfg.port}/api/v1`);
  if (cfg.demoMode) console.log(`DEMO MODE: simulated control only, policy delays accelerated ${cfg.demoTimeScale}x`);
});
