import { PoolConfig } from 'pg';

export const dbConfig: PoolConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'xjog',
  password: process.env.DB_PASSWORD ?? 'xjog',
  database: process.env.DB_DATABASE ?? 'xjog',
  port: Number(process.env.DB_PORT) ?? 5432,
  min: 0,
};
