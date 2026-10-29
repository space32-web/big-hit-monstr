import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptJSON } from '../../docs/js/crypto.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEDULE_FILE = join(ROOT, 'docs', 'data', 'schedule.enc.json');
export const SHARED_FILE = join(ROOT, 'docs', 'data', 'shared.enc.json');
export const USERS_DIR = join(ROOT, 'docs', 'data', 'users');
export const STATE_DIR = join(ROOT, 'state');

export function readJSON(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

export function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

export const config = readJSON(join(ROOT, 'config.json'));

// Общий ключ: им зашифрованы расписание и преподаватели. Лежит в каждом файле пользователя.
export function sharedKey() {
  const key = process.env.DATA_KEY;
  if (!key) throw new Error('Не задан DATA_KEY (общий ключ данных)');
  return key;
}

export async function readShared() {
  return decryptJSON(readJSON(SHARED_FILE), sharedKey());
}
