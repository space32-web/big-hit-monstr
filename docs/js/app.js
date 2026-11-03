// Запуск приложения, вход, вкладки, кнопки и формы. Данные — data.js, экраны — views.js.
import { S, applyGroup, canWrite, forget, ghHeaders, loadData, repo, saveFile, saveShared, saveStore } from './data.js';
import { addDays, blocksForDate, nextSubjectDate, todayISO } from './lessons.js';
import { notifyActions } from './notify.js';
import { $, LS, copy, dayTitle, esc, icon, mondayOf, toast } from './util.js';
import { chatText, joinName, renderAll, renderHero, renderLive, renderWeekOnly, roomFor, view } from './views.js';

// Иконки в разметке: <i data-ic="home"></i>
document.querySelectorAll('[data-ic]').forEach(el => (el.outerHTML = icon(el.dataset.ic)));

// ---------- Вход на пару ----------

// Компьютер — широкий экран с мышью: там пару удобно держать отдельным окном рядом с трекером
const isDesktop = () => matchMedia('(pointer: fine)').matches && screen.availWidth >= 1100;

// Встроить ВКС в трекер нельзя (X-Frame-Options: SAMEORIGIN), поэтому на компьютере —
// окно в левых 2/3 экрана, трекер остаётся справа. Одно и то же окно для повторного входа.
function openRoom(room) {
  if (!isDesktop()) return window.open(room, '_blank');
  const w = Math.round(screen.availWidth * 0.66), h = screen.availHeight;
  return window.open(room, 'knn-room', `popup,width=${w},height=${h},left=${screen.availLeft ?? 0},top=${screen.availTop ?? 0}`);
}

async function join(block) {
  const room = roomFor(block);
  if (!room) return toast('Ссылки на эту пару пока нет — её добавит админ');
  const copied = copy(joinName()); // копируем, пока действует клик пользователя
  const win = openRoom(room);
  if (win) win.opener = null;
  LS.set('joined', `${block.date} ${block.start}`);
  renderHero(Date.now());
  toast((await copied) ? 'Имя скопировано — вставь его в поле «Имя»' : `Имя для входа: ${joinName()}`);
  if (!win) setTimeout(() => (location.href = room), 1500);
}

// ---------- Кнопки ----------

const actions = {
  ...notifyActions,
  join: ({ date, start }) => {
    const b = blocksForDate(S.schedule, date).find(b => b.start === start);
    if (b) join(b);
  },
  'copy-name': async () => toast((await copy(joinName())) ? `Скопировано: «${joinName()}»` : joinName()),
  'copy-chat': async () => toast((await copy(chatText())) ? `Скопировано: «${chatText()}»` : chatText()),
  'add-hw': ({ subject }) => {
    showTab('hw');
    $('#hwSubject').value = subject;
    $('#hwDue').value = nextSubjectDate(S.schedule, subject, todayISO());
    $('#hwText').focus();
  },
  'hw-del': async ({ id }) => {
    if (!confirm('Удалить задание?')) return;
    const prev = S.store.homework;
    S.store.homework = prev.filter(h => h.id !== id);
    renderAll();
    if (!(await saveStore('ДЗ: удалено'))) { S.store.homework = prev; renderAll(); }
  },
  'goto-day': ({ date }) => document.getElementById('day-' + date)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el.dataset);
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (!el.matches('[data-hw-toggle]')) return;
  const h = S.store.homework.find(h => h.id === el.dataset.hwToggle);
  h.done = el.checked;
  h.doneAt = el.checked ? new Date().toISOString() : undefined;
  renderAll();
  if (!(await saveStore(el.checked ? 'ДЗ: выполнено' : 'ДЗ: снова открыто'))) { h.done = !el.checked; renderAll(); }
});

// ---------- Вкладки и формы ----------

function showTab(name) {
  document.querySelectorAll('[data-view]').forEach(s => (s.hidden = s.dataset.view !== name));
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  LS.set('tab', name);
  scrollTo(0, 0);
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

$('#weekPrev').onclick = () => { view.weekStart = addDays(view.weekStart, -7); renderWeekOnly(); };
$('#weekNext').onclick = () => { view.weekStart = addDays(view.weekStart, 7); renderWeekOnly(); };
$('#weekLabel').onclick = () => { view.weekStart = mondayOf(todayISO()); renderWeekOnly(); };

$('#hwSubject').addEventListener('change', () => {
  if (!$('#hwDue').value) $('#hwDue').value = nextSubjectDate(S.schedule, $('#hwSubject').value, todayISO());
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
  S.store.homework.push(item);
  renderAll();
  if (await saveStore(`ДЗ: ${item.subject}`)) {
    e.target.reset();
    toast('ДЗ добавлено');
  } else {
    S.store.homework = S.store.homework.filter(h => h.id !== item.id);
    renderAll();
  }
});

$('#logoutBtn').onclick = () => {
  if (!confirm('Выйти и удалить данные трекера с этого устройства?')) return;
  forget();
  location.reload();
};

$('#reloadBtn').onclick = async () => {
  $('#reloadBtn').classList.add('spin');
  try { await loadData(); renderAll(); toast('Обновлено'); } catch (e) { toast('Ошибка: ' + e.message); }
  $('#reloadBtn').classList.remove('spin');
};

// ---------- Запуск ----------

async function start() {
  try {
    await loadData();
  } catch (e) {
    if (e.status === 404 || e.name === 'OperationError') { // файла под этот пароль нет — пароль неверный
      LS.del('pass');
      S.pass = null;
      return showLogin('Неверный пароль');
    }
    return showLogin('Не удалось загрузить данные: ' + e.message);
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (S.offline) toast('Нет сети — показаны сохранённые данные');
  if (S.store.admin && !view.admin) {
    $('#adminTab').hidden = false;
    const { initAdmin } = await import('./admin.js');
    view.admin = initAdmin({
      get shared() { return S.shared; },
      get store() { return S.store; },
      get allSchedule() { return S.allSchedule; },
      get links() { return S.links; },
      LS, toast, esc, repo, canWrite, ghHeaders, saveFile, saveShared, saveStore, dayTitle,
      refresh() { applyGroup(); renderAll(); },
    });
  }
  const tab = LS.get('tab');
  showTab(tab === 'admin' && !S.store.admin ? 'today' : tab || 'today');
  renderAll();
  setInterval(renderLive, 30000);
  // новое расписание от админа подтягивается само: раз в 3 минуты и при возврате на вкладку
  setInterval(silentRefresh, 3 * 60000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && silentRefresh());
}

async function silentRefresh() {
  if (document.visibilityState !== 'visible' || document.activeElement?.matches('input, textarea')) return;
  try {
    await loadData();
    renderAll();
  } catch {}
}

function showLogin(err) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginErr').hidden = !err;
  $('#loginErr').textContent = err || '';
}

$('#loginForm').addEventListener('submit', e => {
  e.preventDefault();
  S.pass = $('#loginPass').value;
  LS.set('pass', S.pass);
  start();
});

if ('serviceWorker' in navigator) {
  // вышла новая версия сайта — новый service worker взял управление, перезагружаемся на неё
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => hadController && location.reload());
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
S.pass ? start() : showLogin();
