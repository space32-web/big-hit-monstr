// Распознавание скрина расписания через Perplexity (обычный запрос к модели, без агентов и без поиска).
// Из браузера API Perplexity недоступен (нет CORS), поэтому админка кладёт скрин в
// data/inbox/request.enc.json, а этот скрипт в GitHub Actions отвечает в data/inbox/result.enc.json.
// Запуск: DATA_KEY=... PPLX_KEY=... node scripts/ai-recognize.mjs
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readJSON, writeJSON, sharedKey } from './lib/common.mjs';
import { decryptJSON, encryptJSON } from '../docs/js/crypto.js';

const INBOX = join(ROOT, 'docs', 'data', 'inbox');
const requestFile = join(INBOX, 'request.enc.json');
if (!existsSync(requestFile)) {
  console.log('Запроса нет');
  process.exit(0);
}
const key = sharedKey();
const req = await decryptJSON(readJSON(requestFile), key);

const schema = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    pairs: { type: 'array', items: { type: 'object', properties: { subject: { type: 'string' }, teacher: { type: 'string' } }, required: ['subject', 'teacher'] } },
  },
  required: ['group', 'pairs'],
};

async function ask() {
  if (!process.env.PPLX_KEY) throw new Error('не задан секрет PPLX_KEY в GitHub');
  const res = await fetch('https://api.perplexity.ai/v1/sonar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PPLX_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar-pro',
      disable_search: true,
      temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: req.prompt }, { type: 'image_url', image_url: { url: req.image } }] }],
      response_format: { type: 'json_schema', json_schema: { schema } },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Perplexity ответил ${res.status}: ${j.error?.message || ''}`.trim());
  const text = j.choices[0].message.content;
  console.log('Стоимость:', j.usage?.cost?.total_cost);
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

let result;
try {
  result = { id: req.id, ok: true, ...(await ask()) };
} catch (e) {
  result = { id: req.id, ok: false, error: e.message };
}
console.log(result.ok ? `Распознано пар: ${result.pairs.length}` : 'Ошибка: ' + result.error);
writeJSON(join(INBOX, 'result.enc.json'), await encryptJSON(result, key));
rmSync(requestFile);
