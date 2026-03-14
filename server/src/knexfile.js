import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbPath = path.resolve(__dirname, '..', process.env.DB_PATH || './data/iris.db');

export default {
  client: 'better-sqlite3',
  connection: {
    filename: dbPath,
  },
  useNullAsDefault: true,
  migrations: {
    directory: path.resolve(__dirname, 'migrations'),
  },
  pool: {
    afterCreate: (conn, cb) => {
      conn.pragma('journal_mode = WAL');
      conn.pragma('foreign_keys = ON');
      cb();
    },
  },
};
