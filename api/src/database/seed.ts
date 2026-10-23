import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source.js';
import { seedDemoData } from './demo-data.js';

const dataSource = new DataSource(dataSourceOptions());
await dataSource.initialize();
await dataSource.runMigrations();
await seedDemoData(dataSource);
await dataSource.destroy();
console.log('Seed complete.');
