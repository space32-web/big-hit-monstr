// Мелочи для всех модулей: DOM, хранилище браузера, форматирование дат, иконки, всплывашки.
import { addDays, todayISO } from './lessons.js';

export const $ = sel => document.querySelector(sel);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// localStorage может быть недоступен (приватный режим) — не падаем
export const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth; // перезапуск анимации
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------- Даты ----------

export function mondayOf(iso) {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay() || 7;
  return addDays(iso, 1 - day);
}

export function dayTitle(iso) {
  const s = new Date(iso + 'T00:00:00Z').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return s[0].toUpperCase() + s.slice(1);
}

export function shortDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const weekdayShort = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' });
export const dayNum = iso => Number(iso.slice(8, 10));

export function duration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

export function whenLabel(iso) {
  const today = todayISO();
  if (iso === today) return 'сегодня';
  if (iso === addDays(today, 1)) return 'завтра';
  return dayTitle(iso).toLowerCase();
}

// Свой цвет у каждого предмета — по хэшу названия, одинаковый на всех экранах
export function subjectHue(subject) {
  let h = 0;
  for (const c of String(subject).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

// ---------- Иконки (контурные, 24×24) ----------

const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10.5 5-3v9l-5-3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
  spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="2.5"/>',
  vk: '<path d="M3 7h3.2c.3 3 1.6 5 3 5.4V7h3v3c1.3-.2 2.6-1.6 3.2-3H19c-.5 2-2 3.7-3.2 4.4 1.2.6 2.9 2.1 3.7 4.6h-3.2c-.6-1.6-2-2.9-3.8-3.1V16h-.4C7 16 3.4 13 3 7z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
};

export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;

// Подтверждение внутри страницы: системный confirm() браузер может молча глушить
// (галочка «запретить сайту показывать окна»), тогда кнопки «Удалить» просто не работали.
export function ask(text, { ok = 'Да', danger = false } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <p>${esc(text)}</p>
        <div class="links">
          <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button>
          <button class="btn ghost" data-r="0">Отмена</button>
        </div>
      </div>`;
    const done = v => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', e => {
      const r = e.target.closest('[data-r]');
      if (r) done(r.dataset.r === '1');
      else if (e.target === wrap) done(false);
    });
    document.body.append(wrap);
    wrap.querySelector('[data-r="1"]').focus();
  });
}
