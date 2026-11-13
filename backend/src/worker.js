import { config } from './config.js';
import { connectDb } from './db.js';
import { startWorker } from './workers/jobRunner.js';

// Standalone escalation worker. Use with WORKER_INLINE=false on the API process.
try {
  await connectDb();
} catch (err) {
  console.error(`Worker could not connect to MongoDB: ${err.message}`);
  process.exit(1);
}
const worker = startWorker();
console.log(`[worker] ${worker.owner} polling every ${config().workerPollMs} ms`);
// Keep the process alive: the poll timer is unref'd so it never blocks API shutdown.
setInterval(() => {}, 60_000);
