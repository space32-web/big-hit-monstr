// Админка: расписание со скрина (распознавание Tesseract), ссылки преподавателей, пользователи.
import { userFileId } from './crypto.js';
import { DEFAULT_SLOTS, bestMatch, normGroup, normName, todayISO } from './lessons.js';

const $ = sel => document.querySelector(sel);
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let ctx;
let rows = [];      // по слоту: { subject, teacher, room, roomAuto, raw }
let workerPromise = null;

export function initAdmin(context) {
  ctx = context;
  $('#aDate').value = todayISO();
  $('#aGroup').value = normGroup(ctx.store.settings.group);
  rows = emptyRows();
  loadDay();
  bind();
  return { render };
}

// ---------- Данные ----------

const shared = () => ctx.shared;
const esc = s => ctx.esc(s);
const surname = name => String(name || '').trim().split(/\s+/)[0] || '';

function slots() {
  return (shared().slots || DEFAULT_SLOTS).map(s => {
    const [start, end] = s.split('-').map(x => x.trim());
    return { start, end };
  });
}

function emptyRows() {
  return slots().map(() => ({ subject: '', teacher: '', room: '', roomAuto: false, raw: null }));
}

function currentGroup() {
  return normGroup($('#aGroup').value);
}

function knownSubjects() {
  const set = new Set(shared().subjects || []);
  for (const days of Object.values(shared().days || {})) for (const d of Object.values(days)) d.forEach(l => set.add(l.subject));
  for (const days of Object.values(ctx.allSchedule.groups || {})) for (const d of Object.values(days)) d.forEach(l => set.add(l.subject));
  return [...set].filter(Boolean).sort();
}

function teacherRecord(name) {
  const key = normName(surname(name));
  return key ? shared().teachers.find(t => normName(surname(t.name)) === key) : null;
}

// Цифры должны совпасть точно: "МДК 02.01" нельзя исправлять в "МДК 04.01"
function matchSubject(raw) {
  const digits = s => (s.match(/\d+/g) || []).join('.');
  const options = knownSubjects().filter(s => digits(s) === digits(raw));
  return bestMatch(raw, options, 0.72) || raw;
}

function matchTeacher(raw) {
  const word = surname(raw);
  if (!word) return '';
  const names = shared().teachers.map(t => surname(t.name));
  return bestMatch(word, names, 0.6) || word;
}

function autoRoom(row) {
  const rec = teacherRecord(row.teacher);
  if (rec?.room && (!row.room || row.roomAuto)) {
    row.room = rec.room;
    row.roomAuto = true;
  } else if (!rec && row.roomAuto) {
    row.room = '';
    row.roomAuto = false;
  }
}

function loadDay() {
  const day = shared().days?.[currentGroup()]?.[$('#aDate').value];
  rows = emptyRows();
  if (day) {
    slots().forEach((s, i) => {
      const l = day.find(l => l.start === s.start);
      if (l) rows[i] = { subject: l.subject, teacher: l.teacher, room: l.room || teacherRecord(l.teacher)?.room || '', roomAuto: !l.room, raw: null };
    });
  }
  renderRows();
}

// ---------- Распознавание ----------

function status(text) {
  $('#aStatus').textContent = text;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('не загрузился ' + src));
    document.head.append(s);
  });
}

function getWorker() {
  workerPromise ??= (async () => {
    status('Загружаю распознавание текста (первый раз ~10 МБ)…');
    await loadScript(TESSERACT_URL);
    const worker = await Tesseract.createWorker('rus', 1, {
      logger: m => m.status === 'loading language traineddata' && status(`Загружаю русский язык… ${Math.round(m.progress * 100)}%`),
    });
    await worker.setParameters({ tessedit_pageseg_mode: '7' }); // одна строка в ячейке
    return worker;
  })().catch(e => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('не удалось открыть картинку'));
    img.src = URL.createObjectURL(file);
  });
}

// Ячейки таблицы: ищем горизонтальные линии — сплошные тёмные полосы длиннее 60% ширины.
// У текста между буквами есть просветы, поэтому даже крупная надпись за линию не сойдёт.
function findCells(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, w, h).data;
  const lines = [];
  for (let y = 0; y < h; y++) {
    let run = 0, longest = 0, gap = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < 210) {
        run += gap + 1;
        gap = 0;
        longest = Math.max(longest, run);
      } else if (++gap > 1) {
        run = 0;
        gap = 0;
      }
    }
    if (longest / w < 0.6) continue;
    const last = lines[lines.length - 1];
    if (last && y - last.end <= 2) last.end = y;
    else lines.push({ start: y, end: y });
  }
  const cells = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const top = lines[i].end + 1, bottom = lines[i + 1].start - 1;
    if (bottom - top > 8) cells.push({ top, bottom });
  }
  if (cells.length) {
    const heights = cells.map(c => c.bottom - c.top).sort((a, b) => a - b);
    const median = heights[heights.length >> 1];
    // обрезанные края скрина — тоже ячейки, но им нужна уверенность распознавания повыше
    if (lines[0].start > median * 0.6) cells.unshift({ top: 0, bottom: lines[0].start - 1, partial: true });
    const last = lines[lines.length - 1].end;
    if (h - 1 - last > median * 0.6) cells.push({ top: last + 1, bottom: h - 1, partial: true });
  }
  return { canvas, cells, w };
}

// Вырезаем ячейку, увеличиваем и делаем контрастной — так Tesseract читает мелкий текст
function cellCanvas(src, w, cell) {
  const inset = 3;
  const sh = cell.bottom - cell.top + 1 - inset * 2;
  const sw = w - inset * 2;
  const scale = Math.min(5, Math.max(2, 64 / sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, inset, cell.top + inset, sw, sh, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const lum = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
    const v = lum < 150 ? 0 : lum > 200 ? 255 : (lum - 150) * 5.1;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(data, 0, 0);
  return c;
}

function cleanText(text) {
  const s = String(text || '')
    .replace(/[|_[\]{}<>~`'"“”«»©®]/g, ' ')
    .replace(/\b(\d{2})[\s,]+(\d{2})\b/g, '$1.$2') // "МДК 04 01" -> "МДК 04.01"
    .replace(/\s+/g, ' ')
    .trim();
  return (s.match(/[A-Za-zА-Яа-яЁё]/g) || []).length >= 2 ? s.replace(/^[^\wА-Яа-яЁё]+|[^\wА-Яа-яЁё.)]+$/g, '') : '';
}

async function recognize(file) {
  const img = await loadImage(file);
  $('#aPreview').src = img.src;
  $('#aPreview').hidden = false;
  const worker = await getWorker();
  const { canvas, cells, w } = findCells(img);
  let pairs;
  if (cells.length >= 3) {
    const texts = [];
    for (let i = 0; i < cells.length; i++) {
      status(`Распознаю ячейку ${i + 1} из ${cells.length}…`);
      const { data } = await worker.recognize(cellCanvas(canvas, w, cells[i]));
      // мусор от обрезанных строк распознаётся с уверенностью ~30–40, нормальный текст — 60+
      texts.push(data.confidence < (cells[i].partial ? 60 : 45) ? '' : cleanText(data.text));
    }
    // шапка с номером группы — пропускаем всё до неё включительно
    // (OCR может прочитать "3427А" как "342ТА", поэтому хватает трёх цифр в начале)
    const head = texts.findIndex(t => /^\d{3}[\dА-ЯA-Z]{1,3}$/i.test(t.replace(/[\s-–]/g, '')));
    const body = texts.slice(head + 1);
    pairs = [];
    for (let i = 0; i < body.length; i += 2) pairs.push({ subject: body[i], teacher: body[i + 1] || '' });
  } else {
    // таблица без линий: читаем целиком, правые строки — преподаватели
    status('Линии таблицы не найдены, читаю картинку целиком…');
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const { data } = await worker.recognize(img);
    await worker.setParameters({ tessedit_pageseg_mode: '7' });
    pairs = [];
    for (const line of data.lines) {
      const text = cleanText(line.text);
      if (!text || /^\d{4}/.test(text)) continue;
      if (line.bbox.x0 > img.naturalWidth * 0.35 && pairs.length && !pairs[pairs.length - 1].teacher) pairs[pairs.length - 1].teacher = text;
      else pairs.push({ subject: text, teacher: '' });
    }
  }

  rows = emptyRows();
  pairs.slice(0, rows.length).forEach((p, i) => {
    if (!p.subject && !p.teacher) return;
    const row = rows[i];
    row.raw = { subject: p.subject, teacher: p.teacher };
    row.subject = p.subject ? matchSubject(p.subject) : '';
    row.teacher = matchTeacher(p.teacher);
    autoRoom(row);
  });
  const found = rows.filter(r => r.subject).length;
  status(`Готово: распознано пар — ${found}. Проверь и поправь, потом «Опубликовать».` +
    (pairs.length > rows.length ? ` На скрине больше строк, чем пар в расписании (${rows.length}) — лишние отброшены.` : ''));
  const existing = shared().days?.[currentGroup()]?.[$('#aDate').value];
  if (existing) status($('#aStatus').textContent + ' На эту дату уже есть расписание — публикация его заменит.');
  renderRows();
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    await recognize(file);
  } catch (e) {
    status('Ошибка распознавания: ' + e.message + '. Можно заполнить пары вручную.');
  }
}

// ---------- Отрисовка ----------

function renderRows() {
  const s = slots();
  $('#aRows').innerHTML = rows
    .map((r, i) => {
      const rec = teacherRecord(r.teacher);
      let note = '';
      if (r.raw && (r.raw.subject !== r.subject || surname(r.raw.teacher) !== r.teacher)) {
        note += `<div class="muted small">на скрине: «${esc(r.raw.subject)}» / «${esc(r.raw.teacher)}»</div>`;
      }
      if (r.subject && r.teacher && rec?.room && r.room === rec.room) note += `<div class="auto">ссылка подставлена: ${esc(rec.name)}</div>`;
      else if (r.subject && r.teacher && !rec) note += '<div class="warn">преподавателя нет в списке — вставь ссылку, она сохранится для него</div>';
      else if (r.subject && !r.room) note += '<div class="warn">нет ссылки — у студентов не будет кнопки «Войти»</div>';
      return `
        <div class="slot ${r.subject ? '' : 'empty'}">
          <div class="head"><span>${i + 1} пара · ${s[i].start}–${s[i].end}</span>
            ${r.subject || r.teacher ? `<button class="btn small" type="button" data-a="clear" data-i="${i}">Нет пары</button>` : ''}</div>
          <input data-f="subject" data-i="${i}" list="aSubjects" placeholder="нет пары" value="${esc(r.subject)}" autocomplete="off">
          <input data-f="teacher" data-i="${i}" list="aTeachers" placeholder="преподаватель (фамилия)" value="${esc(r.teacher)}" autocomplete="off">
          <input data-f="room" data-i="${i}" type="url" placeholder="ссылка на комнату" value="${esc(r.room)}">
          ${note}
        </div>`;
    })
    .join('');
}

function renderDays() {
  const items = [];
  for (const [g, days] of Object.entries(shared().days || {})) {
    for (const [d, lessons] of Object.entries(days)) items.push({ g, d, n: lessons.length });
  }
  items.sort((a, b) => b.d.localeCompare(a.d) || a.g.localeCompare(b.g));
  $('#aDays').innerHTML = items.length
    ? items.slice(0, 20).map(x => `
        <div class="row-item"><span><b>${esc(x.g)}</b> · ${esc(ctx.dayTitle(x.d))} · пар: ${x.n}</span>
          <span class="acts"><button class="btn small" type="button" data-a="edit-day" data-g="${esc(x.g)}" data-d="${x.d}">Изменить</button></span></div>`).join('')
    : '<div class="empty">Пока ничего не загружено</div>';
}

function renderTeachers() {
  $('#teacherList').innerHTML = shared().teachers
    .map((t, i) => `
      <div class="teacher">
        <div class="row-item"><span class="name">${esc(t.name)}</span>
          <span class="acts"><button class="btn small" type="button" data-a="del-teacher" data-i="${i}">Удалить</button></span></div>
        <input type="url" value="${esc(t.room)}" placeholder="ссылка на комнату" data-teacher-room="${i}">
      </div>`)
    .join('');
}

function renderUsers() {
  const users = shared().users || [];
  $('#aUsers').innerHTML = users.length
    ? users.map((u, i) => `
        <div class="row-item"><span>${esc(u.fio)} · ${esc(u.group)}${u.admin ? ' · админ' : ''}</span>
          ${u.admin ? '' : `<span class="acts"><button class="btn small danger" type="button" data-a="del-user" data-i="${i}">Удалить</button></span>`}</div>`).join('')
    : '<div class="empty">Нет пользователей</div>';
}

function render() {
  const groups = [...new Set([...(shared().groups || []), ...Object.keys(shared().days || {})])].sort();
  $('#aGroups').innerHTML = groups.map(g => `<option value="${esc(g)}">`).join('');
  $('#aSubjects').innerHTML = knownSubjects().map(s => `<option value="${esc(s)}">`).join('');
  $('#aTeachers').innerHTML = shared().teachers.map(t => `<option value="${esc(surname(t.name))}">${esc(t.name)}</option>`).join('');
  $('#aSlots').value = (shared().slots || DEFAULT_SLOTS).join(', ');
  $('#aView').value = normGroup(ctx.LS.get('adminGroup') || ctx.store.settings.group);
  const warn = $('#adminWarn');
  warn.hidden = ctx.canWrite();
  warn.textContent = 'Добавь токен GitHub в самом низу — без него нельзя публиковать.';
  $('#writeStatus').textContent = ctx.canWrite() ? '✓ Запись включена для всех' : 'Токена нет — сохранять нельзя';
  $('#writeStatus').className = 'small ' + (ctx.canWrite() ? '' : 'error');
  renderRows();
  renderDays();
  renderTeachers();
  renderUsers();
}

// ---------- Действия ----------

async function publish() {
  const g = currentGroup();
  const date = $('#aDate').value;
  if (!g || !date) return ctx.toast('Укажи группу и дату');
  const s = slots();
  const lessons = rows
    .map((r, i) => ({ r, s: s[i] }))
    .filter(x => x.r.subject.trim())
    .map(({ r, s }) => ({
      start: s.start,
      end: s.end,
      subject: r.subject.trim(),
      teacher: r.teacher.trim(),
      place: '',
      note: '',
      ...(!r.teacher.trim() && r.room.trim() && { room: r.room.trim() }),
    }));
  if (!lessons.length && !confirm('Пар нет — опубликовать пустой день?')) return;

  const sh = shared();
  // ссылки запоминаются за преподавателем, чтобы в следующий раз подставиться самим
  for (const r of rows) {
    const teacher = r.teacher.trim(), room = r.room.trim();
    if (!r.subject.trim() || !teacher || !room) continue;
    const rec = teacherRecord(teacher);
    if (rec) rec.room = room;
    else sh.teachers.push({ name: teacher, room });
  }
  sh.days ??= {};
  sh.days[g] ??= {};
  sh.days[g][date] = lessons;
  sh.subjects = [...new Set([...(sh.subjects || []), ...lessons.map(l => l.subject)])].sort();
  if (!sh.groups.includes(g)) sh.groups.push(g);
  if (await ctx.saveShared(`Расписание ${g} на ${date}`)) {
    ctx.toast(`Опубликовано: ${g}, пар — ${lessons.length}`);
    ctx.refresh();
  }
}

async function clearDay() {
  const g = currentGroup(), date = $('#aDate').value;
  if (!shared().days?.[g]?.[date]) return ctx.toast('На эту дату ничего не загружено');
  if (!confirm(`Убрать расписание ${g} на ${date}?`)) return;
  delete shared().days[g][date];
  if (await ctx.saveShared(`Убрано расписание ${g} на ${date}`)) {
    rows = emptyRows();
    ctx.refresh();
  }
}

function randomPassword() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function addUser(e) {
  e.preventDefault();
  const fio = $('#uFio').value.trim().replace(/\s+/g, ' ');
  const group = normGroup($('#uGroup').value);
  const password = randomPassword();
  const id = await userFileId(password);
  const user = { settings: { fio, group }, homework: [], sharedKey: ctx.store.sharedKey };
  if (!(await ctx.saveFile(`data/users/${id}.enc.json`, user, password, `Пользователь ${id}`))) return;
  const sh = shared();
  sh.users ??= [];
  sh.users.push({ id, fio, group });
  if (!sh.groups.includes(group)) sh.groups.push(group);
  await ctx.saveShared(`Пользователь: ${fio}`);
  e.target.reset();
  const url = location.origin + location.pathname;
  const box = $('#uResult');
  box.hidden = false;
  box.innerHTML = `
    <div class="state">Пароль для ${esc(fio)}</div>
    <p class="secret">${esc(password)}</p>
    <p class="small muted">Отправь его другу вместе со ссылкой. Больше он нигде не покажется.</p>
    <button class="btn" type="button" data-a="copy-invite" data-text="${esc(`Трекер пар: ${url}\nТвой пароль: ${password}`)}">Скопировать приглашение</button>`;
  render();
}

async function deleteUser(i) {
  const u = shared().users[i];
  if (!confirm(`Удалить ${u.fio}? Его ДЗ пропадут.`)) return;
  const url = `https://api.github.com/repos/${ctx.repo()}/contents/docs/data/users/${u.id}.enc.json`;
  const cur = await fetch(`${url}?ref=main&t=${Date.now()}`, { headers: ctx.ghHeaders() });
  if (cur.ok) {
    const { sha } = await cur.json();
    const res = await fetch(url, { method: 'DELETE', headers: ctx.ghHeaders(), body: JSON.stringify({ message: `Удалён пользователь ${u.id}`, sha, branch: 'main' }) });
    if (!res.ok) return ctx.toast(`Не удалилось: GitHub ответил ${res.status}`);
  }
  shared().users.splice(i, 1);
  if (await ctx.saveShared(`Удалён: ${u.fio}`)) render();
}

function bind() {
  $('#aFile').addEventListener('change', e => handleFile(e.target.files[0]));
  const drop = $('#aDrop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); handleFile(e.dataTransfer.files[0]); });
  document.addEventListener('paste', e => {
    if ($('[data-view="admin"]').hidden) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  });

  const onTarget = () => {
    if (rows.every(r => !r.subject && !r.teacher)) loadDay();
    else if (shared().days?.[currentGroup()]?.[$('#aDate').value]) status('На эту дату уже есть расписание — публикация его заменит.');
  };
  $('#aGroup').addEventListener('change', onTarget);
  $('#aDate').addEventListener('change', onTarget);

  $('#aRows').addEventListener('input', e => {
    const { f, i } = e.target.dataset;
    if (!f) return;
    rows[i][f] = e.target.value;
    if (f === 'room') rows[i].roomAuto = false;
  });
  $('#aRows').addEventListener('change', e => {
    if (e.target.dataset.f === 'teacher') {
      autoRoom(rows[e.target.dataset.i]);
      renderRows();
    }
  });

  $('#aPublish').onclick = publish;
  $('#aClearDay').onclick = clearDay;

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-a]');
    if (!el || !el.closest('[data-view="admin"]')) return;
    const { a, i, g, d, text } = el.dataset;
    if (a === 'clear') {
      rows[i] = { subject: '', teacher: '', room: '', roomAuto: false, raw: null };
      renderRows();
    } else if (a === 'edit-day') {
      $('#aGroup').value = g;
      $('#aDate').value = d;
      loadDay();
      status(`Редактирование: ${g}, ${d}`);
      $('#aGroup').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (a === 'del-teacher') {
      const t = shared().teachers[i];
      if (!confirm(`Удалить ${t.name}?`)) return;
      shared().teachers.splice(i, 1);
      if (await ctx.saveShared(`Удалён преподаватель ${t.name}`)) render();
    } else if (a === 'del-user') {
      deleteUser(Number(i));
    } else if (a === 'copy-invite') {
      try { await navigator.clipboard.writeText(text); ctx.toast('Скопировано'); } catch { ctx.toast('Не удалось скопировать'); }
    }
  });

  document.addEventListener('change', async e => {
    const el = e.target;
    if (!el.matches('[data-teacher-room]')) return;
    const t = shared().teachers[Number(el.dataset.teacherRoom)];
    const prev = t.room;
    t.room = el.value.trim();
    if (await ctx.saveShared(`Ссылка: ${t.name}`)) ctx.toast('Ссылка сохранена');
    else t.room = prev;
    renderTeachers();
  });

  $('#teacherForm').addEventListener('submit', async e => {
    e.preventDefault();
    shared().teachers.push({ name: $('#tName').value.trim(), room: $('#tRoom').value.trim() });
    if (await ctx.saveShared('Новый преподаватель')) e.target.reset();
    else shared().teachers.pop();
    render();
  });

  $('#userForm').addEventListener('submit', addUser);

  $('#aSaveSlots').onclick = async () => {
    const list = $('#aSlots').value.split(',').map(s => s.trim().replace(/[–—]/g, '-').replace(/\s/g, '')).filter(Boolean);
    if (!list.length || !list.every(s => /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(s))) return ctx.toast('Формат: 17:30-18:15, 18:25-19:10, …');
    const norm = list.map(s => s.split('-').map(t => t.padStart(5, '0')).join('-'));
    shared().slots = norm;
    if (await ctx.saveShared('Время пар')) {
      rows = emptyRows();
      loadDay();
      ctx.toast('Время пар сохранено');
    }
  };

  $('#aSaveView').onclick = () => {
    ctx.LS.set('adminGroup', normGroup($('#aView').value));
    ctx.refresh();
    ctx.toast('Показываю группу ' + normGroup($('#aView').value));
  };

  $('#saveToken').onclick = async () => {
    const t = $('#tokenInput').value.trim();
    if (!t) return;
    ctx.LS.set('token', t);
    shared().ghToken = t;
    $('#tokenInput').value = '';
    if (await ctx.saveShared('Токен для всех')) ctx.toast('Токен сохранён — запись включена у всех');
    render();
  };
}
