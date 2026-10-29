import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEDULE_FILE = join(ROOT, 'docs', 'data', 'schedule.enc.json');
export const STORE_FILE = join(ROOT, 'docs', 'data', 'store.enc.json');
export const STATE_DIR = join(ROOT, 'state');

export function readJSON(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

export function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

export const config = readJSON(join(ROOT, 'config.json'));

export function dataKey() {
  const key = process.env.DATA_KEY;
  if (!key) throw new Error('Не задан DATA_KEY (пароль для шифрования данных)');
  return key;
}
