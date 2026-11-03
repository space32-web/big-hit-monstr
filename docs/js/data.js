// Данные: зашифрованные файлы в репозитории GitHub. Читаем со статики сайта или через API,
// пишем через Contents API общим токеном. Всё состояние приложения — в объекте S.
import { encryptJSON, decryptJSON, userFileId } from './crypto.js';
import { groupDays, normGroup } from './lessons.js';
import { LS, toast } from './util.js';

export const SCHEDULE_PATH = 'data/schedule.enc.json';
export const SHARED_PATH = 'data/shared.enc.json';
export const LINKS_PATH = 'data/links.enc.json'; // привязки ВК, пишет бот рассылки

export const S = {
  pass: LS.get('pass'),
  uid: null,          // id пользователя — выводится из пароля
  userPath: null,     // data/users/<id>.enc.json
  notifyPath: null,   // data/notify/<id>.enc.json — код привязки ВК и push-подписки
  store: null,        // личное: settings, homework, sharedKey
  shared: null,       // общее: teachers, days, users, ссылки
  allSchedule: null,  // расписание всех групп из старой таблицы
  schedule: null,     // { group, days } просматриваемой группы
  notify: null,       // { vkCode, push: [] }
  links: null,        // { vk: { <id>: peer } }
  offline: false,
};
const shas = {}; // sha файлов в репозитории для обновления через API

export function repo() {
  const saved = LS.get('repo');
  if (saved) return saved;
  if (location.hostname.endsWith('.github.io')) {
    const owner = location.hostname.split('.')[0];
    const name = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
    return `${owner}/${name}`;
  }
  return '';
}
const token = () => LS.get('token') || S.shared?.ghToken;
export const canWrite = () => Boolean(token() && repo());

export function ghHeaders() {
  return { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json' };
}

// С токеном читаем через API (без кэша Pages), иначе — статикой с сайта
async function fetchBox(path) {
  if (canWrite()) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo()}/contents/docs/${path}?ref=main&t=${Date.now()}`, { headers: ghHeaders() });
      if (res.ok) {
        const j = await res.json();
        return { box: JSON.parse(atob(j.content.replace(/\n/g, ''))), sha: j.sha };
      }
    } catch {}
  }
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(`${path}: ${res.status}`), { status: res.status });
  return { box: await res.json(), sha: null };
}

// Файл из сети, а без сети — последняя сохранённая копия
async function loadBox(path) {
  try {
    const { box, sha } = await fetchBox(path);
    LS.set('cache:' + path, JSON.stringify(box));
    shas[path] = sha;
    return box;
  } catch (e) {
    const cached = LS.get('cache:' + path);
    if (!cached || e.status) throw e;
    S.offline = true;
    return JSON.parse(cached);
  }
}

export async function loadData() {
  S.offline = false;
  S.uid = await userFileId(S.pass);
  S.userPath = `data/users/${S.uid}.enc.json`;
  S.notifyPath = `data/notify/${S.uid}.enc.json`;
  S.store = await decryptJSON(await loadBox(S.userPath), S.pass);
  const key = S.store.sharedKey;
  // файлов уведомлений может ещё не быть — это не ошибка
  const optional = path => loadBox(path).then(box => decryptJSON(box, key)).catch(() => null);
  const [schedBox, sharedBox, notify, links] = await Promise.all([loadBox(SCHEDULE_PATH), loadBox(SHARED_PATH), optional(S.notifyPath), optional(LINKS_PATH)]);
  S.allSchedule = await decryptJSON(schedBox, key);
  S.shared = await decryptJSON(sharedBox, key);
  S.notify = notify || { push: [] };
  S.links = links || { vk: {} };
  applyGroup();
}

// Админ может смотреть любую группу, остальные — свою
export function viewGroup() {
  return normGroup((S.store.admin && LS.get('adminGroup')) || S.store.settings.group);
}

export function applyGroup() {
  const group = viewGroup();
  S.schedule = { ...S.allSchedule, group, days: groupDays(S.allSchedule, S.shared, group) };
}

export async function saveFile(path, obj, key, message) {
  if (!canWrite()) {
    toast('Сохранение недоступно: нет доступа к GitHub');
    return false;
  }
  const box = await encryptJSON(obj, key);
  const url = `https://api.github.com/repos/${repo()}/contents/docs/${path}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!shas[path]) {
      const cur = await fetch(`${url}?ref=main&t=${Date.now()}`, { headers: ghHeaders() });
      if (cur.ok) shas[path] = (await cur.json()).sha;
    }
    const body = JSON.stringify({ message, content: btoa(JSON.stringify(box, null, 2) + '\n'), sha: shas[path] || undefined, branch: 'main' });
    const res = await fetch(url, { method: 'PUT', headers: ghHeaders(), body });
    if (res.ok) {
      shas[path] = (await res.json()).content.sha;
      LS.set('cache:' + path, JSON.stringify(box));
      return true;
    }
    if (res.status === 409 || res.status === 422) { shas[path] = null; continue; }
    toast(`Не сохранилось: GitHub ответил ${res.status}`);
    return false;
  }
  toast('Не сохранилось: конфликт версий, обнови страницу');
  return false;
}

export const saveStore = message => saveFile(S.userPath, S.store, S.pass, message);
export const saveShared = message => saveFile(SHARED_PATH, S.shared, S.store.sharedKey, message);
export const saveNotify = message => saveFile(S.notifyPath, S.notify, S.store.sharedKey, message);

export function forget() {
  ['pass', 'token', 'joined', 'cache:' + SCHEDULE_PATH, 'cache:' + SHARED_PATH, 'cache:' + LINKS_PATH, 'cache:' + S.userPath, 'cache:' + S.notifyPath].forEach(LS.del);
}
