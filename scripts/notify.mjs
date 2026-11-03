// Напоминания всем пользователям: сообщения от ВК-бота и push на телефон.
// Утренняя сводка, напоминание перед парой, после пар — проверить ДЗ в MAX.
// Запускается каждые ~5 минут. Повторно одно и то же не шлёт (state/notify.json).
//
// Кто что включил, сайт пишет в data/notify/<id>.enc.json (код привязки ВК, push-подписки).
// Привязку ВК делает этот скрипт: читает сообщения сообществу, находит код и запоминает
// собеседника в data/links.enc.json. Всё шифруется общим ключом.
//
// Запуск: DATA_KEY=... VK_TOKEN=... VAPID_PRIVATE=... node scripts/notify.mjs [--dry] [--now 2026-06-02T15:45]
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { config, sharedKey, readShared, readJSON, writeJSON, LINKS_FILE, NOTIFY_DIR, REQUESTS_FILE, SCHEDULE_FILE, STATE_DIR } from './lib/common.mjs';
import { decryptJSON, encryptJSON } from '../docs/js/crypto.js';
import { blocksForDate, findTeachers, groupDays, lessonMs, lessonRoom, plural, todayISO, addDays, TZ_OFFSET_HOURS } from '../docs/js/lessons.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const nowArg = args.includes('--now') ? args[args.indexOf('--now') + 1] : null;
const nowMs = nowArg ? Date.parse(nowArg + 'Z') - TZ_OFFSET_HOURS * 3600e3 : Date.now();

if (!existsSync(SCHEDULE_FILE)) {
  console.log('Расписание ещё не загружено');
  process.exit(0);
}
const key = sharedKey();
const shared = await readShared();
const all = await decryptJSON(readJSON(SCHEDULE_FILE), key);
const links = existsSync(LINKS_FILE) ? await decryptJSON(readJSON(LINKS_FILE), key) : { vk: {} };
let linksChanged = false;
// Заявки на аккаунт: бот принимает их в ВК, админ одобряет на сайте, бот присылает логин и пароль
const requests = existsSync(REQUESTS_FILE) ? await decryptJSON(readJSON(REQUESTS_FILE), key) : { items: [] };
let requestsChanged = false;
const statePath = join(STATE_DIR, 'notify.json');
const state = readJSON(statePath, { sent: {} });
const n = config.notify;
const appUrl = process.env.APP_URL || '';
const vkToken = process.env.VK_TOKEN;
const vapidPrivate = process.env.VAPID_PRIVATE;
if (vapidPrivate) webpush.setVapidDetails(appUrl || 'https://github.com', n.vapidPublic, vapidPrivate);

// Настройки уведомлений каждого пользователя
const prefs = {};
if (existsSync(NOTIFY_DIR)) {
  for (const f of readdirSync(NOTIFY_DIR).filter(f => f.endsWith('.enc.json'))) {
    try {
      prefs[f.replace('.enc.json', '')] = await decryptJSON(readJSON(join(NOTIFY_DIR, f)), key);
    } catch (e) {
      console.log(`Не прочитался ${f}: ${e.message}`);
    }
  }
}
const userById = id => (shared.users || []).find(u => u.id === id);

// ---------- ВК ----------

async function vk(method, params) {
  const body = new URLSearchParams({ ...params, access_token: vkToken, v: '5.199' });
  const res = await fetch('https://api.vk.com/method/' + method, { method: 'POST', body });
  const j = await res.json();
  if (j.error) throw new Error(`VK ${method}: ${j.error.error_msg}`);
  return j.response;
}

const vkSend = (peer, text) =>
  dry ? console.log(`--- [dry vk ${peer}] ${text}`) : vk('messages.send', { peer_id: peer, random_id: randomInt(2 ** 31), message: text });

const adminPeers = () => (shared.users || []).filter(u => u.admin && links.vk[u.id]).map(u => links.vk[u.id]);

// «Заявка: Иванов Иван Иванович, 3427А» — так её формирует экран входа
async function takeRequest(peer, text) {
  const m = text.match(/^заявка\s*[:\-—]?\s*(.+?)\s*[,;]\s*(\d{3,4}\s*[А-ЯЁA-Zа-яёa-z]?)\s*$/i);
  if (!m) return vkSend(peer, 'Чтобы попросить аккаунт, пришли так:\nЗаявка: Фамилия Имя Отчество, группа\nНапример: Заявка: Иванов Иван Иванович, 3427А');
  const fio = m[1].replace(/\s+/g, ' ');
  const group = m[2].replace(/\s+/g, '').toUpperCase().replace(/A/g, 'А');
  if (requests.items.some(r => r.peer === peer && r.status === 'new')) return vkSend(peer, 'Твоя заявка уже у админа, жди ответа.');
  requests.items.push({ id: randomUUID(), fio, group, peer, at: new Date(nowMs).toISOString(), status: 'new' });
  requestsChanged = true;
  await vkSend(peer, `Заявка принята: ${fio}, ${group}. Когда админ создаст аккаунт, я пришлю сюда логин и пароль.`);
  for (const admin of adminPeers()) await vkSend(admin, `Новая заявка на аккаунт: ${fio}, ${group}. Одобрить: ${appUrl} → Админ → Запросы из ВК.`);
}

// «Сброс пароля: EgGrigorev». Новый пароль уйдёт только в ВК, привязанный к этому логину
async function takeReset(peer, text) {
  const login = text.replace(/^сброс(\s+пароля)?\s*[:\-—]?\s*/i, '').trim();
  const user = (shared.users || []).find(u => (u.login || '').toLowerCase() === login.toLowerCase());
  if (!login) return vkSend(peer, 'Пришли так: Сброс пароля: твой логин');
  if (!user) return vkSend(peer, `Логина «${login}» нет. Логин — две буквы имени и фамилия латиницей, например IvIvanov.`);
  if (requests.items.some(r => r.type === 'reset' && r.login === user.login && r.status === 'new')) return vkSend(peer, 'Запрос на сброс уже у админа, жди ответа.');
  const linked = links.vk[user.id];
  requests.items.push({ id: randomUUID(), type: 'reset', fio: user.fio, group: user.group, login: user.login, peer, linked: Boolean(linked), at: new Date(nowMs).toISOString(), status: 'new' });
  requestsChanged = true;
  await vkSend(peer, linked
    ? 'Запрос на сброс пароля отправлен админу. Новый пароль придёт в ВК, привязанный к аккаунту.'
    : 'Запрос отправлен админу. К аккаунту не привязан ВК, поэтому новый пароль админ передаст лично.');
  for (const admin of adminPeers()) await vkSend(admin, `Запрос на сброс пароля: ${user.fio} (${user.login})${linked ? '' : ', ВК не привязан'}. ${appUrl} → Админ → Запросы из ВК.`);
}

// Ответ по заявкам, которые админ уже разобрал
async function deliverRequests() {
  for (const r of requests.items) {
    if (r.type === 'reset' && r.status === 'approved') {
      // только в привязанный к аккаунту ВК: иначе по чужому логину можно было бы получить пароль
      const user = (shared.users || []).find(u => u.login === r.login);
      const to = user && links.vk[user.id];
      if (to && r.password) await vkSend(to, `Пароль сброшен.\nЛогин: ${r.login}\nНовый пароль: ${r.password}\n\nСменить его можно на сайте во вкладке «Ещё». Это сообщение лучше удалить.`);
      if (!to) await vkSend(r.peer, 'Пароль сброшен. Новый пароль тебе передаст админ.');
      delete r.password;
      r.status = 'closed';
      requestsChanged = true;
    } else if (r.status === 'approved' && r.password) {
      await vkSend(r.peer, `Аккаунт готов!
Сайт: ${appUrl}
Логин: ${r.login}
Пароль: ${r.password}

Пароль можно сменить на сайте во вкладке «Ещё». Это сообщение лучше удалить.`);
      delete r.password;
      r.status = 'closed';
      requestsChanged = true;
    } else if (r.status === 'rejected') {
      await vkSend(r.peer, `Админ отклонил ${r.type === 'reset' ? 'запрос на сброс пароля' : 'заявку на аккаунт'}. Если это ошибка — напиши ему напрямую.`);
      r.status = 'closed';
      requestsChanged = true;
    }
  }
  // закрытые старше месяца больше не нужны
  const cutoff = nowMs - 30 * 86400e3;
  const before = requests.items.length;
  requests.items = requests.items.filter(r => r.status !== 'closed' || Date.parse(r.at) > cutoff);
  requestsChanged ||= requests.items.length !== before;
}

// Отвечаем на новые сообщения сообществу: заявка, код с сайта — привязка, «стоп» — отвязка
async function processInbox() {
  const { items } = await vk('messages.getConversations', { filter: 'unanswered', count: 200 });
  for (const { conversation, last_message: msg } of items) {
    const peer = conversation.peer.id;
    const text = String(msg?.text || '').trim();
    const linked = Object.keys(links.vk).filter(id => links.vk[id] === peer);
    const code = text.match(/\b\d{6}\b/)?.[0];
    const uid = code && Object.keys(prefs).find(id => prefs[id].vkCode === code && userById(id));
    if (/^заявка/i.test(text)) {
      await takeRequest(peer, text);
    } else if (/^сброс/i.test(text)) {
      await takeReset(peer, text);
    } else if (/^(стоп|stop|отписаться)$/i.test(text)) {
      linked.forEach(id => delete links.vk[id]);
      linksChanged ||= linked.length > 0;
      await vkSend(peer, 'Готово, больше не пишу. Чтобы включить снова, пришли код с сайта.');
    } else if (uid) {
      links.vk[uid] = peer;
      linksChanged = true;
      const u = userById(uid);
      await vkSend(peer, `Привязал: ${u.fio}, ${u.group}. Буду писать утром о парах, за ${n.remindBeforeMin} минут до каждой пары и после пар про ДЗ. Отключить — напиши «стоп».`);
    } else if (linked.length) {
      await vkSend(peer, `Я только присылаю напоминания. Трекер: ${appUrl}\nОтключить — напиши «стоп».`);
    } else {
      await vkSend(peer, `Привет! Чтобы получать напоминания о парах, открой трекер (${appUrl}) → «Ещё» → «Уведомления» и пришли сюда код оттуда.
Нет аккаунта? Пришли: Заявка: Фамилия Имя Отчество, группа`);
    }
  }
}

if (vkToken) {
  try {
    await processInbox();
    await deliverRequests();
  } catch (e) {
    console.log('Сообщения ВК не прочитались: ' + e.message);
  }
}

// ---------- Push ----------

async function pushSend(subs, payload) {
  let ok = 0;
  for (const sub of subs) {
    if (state.deadPush?.includes(sub.endpoint)) continue;
    if (dry) {
      console.log(`--- [dry push] ${payload.title}: ${payload.body}`);
      ok++;
      continue;
    }
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      ok++;
    } catch (e) {
      // подписка удалена на устройстве — больше не пробуем
      if (e.statusCode === 404 || e.statusCode === 410) (state.deadPush ??= []).push(sub.endpoint);
      else console.log(`Push не ушёл: ${e.statusCode || e.message}`);
    }
  }
  return ok;
}

// ---------- Что отправить ----------

const today = todayISO(nowMs);
const minutes = ms => Math.round(ms / 60000);

function messagesFor(user) {
  const blocks = blocksForDate({ days: groupDays(all, shared, user.group) }, today);
  const teacher = b => findTeachers(shared.teachers, b.teacher).map(t => t.name.split(' ')[0]).join(', ') || b.teacher;
  const line = b => `${b.start}–${b.end} ${b.subject}${teacher(b) ? ` (${teacher(b)})` : ''}`;
  const out = [];

  // 1. Утренняя сводка
  if (blocks.length && nowMs >= lessonMs(today, n.digestAt) && nowMs < lessonMs(today, '13:00')) {
    const title = `Сегодня ${plural(blocks.length, 'пара', 'пары', 'пар')}, первая в ${blocks[0].start}`;
    out.push({ key: `digest:${today}`, title, text: `${title}:\n${blocks.map(line).join('\n')}`, body: blocks.map(line).join('\n'), url: appUrl });
  }

  // 2. Напоминание перед каждой парой. Если расписание опубликовали поздно — пока пара идёт
  for (const b of blocks) {
    const left = minutes(b.startMs - nowMs);
    if (left > n.remindBeforeMin || nowMs >= b.endMs - 5 * 60000) continue;
    const room = lessonRoom(shared.teachers, b);
    const title = `${left > 0 ? `Через ${left} мин` : `Уже идёт, до ${b.end}`}: ${b.subject}`;
    out.push({
      key: `pair:${today}:${b.start}`,
      title,
      text:
        `${title} (${b.start})\n${line(b)}\n\n` +
        (room ? `Подключиться: ${room}\n` : 'Ссылки на комнату пока нет.\n') +
        `Имя для входа: ${user.fio} ${user.group}\nВ чат: ${user.fio}, я на паре`,
      body: `${b.start}–${b.end}${teacher(b) ? ', ' + teacher(b) : ''}. Нажми, чтобы подключиться`,
      url: room || appUrl,
    });
  }

  // 3. После последней пары — проверить ДЗ в MAX
  const last = blocks[blocks.length - 1];
  if (last && nowMs >= last.endMs + 5 * 60000 && nowMs < last.endMs + 4 * 3600e3) {
    const subjects = [...new Set(blocks.map(b => b.subject))];
    out.push({
      key: `hw:${today}`,
      title: 'Пары закончились — проверь ДЗ в MAX',
      text: `Пары закончились. Проверь в MAX, что задали:\n${subjects.map(s => '• ' + s).join('\n')}\n\nИ внеси задания в трекер: ${appUrl}`,
      body: subjects.join(', '),
      url: appUrl,
    });
  }
  return out;
}

let sentCount = 0;
for (const user of shared.users || []) {
  const peer = links.vk[user.id];
  const subs = prefs[user.id]?.push || [];
  if (!peer && !subs.length) continue;
  for (const m of messagesFor(user)) {
    const k = `${user.id}:${m.key}`;
    if (state.sent[k]) continue;
    let delivered = 0;
    if (peer && vkToken) {
      try {
        await vkSend(peer, m.text);
        delivered++;
      } catch (e) {
        console.log(`ВК → ${user.fio}: ${e.message}`);
      }
    } else if (peer && dry) {
      await vkSend(peer, m.text);
      delivered++;
    }
    if (subs.length && (vapidPrivate || dry)) delivered += await pushSend(subs, { title: m.title, body: m.body || m.text, url: m.url, tag: k });
    if (delivered) {
      state.sent[k] = new Date(nowMs).toISOString();
      sentCount++;
      console.log(`${user.fio}: ${m.title}`);
    }
  }
}
if (!sentCount) console.log('Нечего отправлять');

// Чистим старые отметки
const cutoff = addDays(today, -30);
for (const k of Object.keys(state.sent)) if ((k.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '') < cutoff) delete state.sent[k];
if (!dry) {
  writeJSON(statePath, state);
  if (linksChanged) writeJSON(LINKS_FILE, await encryptJSON(links, key));
  if (requestsChanged) writeJSON(REQUESTS_FILE, await encryptJSON(requests, key));
}
