import mongoose from 'mongoose';
import { config } from './config.js';
import * as models from './models/index.js';

export async function connectDb(uri = config().mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // init() builds the declared indexes; uniqueness is enforced by the database.
  await Promise.all(
    Object.values(models)
      .filter((m) => typeof m?.init === 'function')
      .map((m) => m.init()),
  );
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function dbReady() {
  return mongoose.connection.readyState === 1;
}
