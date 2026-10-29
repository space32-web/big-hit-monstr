import { encryptJSON, decryptJSON, userFileId } from './crypto.js';
import {
  addDays, blocksForDate, collegeNow, findTeachers, hwOpen, nextSubjectDate, normGroup, normName, plural, todayISO, upcomingBlocks,
} from './lessons.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// localStorage может быть недоступен (приватный режим) — не падаем
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const SCHEDULE_PATH = 'data/schedule.enc.json';
const SHARED_PATH = 'data/shared.enc.json';

let pass = LS.get('pass');
let userPath = null;     // data/users/<id>.enc.json — выводится из пароля
let allSchedule = null;  // расписание всех групп из профилей
let schedule = null;     // { days } группы этого пользователя
let store = null;        // личное: settings, homework, sharedKey
let shared = null;       // общее: teachers, groups
const shas = {};         // sha файлов в репозитории для обновления через API
let weekStart = mondayOf(todayISO());

// ---------- Доступ к данным ----------

function repo() {
  const saved = LS.get('repo');
  if (saved) return saved;
  if (location.hostname.endsWith('.github.io')) {
    const owner = location.hostname.split('.')[0];
    const name = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
    return `${owner}/${name}`;
  }
  return '';
}
const token = () => LS.get('token') || store?.ghToken;
const canWrite = () => Boolean(token() && repo());

function ghHeaders() {
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
    loadBox.offline = true;
    return JSON.parse(cached);
  }
}

async function loadData() {
  loadBox.offline = false;
  userPath = `data/users/${await userFileId(pass)}.enc.json`;
  store = await decryptJSON(await loadBox(userPath), pass);
  const [schedBox, sharedBox] = await Promise.all([loadBox(SCHEDULE_PATH), loadBox(SHARED_PATH)]);
  allSchedule = await decryptJSON(schedBox, store.sharedKey);
  shared = await decryptJSON(sharedBox, store.sharedKey);
  applyGroup();
  if (loadBox.offline) toast('Нет сети — показаны сохранённые данные');
}

function applyGroup() {
  const days = allSchedule.groups[normGroup(store.settings.group)] || {};
  schedule = { ...allSchedule, group: normGroup(store.settings.group), days };
}

async function saveFile(path, obj, key, message) {
  if (!canWrite()) {
    toast('Чтобы сохранять, добавь GitHub-токен во вкладке «Ещё»');
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

const saveStore = message => saveFile(userPath, store, pass, message);
const saveShared = message => saveFile(SHARED_PATH, shared, store.sharedKey, message);

// ---------- Время и форматирование ----------

function mondayOf(iso) {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay() || 7;
  return addDays(iso, 1 - day);
}

function dayTitle(iso) {
  const s = new Date(iso + 'T00:00:00Z').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return s[0].toUpperCase() + s.slice(1);
}

function shortDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function duration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

function whenLabel(iso) {
  const today = todayISO();
  if (iso === today) return 'сегодня';
  if (iso === addDays(today, 1)) return 'завтра';
  return dayTitle(iso).toLowerCase();
}

// ---------- Действия ----------

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function roomFor(block) {
  return findTeachers(shared.teachers, block.teacher).find(t => t.room)?.room || '';
}

const joinName = () => `${store.settings.fio} ${store.settings.group}`;
const chatText = () => `${store.settings.fio}, я на паре`;

async function join(block) {
  const room = roomFor(block);
  if (!room) return toast('Нет ссылки на комнату — добавь во вкладке «Ещё»');
  const copied = copy(joinName()); // копируем, пока действует клик пользователя
  const win = window.open(room, '_blank');
  if (win) win.opener = null;
  toast((await copied) ? 'Имя скопировано — вставь его в поле «Имя»' : `Имя для входа: ${joinName()}`);
  if (!win) setTimeout(() => (location.href = room), 1500);
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, date, start, id, subject } = el.dataset;
  if (action === 'join') {
    const b = blocksForDate(schedule, date).find(b => b.start === start);
    if (b) join(b);
  } else if (action === 'copy-chat') {
    toast((await copy(chatText())) ? 'Скопировано: «' + chatText() + '»' : chatText());
  } else if (action === 'add-hw') {
    showTab('hw');
    $('#hwSubject').value = subject;
    $('#hwDue').value = nextSubjectDate(schedule, subject, todayISO());
    $('#hwText').focus();
  } else if (action === 'hw-del') {
    if (!confirm('Удалить задание?')) return;
    const prev = store.homework;
    store.homework = store.homework.filter(h => h.id !== id);
    renderAll();
    if (!(await saveStore('ДЗ: удалено'))) { store.homework = prev; renderAll(); }
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.matches('[data-hw-toggle]')) {
    const h = store.homework.find(h => h.id === el.dataset.hwToggle);
    h.done = el.checked;
    h.doneAt = el.checked ? new Date().toISOString() : undefined;
    renderAll();
    if (!(await saveStore(el.checked ? 'ДЗ: выполнено' : 'ДЗ: снова открыто'))) { h.done = !el.checked; renderAll(); }
  } else if (el.matches('[data-teacher-room]')) {
    const t = shared.teachers[Number(el.dataset.teacherRoom)];
    const prev = t.room;
    t.room = el.value.trim();
    if (await saveShared(`Ссылка: ${t.name}`)) toast('Ссылка сохранена');
    else { t.room = prev; renderTeachers(); }
  }
});

// ---------- Отрисовка ----------

function teacherNames(block) {
  return findTeachers(shared.teachers, block.teacher).map(t => t.name).join(', ') || block.teacher;
}

function hwCountFor(subject) {
  return hwOpen(store).filter(h => normName(h.subject) === normName(subject)).length;
}

function lessonCard(b, now) {
  const state = b.endMs <= now ? 'past' : b.startMs <= now ? 'now' : '';
  const hw = hwCountFor(b.subject);
  const extra = [b.place, b.note].filter(Boolean).join(' · ');
  const room = roomFor(b);
  return `
    <div class="lesson ${state}">
      <div class="time">${b.start}<small>${b.end}</small></div>
      <div>
        <div class="subj">${esc(b.subject)}${b.count > 1 ? ` <span class="muted small">×${b.count}</span>` : ''}</div>
        <div class="meta">${esc(teacherNames(b))}${extra ? ' · ' + esc(extra) : ''}</div>
        <div class="row">
          ${state === 'now' ? '<span class="chip ok">идёт сейчас</span>' : ''}
          ${hw ? `<span class="chip">${plural(hw, 'ДЗ', 'ДЗ', 'ДЗ')}</span>` : ''}
          ${state !== 'past' && room ? `<button class="btn small primary" data-action="join" data-date="${b.date}" data-start="${b.start}">Войти</button>` : ''}
          ${state !== 'past' && !room ? '<span class="chip">нет ссылки</span>' : ''}
          <button class="btn small" data-action="add-hw" data-subject="${esc(b.subject)}">+ ДЗ</button>
        </div>
      </div>
    </div>`;
}

function renderHero(now) {
  const next = upcomingBlocks(schedule, now)[0];
  const hero = $('#hero');
  if (!next) {
    const dates = Object.keys(schedule.days).sort();
    hero.innerHTML = `
      <div class="state">Пар не найдено</div>
      <div class="subject">В расписании нет ближайших пар</div>
      <div class="countdown muted">Последний день в файле: ${dates.length ? esc(dayTitle(dates[dates.length - 1])) : '—'}.
      Если начался новый семестр — проверь ссылку на расписание в config.json.</div>`;
    return;
  }
  const live = next.startMs <= now;
  const room = roomFor(next);
  hero.innerHTML = `
    <div class="state">${live ? 'Идёт пара' : 'Следующая пара'}</div>
    <div class="subject">${esc(next.subject)}</div>
    <div class="countdown">${live
      ? `до конца ${duration(next.endMs - now)} (в ${next.end})`
      : `${whenLabel(next.date)} в ${next.start} — через ${duration(next.startMs - now)}`}
      <div class="muted small">${esc(teacherNames(next))}</div></div>
    <div class="actions">
      ${room
        ? `<button class="btn primary" data-action="join" data-date="${next.date}" data-start="${next.start}">Войти на пару</button>`
        : '<span class="chip">Нет ссылки на комнату — добавь во вкладке «Ещё»</span>'}
      <button class="btn" data-action="copy-chat">Скопировать «я на паре»</button>
    </div>`;
}

function hwItem(h) {
  const overdue = !h.done && h.due && h.due < todayISO();
  return `
    <div class="hw ${h.done ? 'done' : ''} ${overdue ? 'overdue' : ''}">
      <input type="checkbox" ${h.done ? 'checked' : ''} data-hw-toggle="${h.id}" aria-label="Выполнено">
      <div>
        <div class="subj">${esc(h.subject)}</div>
        <div class="text">${esc(h.text)}</div>
        <div class="meta muted small">${h.due ? `${overdue ? 'просрочено, ' : ''}до ${esc(whenLabel(h.due))}` : 'без срока'}</div>
      </div>
      <button class="del" data-action="hw-del" data-id="${h.id}" aria-label="Удалить">×</button>
    </div>`;
}

function renderToday(now) {
  const today = todayISO(now);
  const blocks = blocksForDate(schedule, today);
  $('#todayList').innerHTML = blocks.length ? blocks.map(b => lessonCard(b, now)).join('') : '<div class="empty">Сегодня пар нет.</div>';
  const soon = hwOpen(store).filter(h => !h.due || h.due <= addDays(today, 3)).slice(0, 5);
  $('#todayHw').innerHTML = soon.length ? soon.map(hwItem).join('') : '<div class="empty">Срочных ДЗ нет.</div>';
}

function renderWeek(now) {
  $('#weekLabel').textContent = `${shortDate(weekStart)} — ${shortDate(addDays(weekStart, 6))}`;
  const today = todayISO(now);
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const blocks = blocksForDate(schedule, d);
    if (i === 6 && !blocks.length) continue; // пустое воскресенье не показываем
    html += `<div class="day-head ${d === today ? 'today' : ''}">${esc(dayTitle(d))}</div>`;
    html += blocks.length ? blocks.map(b => lessonCard(b, now)).join('') : '<div class="empty">Пар нет</div>';
  }
  $('#weekList').innerHTML = html;
}

function renderHw() {
  const open = hwOpen(store);
  $('#hwOpenList').innerHTML = open.length ? open.map(hwItem).join('') : '<div class="empty">Всё сделано 🎉</div>';
  const done = store.homework.filter(h => h.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  $('#hwDoneList').innerHTML = done.length ? done.map(hwItem).join('') : '<div class="empty">Пока пусто</div>';
  const badge = $('#hwBadge');
  badge.hidden = !open.length;
  badge.textContent = open.length;
  const subjects = [...new Set(Object.values(schedule.days).flat().map(l => l.subject))].sort();
  $('#subjects').innerHTML = subjects.map(s => `<option value="${esc(s)}">`).join('');
}

function renderTeachers() {
  $('#teacherList').innerHTML = shared.teachers
    .map((t, i) => `
      <div class="teacher">
        <div class="name">${esc(t.name)}</div>
        <input type="url" value="${esc(t.room)}" placeholder="ссылка на комнату" data-teacher-room="${i}">
      </div>`)
    .join('');
}

function renderMore() {
  renderTeachers();
  $('#sFio').value = store.settings.fio;
  $('#sGroup').value = store.settings.group;
  $('#repoInput').value = repo();
  $('#writeStatus').textContent = canWrite() ? '✓ Запись включена' : 'Только чтение — изменения не сохранятся';
  $('#writeStatus').className = 'small ' + (canWrite() ? '' : 'error');
  const fetched = schedule.fetchedAt ? new Date(schedule.fetchedAt).toLocaleString('ru-RU') : '—';
  const modified = schedule.modified ? new Date(schedule.modified).toLocaleString('ru-RU') : '—';
  $('#schedInfo').textContent = `Группа ${schedule.group}. Файл расписания изменён: ${modified}. Проверено: ${fetched}.`;
}

function renderClock(now) {
  const d = collegeNow(now);
  $('#clock').textContent = `${dayTitle(todayISO(now))}, ${d.toISOString().slice(11, 16)}`;
}

function renderAll() {
  const now = Date.now();
  renderClock(now);
  renderHero(now);
  renderToday(now);
  renderWeek(now);
  renderHw();
  renderMore();
}

// ---------- Вкладки и формы ----------

function showTab(name) {
  document.querySelectorAll('[data-view]').forEach(s => (s.hidden = s.dataset.view !== name));
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  LS.set('tab', name);
  scrollTo(0, 0);
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

$('#weekPrev').onclick = () => { weekStart = addDays(weekStart, -7); renderWeek(Date.now()); };
$('#weekNext').onclick = () => { weekStart = addDays(weekStart, 7); renderWeek(Date.now()); };
$('#weekLabel').onclick = () => { weekStart = mondayOf(todayISO()); renderWeek(Date.now()); };

$('#hwSubject').addEventListener('change', () => {
  if (!$('#hwDue').value) $('#hwDue').value = nextSubjectDate(schedule, $('#hwSubject').value, todayISO());
});

$('#hwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const item = {
    id: crypto.randomUUID(),
    subject: $('#hwSubject').value.trim(),
    text: $('#hwText').value.trim(),
    due: $('#hwDue').value,
    done: false,
    createdAt: new Date().toISOString(),
  };
  store.homework.push(item);
  renderAll();
  if (await saveStore(`ДЗ: ${item.subject}`)) {
    e.target.reset();
    toast('ДЗ добавлено');
  } else {
    store.homework = store.homework.filter(h => h.id !== item.id);
    renderAll();
  }
});

$('#teacherForm').addEventListener('submit', async e => {
  e.preventDefault();
  const t = { name: $('#tName').value.trim(), room: $('#tRoom').value.trim() };
  shared.teachers.push(t);
  if (await saveShared(`Преподаватель: ${t.name}`)) { e.target.reset(); toast('Добавлено'); }
  else shared.teachers.pop();
  renderTeachers();
});

$('#saveSettings').onclick = async () => {
  const prev = { ...store.settings };
  store.settings.fio = $('#sFio').value.trim();
  store.settings.group = normGroup($('#sGroup').value);
  if (!(await saveStore('Профиль'))) {
    store.settings = prev;
    return;
  }
  applyGroup();
  renderAll();
  // новая группа попадёт в расписание при следующей загрузке (раз в 2 часа)
  if (!shared.groups.includes(store.settings.group)) {
    shared.groups.push(store.settings.group);
    await saveShared(`Группа ${store.settings.group}`);
    return toast('Сохранено. Расписание новой группы появится в течение 2 часов');
  }
  toast('Сохранено');
};

$('#saveToken').onclick = () => {
  const r = $('#repoInput').value.trim();
  const t = $('#tokenInput').value.trim();
  r ? LS.set('repo', r) : LS.del('repo');
  if (t) LS.set('token', t);
  $('#tokenInput').value = '';
  for (const k of Object.keys(shas)) shas[k] = null;
  renderMore();
  toast('Сохранено на этом устройстве');
};

$('#logoutBtn').onclick = () => {
  if (!confirm('Удалить пароль и токен с этого устройства?')) return;
  ['pass', 'token', 'cache:' + SCHEDULE_PATH, 'cache:' + SHARED_PATH, 'cache:' + userPath].forEach(LS.del);
  location.reload();
};

$('#reloadBtn').onclick = async () => {
  try { await loadData(); renderAll(); toast('Обновлено'); } catch (e) { toast('Ошибка: ' + e.message); }
};

// ---------- Запуск ----------

async function start() {
  try {
    await loadData();
  } catch (e) {
    if (e.status === 404 || e.name === 'OperationError') { // файла под этот пароль нет — пароль неверный
      LS.del('pass');
      pass = null;
      return showLogin('Неверный пароль');
    }
    return showLogin('Не удалось загрузить данные: ' + e.message);
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  showTab(LS.get('tab') || 'today');
  renderAll();
  setInterval(() => { const now = Date.now(); renderClock(now); renderHero(now); renderToday(now); }, 30000);
}

function showLogin(err) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginErr').hidden = !err;
  $('#loginErr').textContent = err || '';
}

$('#loginForm').addEventListener('submit', e => {
  e.preventDefault();
  pass = $('#loginPass').value;
  LS.set('pass', pass);
  start();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
pass ? start() : showLogin();
