// Скачивает расписание с публичного Яндекс Диска, вытаскивает группы из профилей и сохраняет зашифрованным.
// Запуск: DATA_KEY=... node scripts/fetch-schedule.mjs [--plain out.json]
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseSchedule } from './lib/parse.mjs';
import { config, sharedKey, readShared, readJSON, writeJSON, SCHEDULE_FILE, STATE_DIR } from './lib/common.mjs';
import { encryptJSON } from '../docs/js/crypto.js';

const API = 'https://cloud-api.yandex.net/v1/disk/public/resources';

// Сеть до Яндекса иногда рвётся — несколько попыток с паузой
async function fetchRetry(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url);
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`Сбой сети (${e.cause?.code || e.message}), повтор ${i}…`);
      await new Promise(r => setTimeout(r, 3000 * i));
    }
  }
}

async function getJSON(url) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`Яндекс Диск ответил ${res.status}: ${await res.text()}`);
  return res.json();
}

async function download({ publicKey, path }) {
  const q = `public_key=${encodeURIComponent(publicKey)}&path=${encodeURIComponent(path)}`;
  const meta = await getJSON(`${API}?${q}`);
  const { href } = await getJSON(`${API}/download?${q}`);
  const res = await fetchRetry(href);
  if (!res.ok) throw new Error(`Не удалось скачать файл: ${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), modified: meta.modified };
}

const { groups } = await readShared();
const { buffer, modified } = await download(config.schedule);
const parsed = parseSchedule(buffer, groups);
for (const [g, days] of Object.entries(parsed)) {
  const dates = Object.keys(days).sort();
  console.log(`Группа ${g}: ${dates.length} дней с парами${dates.length ? `, ${dates[0]} … ${dates[dates.length - 1]}` : ''}`);
}

const plainIdx = process.argv.indexOf('--plain');
if (plainIdx > 0) {
  writeJSON(process.argv[plainIdx + 1], { modified, groups: parsed });
  process.exit(0);
}

const hash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
const statePath = join(STATE_DIR, 'schedule.json');
const state = readJSON(statePath, {});
if (state.hash === hash) {
  console.log('Расписание не изменилось');
  process.exit(0);
}
const fetchedAt = new Date().toISOString();
writeJSON(SCHEDULE_FILE, await encryptJSON({ modified, fetchedAt, groups: parsed }, sharedKey()));
writeJSON(statePath, { hash, modified, fetchedAt });
console.log('Расписание обновлено');
