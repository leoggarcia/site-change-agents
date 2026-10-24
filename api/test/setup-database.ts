import { Redis } from 'ioredis';
import { Client as PgClient } from 'pg';
import { DataSource } from 'typeorm';
import { dataSourceOptions, LOCAL_DATABASE_URL } from '../src/database/data-source.js';
import { seedDemoData } from '../src/database/demo-data.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL.replace(/\/[^/]+$/, '/change_agents_test');

/** Recreates the test database from scratch, runs the migrations and loads the demo data. */
export async function resetTestDatabase(): Promise<void> {
  const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const admin = new PgClient({ connectionString: TEST_DATABASE_URL.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const dataSource = new DataSource(dataSourceOptions(TEST_DATABASE_URL));
  await dataSource.initialize();
  await dataSource.runMigrations();
  await seedDemoData(dataSource);
  await dataSource.destroy();
}

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

/** Empties the test Redis database (its own database number, so local queues are left alone). */
export async function resetTestRedis(): Promise<void> {
  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
}
