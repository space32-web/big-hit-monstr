// Первичное заполнение: шифрует seed/store.json (преподаватели, ФИО) в docs/data/store.enc.json.
// Запуск: DATA_KEY=... node scripts/seed.mjs [--force]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, STORE_FILE, dataKey, readJSON, writeJSON } from './lib/common.mjs';
import { encryptJSON } from '../docs/js/crypto.js';

if (existsSync(STORE_FILE) && !process.argv.includes('--force')) {
  console.log('store.enc.json уже есть — ДЗ не трогаю. Для перезаписи: --force');
  process.exit(0);
}
const store = readJSON(join(ROOT, 'seed', 'store.json'));
store.homework ??= [];
writeJSON(STORE_FILE, await encryptJSON(store, dataKey()));
console.log(`Записано: ${store.teachers.length} преподавателей`);
