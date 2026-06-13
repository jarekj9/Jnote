import { SqliteConnector } from './sqliteConnector.js';
// To swap backends later: add an `if (process.env.STORAGE === 'postgres') return new PostgresConnector();`
// and add the import. The rest of the app should not need to change.

let _instance = null;

export function getStorage() {
  if (!_instance) _instance = new SqliteConnector();
  return _instance;
}
