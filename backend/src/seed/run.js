import { connectDb, disconnectDb } from '../db.js';
import { seedDemo } from './index.js';

// Wipes the database and loads the deterministic demo dataset. Demo mode only.
try {
  await connectDb();
  console.log('Seeded demo data:', await seedDemo());
} catch (err) {
  console.error(`Seeding failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
