// Отрисовка экранов: главная (текущая пара, день), неделя, ДЗ, «Ещё».
import { S } from './data.js';
import { addDays, blocksForDate, collegeNow, findTeachers, hwOpen, lessonRoom, normGroup, normName, plural, todayISO, upcomingBlocks } from './lessons.js';
import { renderNotify } from './notify.js';
import { $, LS, dayNum, dayTitle, duration, esc, icon, mondayOf, shortDate, subjectHue, weekdayShort, whenLabel } from './util.js';

export const view = { weekStart: mondayOf(todayISO()), admin: null };

export const roomFor = block => lessonRoom(S.shared.teachers, block);
export const joinName = () => `${S.store.settings.fio} ${S.store.settings.group}`;
export const chatText = () => `${S.store.settings.fio}, я на паре`;
const firstName = () => S.store.settings.fio.split(/\s+/)[1] || S.store.settings.fio;
const initials = () => S.store.settings.fio.split(/\s+/).slice(0, 2).map(w => w[0]).join('');

function teacherNames(block) {
  return findTeachers(S.shared.teachers, block.teacher).map(t => t.name).join(', ') || block.teacher;
}

function hwCountFor(subject) {
  return hwOpen(S.store).filter(h => normName(h.subject) === normName(subject)).length;
}

const hue = subject => `style="--h:${subjectHue(subject)}"`;

// ---------- Пара ----------

function lessonCard(b, now) {
  const state = b.endMs <= now ? 'past' : b.startMs <= now ? 'now' : '';
  const hw = hwCountFor(b.subject);
  const extra = [b.place, b.note].filter(Boolean).join(' · ');
  const room = roomFor(b);
  return `
    <article class="lesson ${state}" ${hue(b.subject)}>
      <div class="time"><b>${b.start}</b><span>${b.end}</span></div>
      <div class="rail"><i></i></div>
      <div class="body">
        <div class="subj">${esc(b.subject)}${b.count > 1 ? ` <span class="x">×${b.count}</span>` : ''}</div>
        <div class="meta">${esc(teacherNames(b))}${extra ? ' · ' + esc(extra) : ''}</div>
        <div class="row">
          ${state === 'now' ? '<span class="chip live"><i></i>идёт</span>' : ''}
          ${hw ? `<span class="chip warn">${icon('book')}${plural(hw, 'ДЗ', 'ДЗ', 'ДЗ')}</span>` : ''}
          ${state !== 'past' && room ? `<button class="btn small primary" data-action="join" data-date="${b.date}" data-start="${b.start}">${icon('video')}Войти</button>` : ''}
          ${state !== 'past' && !room ? '<span class="chip">нет ссылки</span>' : ''}
          <button class="btn small ghost" data-action="add-hw" data-subject="${esc(b.subject)}">${icon('plus')}ДЗ</button>
        </div>
      </div>
    </article>`;
}

// Кольцо: сколько пары прошло (или сколько осталось до начала в пределах часа)
function ring(fraction, big, small) {
  const r = 34, c = 2 * Math.PI * r;
  return `
    <div class="ring">
      <svg viewBox="0 0 80 80"><circle class="track" cx="40" cy="40" r="${r}"/>
        <circle class="bar" cx="40" cy="40" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.max(0, Math.min(1, fraction)))).toFixed(1)}"/></svg>
      <div><b>${big}</b><span>${small}</span></div>
    </div>`;
}

const minutesLeft = ms => Math.max(0, Math.round(ms / 60000));

export function renderHero(now) {
  const next = upcomingBlocks(S.schedule, now)[0];
  const hero = $('#hero');
  if (!next) {
    const dates = Object.keys(S.schedule.days).sort();
    hero.className = 'hero idle';
    hero.innerHTML = `
      <div class="label">${icon('calendar')}Пар не видно</div>
      <div class="subject">Ближайших пар в расписании нет</div>
      <p class="muted">Последний загруженный день — ${dates.length ? esc(dayTitle(dates[dates.length - 1]).toLowerCase()) : 'нет'}.
      Новое появится, когда админ загрузит скрин.</p>`;
    return;
  }
  const live = next.startMs <= now;
  const room = roomFor(next);
  const joined = LS.get('joined') === `${next.date} ${next.start}`;
  const soon = !live && next.startMs - now < 3600e3;
  const ringHtml = live
    ? ring((now - next.startMs) / (next.endMs - next.startMs), minutesLeft(next.endMs - now), 'мин до конца')
    : soon ? ring(1 - (next.startMs - now) / 3600e3, minutesLeft(next.startMs - now), 'мин до начала') : '';
  hero.className = `hero ${live ? 'live' : soon ? 'soon' : ''}`;
  hero.style.setProperty('--h', subjectHue(next.subject));
  hero.innerHTML = `
    <div class="hero-top">
      <div>
        <div class="label">${live ? '<i class="pulse"></i>Идёт пара' : `${icon('clock')}Следующая · ${esc(whenLabel(next.date))}`}</div>
        <div class="subject">${esc(next.subject)}</div>
        <div class="teacher">${icon('user')}${esc(teacherNames(next))}</div>
        <div class="when">${live ? `до ${next.end}` : `${next.start}–${next.end} · через ${duration(next.startMs - now)}`}</div>
      </div>
      ${ringHtml}
    </div>
    <div class="actions">
      ${room
        ? `<button class="btn primary big" data-action="join" data-date="${next.date}" data-start="${next.start}">${icon('video')}${joined ? 'Открыть комнату снова' : 'Войти на пару'}</button>`
        : '<span class="chip">Ссылки на эту пару пока нет</span>'}
      <button class="btn glass" data-action="copy-chat">${icon('chat')}«Я на паре»</button>
    </div>
    ${live || joined ? `
    <div class="actions mini">
      <button class="btn small glass" data-action="copy-name">${icon('copy')}Имя для входа</button>
      <button class="btn small glass" data-action="add-hw" data-subject="${esc(next.subject)}">${icon('plus')}ДЗ по предмету</button>
    </div>` : ''}`;
}

// ---------- ДЗ ----------

function dueChip(h) {
  if (h.done) return '';
  if (!h.due) return '<span class="chip">без срока</span>';
  const today = todayISO();
  if (h.due < today) return '<span class="chip danger">просрочено</span>';
  if (h.due === today) return '<span class="chip warn">сегодня</span>';
  if (h.due === addDays(today, 1)) return '<span class="chip warn">завтра</span>';
  return `<span class="chip">до ${esc(shortDate(h.due))}</span>`;
}

function hwItem(h) {
  const overdue = !h.done && h.due && h.due < todayISO();
  return `
    <article class="hw ${h.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" ${hue(h.subject)}>
      <label class="tick"><input type="checkbox" ${h.done ? 'checked' : ''} data-hw-toggle="${h.id}" aria-label="Выполнено"><span>${icon('check')}</span></label>
      <div>
        <div class="head"><span class="subj">${esc(h.subject)}</span>${dueChip(h)}</div>
        <div class="text">${esc(h.text)}</div>
      </div>
      <button class="del" data-action="hw-del" data-id="${h.id}" aria-label="Удалить">${icon('trash')}</button>
    </article>`;
}

const empty = (ic, text) => `<div class="empty">${icon(ic)}<span>${text}</span></div>`;

// ---------- Экраны ----------

function renderToday(now) {
  const today = todayISO(now);
  const blocks = blocksForDate(S.schedule, today);
  $('#todayList').innerHTML = blocks.length ? blocks.map(b => lessonCard(b, now)).join('') : empty('calendar', 'Сегодня пар нет — отдыхай');
  const open = hwOpen(S.store);
  const soon = open.filter(h => !h.due || h.due <= addDays(today, 3)).slice(0, 5);
  $('#todayHw').innerHTML = soon.length ? soon.map(hwItem).join('') : empty('check', 'Срочных ДЗ нет');
  const left = blocks.filter(b => b.endMs > now);
  const last = blocks[blocks.length - 1];
  $('#stats').innerHTML = `
    <div class="stat"><b>${left.length}</b><span>${left.length === blocks.length ? plural(left.length, 'пара', 'пары', 'пар').replace(/^\d+ /, '') + ' сегодня' : 'осталось пар'}</span></div>
    <div class="stat"><b>${last && last.endMs > now ? last.end : '—'}</b><span>конец пар</span></div>
    <div class="stat ${open.some(h => h.due && h.due < today) ? 'alert' : ''}"><b>${open.length}</b><span>открытых ДЗ</span></div>`;
}

function renderWeek(now) {
  const ws = view.weekStart;
  $('#weekLabel').textContent = `${shortDate(ws)} — ${shortDate(addDays(ws, 6))}`;
  const today = todayISO(now);
  let strip = '', html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const blocks = blocksForDate(S.schedule, d);
    strip += `
      <button class="day ${d === today ? 'today' : ''} ${blocks.length ? '' : 'free'}" data-action="goto-day" data-date="${d}">
        <span>${weekdayShort(d)}</span><b>${dayNum(d)}</b><i>${'•'.repeat(Math.min(blocks.length, 4)) || '&nbsp;'}</i></button>`;
    if (i === 6 && !blocks.length) continue; // пустое воскресенье не показываем
    html += `<h3 class="day-head ${d === today ? 'today' : ''} ${blocks.length ? '' : 'free'}" id="day-${d}">${esc(dayTitle(d))}` +
      `${d === today ? '<span class="chip live">сегодня</span>' : ''}${blocks.length ? '' : '<span class="muted small">пар нет</span>'}</h3>`;
    html += blocks.map(b => lessonCard(b, now)).join('');
  }
  $('#weekStrip').innerHTML = strip;
  $('#weekList').innerHTML = html;
}

function renderHw() {
  const open = hwOpen(S.store);
  $('#hwOpenList').innerHTML = open.length ? open.map(hwItem).join('') : empty('check', 'Всё сделано 🎉');
  const done = S.store.homework.filter(h => h.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  $('#hwDoneList').innerHTML = done.length ? done.map(hwItem).join('') : empty('inbox', 'Пока пусто');
  $('#hwDoneCount').textContent = done.length || '';
  const badge = $('#hwBadge');
  badge.hidden = !open.length;
  badge.textContent = open.length;
  const subjects = [...new Set(Object.values(S.schedule.days).flat().map(l => l.subject))].sort();
  $('#subjects').innerHTML = subjects.map(s => `<option value="${esc(s)}">`).join('');
}

function renderMore() {
  $('#profileInfo').innerHTML = `
    <div class="avatar big">${esc(initials())}</div>
    <div><b>${esc(S.store.settings.fio)}</b><div class="muted small">Группа ${esc(normGroup(S.store.settings.group))}${S.store.admin ? ' · админ' : ''}</div></div>`;
  const days = Object.keys(S.schedule.days).sort();
  $('#schedInfo').textContent = `Показана группа ${S.schedule.group}. Последний день в расписании: ${days.length ? dayTitle(days[days.length - 1]) : '—'}.`;
  renderNotify();
  if (view.admin) view.admin.render();
}

function renderHeader(now) {
  const d = collegeNow(now);
  const h = d.getUTCHours();
  const hello = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  $('#hello').textContent = `${hello}, ${firstName()}`;
  $('#clock').textContent = `${dayTitle(todayISO(now))} · ${d.toISOString().slice(11, 16)}`;
  $('#avatar').textContent = initials();
}

export function renderLive() {
  const now = Date.now();
  renderHeader(now);
  renderHero(now);
  renderToday(now);
}

export function renderWeekOnly() {
  renderWeek(Date.now());
}

export function renderAll() {
  const now = Date.now();
  renderHeader(now);
  renderHero(now);
  renderToday(now);
  renderWeek(now);
  renderHw();
  renderMore();
}
