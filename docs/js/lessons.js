// Работа с расписанием: время колледжа, объединение уроков в пары, поиск преподавателя.
// Общий код для браузера и Node.

export const TZ_OFFSET_HOURS = 3; // Нижнекамск, UTC+3

// "Местные" часы колледжа: Date, у которого UTC-поля = время в колледже
export function collegeNow(nowMs = Date.now()) {
  return new Date(nowMs + TZ_OFFSET_HOURS * 3600e3);
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function todayISO(nowMs = Date.now()) {
  return isoDate(collegeNow(nowMs));
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

// Момент (реальные мс) для даты и времени "HH:MM" по часам колледжа
export function lessonMs(dateIso, hhmm) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - TZ_OFFSET_HOURS * 3600e3;
}

// "3426", "3426-А", "3426a" -> "3426А"
export function normGroup(v) {
  const s = String(v ?? '').toUpperCase().replace(/A/g, 'А').replace(/[\s\-–]/g, '');
  return /^\d+$/.test(s) ? s + 'А' : s;
}

export function normName(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я]/g, '');
}

// "Шарифуллина,Гиззатуллина" -> записи преподавателей с комнатами
export function findTeachers(teachers, cell) {
  if (!cell) return [];
  return String(cell)
    .split(/[,;/]/)
    .map(part => part.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map(surname => {
      const key = normName(surname);
      const t = teachers.find(t => normName(t.name.split(/\s+/)[0]) === key);
      return t || { name: surname, room: '' };
    });
}

// Время пар по умолчанию (меняется в админке)
export const DEFAULT_SLOTS = ['17:30-18:15', '18:25-19:10', '19:20-20:05', '20:15-21:00'];

// Дни группы: старый файл расписания, ручные дни для всех, дни из админки (главнее всех)
export function groupDays(allSchedule, shared, group) {
  const g = normGroup(group);
  return { ...(allSchedule?.groups?.[g] || {}), ...(shared?.extraDays || {}), ...(shared?.days?.[g] || {}) };
}

// Ссылка на комнату: своя у урока или по преподавателю
export function lessonRoom(teachers, lesson) {
  return lesson.room || findTeachers(teachers, lesson.teacher).find(t => t.room)?.room || '';
}

// Похожесть строк 0..1 (Левенштейн по буквам) — исправляет ошибки распознавания
export function similarity(a, b) {
  a = normName(a);
  b = normName(b);
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

export function bestMatch(text, options, min) {
  let best = null, score = min;
  for (const o of options) {
    const s = similarity(text, o);
    if (s >= score) { best = o; score = s; }
  }
  return best;
}

// Соседние уроки с тем же предметом и преподавателем объединяются в одну "пару"
export function groupLessons(lessons) {
  const blocks = [];
  for (const l of [...lessons].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = blocks[blocks.length - 1];
    if (last && normName(last.subject) === normName(l.subject) && normName(last.teacher) === normName(l.teacher)) {
      last.end = l.end;
      last.count++;
    } else {
      blocks.push({ ...l, count: 1 });
    }
  }
  return blocks;
}

export function blocksForDate(schedule, dateIso) {
  return groupLessons((schedule && schedule.days && schedule.days[dateIso]) || []).map(b => ({
    ...b,
    date: dateIso,
    startMs: lessonMs(dateIso, b.start),
    endMs: lessonMs(dateIso, b.end),
  }));
}

// Ближайшие пары начиная с сегодняшнего дня (для "что дальше")
export function upcomingBlocks(schedule, nowMs = Date.now(), daysAhead = 21) {
  const out = [];
  const today = todayISO(nowMs);
  for (let i = 0; i <= daysAhead; i++) {
    for (const b of blocksForDate(schedule, addDays(today, i))) if (b.endMs > nowMs) out.push(b);
  }
  return out;
}

// Дата следующего занятия по предмету после указанной даты (для срока ДЗ)
export function nextSubjectDate(schedule, subject, afterIso) {
  const key = normName(subject);
  const dates = Object.keys((schedule && schedule.days) || {}).filter(d => d > afterIso).sort();
  return dates.find(d => schedule.days[d].some(l => normName(l.subject) === key)) || '';
}

// plural(3, 'пара', 'пары', 'пар') -> "3 пары"
export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}

export function hwOpen(store) {
  return ((store && store.homework) || []).filter(h => !h.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
}
