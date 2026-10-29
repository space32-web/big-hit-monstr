// Письма: утренняя сводка, напоминание перед парой, после пар — проверить ДЗ в MAX.
// Запускается по расписанию каждые ~10 минут. Повторно одно и то же не шлёт (state/notify.json).
// Запуск: DATA_KEY=... MAIL_PASSWORD=... node scripts/notify.mjs [--dry] [--now 2026-06-02T15:45]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { config, dataKey, readJSON, writeJSON, SCHEDULE_FILE, STORE_FILE, STATE_DIR } from './lib/common.mjs';
import { decryptJSON } from '../docs/js/crypto.js';
import { blocksForDate, findTeachers, hwOpen, lessonMs, normName, plural, todayISO, addDays, TZ_OFFSET_HOURS } from '../docs/js/lessons.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const nowArg = args.includes('--now') ? args[args.indexOf('--now') + 1] : null;
const nowMs = nowArg ? Date.parse(nowArg + 'Z') - TZ_OFFSET_HOURS * 3600e3 : Date.now();

const key = dataKey();
if (!existsSync(SCHEDULE_FILE)) {
  console.log('Расписание ещё не загружено — запусти fetch-schedule');
  process.exit(0);
}
const schedule = await decryptJSON(readJSON(SCHEDULE_FILE), key);
const store = await decryptJSON(readJSON(STORE_FILE), key);
const statePath = join(STATE_DIR, 'notify.json');
const state = readJSON(statePath, { sent: {} });
const { fio, group } = store.settings;
const n = config.notify;
const mailUser = process.env.MAIL_USER; // ящик mail.ru: с него шлём и на него же
const appUrl = process.env.APP_URL || '';

const today = todayISO(nowMs);
const blocks = blocksForDate(schedule, today);
const openHw = hwOpen(store);
const minutes = ms => Math.round(ms / 60000);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const button = (href, text) =>
  `<a href="${esc(href)}" style="display:inline-block;padding:10px 16px;background:#8b1e3f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${esc(text)}</a>`;
const appLink = appUrl ? `<p>${button(appUrl, 'Открыть трекер')}</p>` : '';

function hwList(items) {
  if (!items.length) return '<p style="color:#666">Открытых ДЗ нет.</p>';
  return '<ul>' + items.map(h => `<li><b>${esc(h.subject)}</b>${h.due ? ` — до ${esc(h.due)}` : ''}: ${esc(h.text)}</li>`).join('') + '</ul>';
}

function blockLine(b) {
  const t = findTeachers(store.teachers, b.teacher).map(t => t.name).join(', ') || b.teacher;
  return `<b>${b.start}–${b.end}</b> ${esc(b.subject)}${t ? ` <span style="color:#666">(${esc(t)})</span>` : ''}`;
}

const outbox = [];

// 1. Утренняя сводка
const digestAt = lessonMs(today, n.digestAt);
const hwSoon = openHw.filter(h => h.due && h.due <= addDays(today, 1));
if (!state.sent[`digest:${today}`] && nowMs >= digestAt && nowMs < lessonMs(today, '13:00') && (blocks.length || hwSoon.length)) {
  outbox.push({
    key: `digest:${today}`,
    subject: blocks.length ? `Сегодня ${plural(blocks.length, 'пара', 'пары', 'пар')}, первая в ${blocks[0].start}` : 'Сегодня пар нет, но есть ДЗ',
    html:
      `<h3>Пары на ${today}</h3>` +
      (blocks.length ? '<ul>' + blocks.map(b => `<li>${blockLine(b)}</li>`).join('') + '</ul>' : '<p>Пар нет.</p>') +
      `<h3>Открытые ДЗ</h3>${hwList(openHw)}${appLink}`,
  });
}

// 2. Напоминание перед каждой парой
for (const b of blocks) {
  const k = `pair:${today}:${b.start}`;
  const left = minutes(b.startMs - nowMs);
  if (state.sent[k] || left > n.remindBeforeMin || left < -15) continue;
  const teachers = findTeachers(store.teachers, b.teacher);
  const room = teachers.find(t => t.room)?.room;
  const hw = openHw.filter(h => normName(h.subject) === normName(b.subject));
  outbox.push({
    key: k,
    subject: `${left > 0 ? `Через ${left} мин` : 'Уже идёт'}: ${b.subject} (${b.start})`,
    html:
      `<p>${blockLine(b)}</p>` +
      (room ? `<p>${button(room, 'Подключиться к паре')}</p>` : '<p style="color:#b00">Ссылки на комнату нет — добавь её в трекере.</p>') +
      `<p>Имя для входа: <code>${esc(fio)} ${esc(group)}</code><br>В чат: <code>${esc(fio)}, я на паре</code></p>` +
      (hw.length ? `<h3>ДЗ по предмету</h3>${hwList(hw)}` : '') +
      appLink,
  });
}

// 3. После последней пары — проверить ДЗ в MAX
const last = blocks[blocks.length - 1];
if (last && !state.sent[`hw:${today}`] && nowMs >= last.endMs + 5 * 60000 && nowMs < last.endMs + 4 * 3600e3) {
  const subjects = [...new Set(blocks.map(b => b.subject))];
  outbox.push({
    key: `hw:${today}`,
    subject: 'Пары закончились — проверь ДЗ в MAX',
    html:
      `<p>Проверь в MAX, что задали по предметам:</p><ul>${subjects.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` +
      `<p>и внеси задания в трекер.</p>${appLink}`,
  });
}

if (!dry && outbox.length && (!mailUser || !process.env.MAIL_PASSWORD)) {
  console.log('Не заданы MAIL_USER / MAIL_PASSWORD — письма не отправлены');
  process.exit(0);
}

const transport = dry
  ? null
  : nodemailer.createTransport({
      host: n.smtpHost,
      port: n.smtpPort,
      secure: true,
      auth: { user: mailUser, pass: process.env.MAIL_PASSWORD },
    });

for (const m of outbox) {
  if (dry) {
    console.log(`--- [dry] ${m.subject}\n${m.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`);
  } else {
    await transport.sendMail({ from: `КНН трекер <${mailUser}>`, to: mailUser, subject: m.subject, html: m.html });
    console.log(`Отправлено: ${m.subject}`);
  }
  state.sent[m.key] = new Date(nowMs).toISOString();
}
if (!outbox.length) console.log('Нечего отправлять');

// Чистим старые отметки
const cutoff = addDays(today, -30);
for (const k of Object.keys(state.sent)) if ((k.split(':')[1] || '') < cutoff) delete state.sent[k];
if (!dry) writeJSON(statePath, state);
