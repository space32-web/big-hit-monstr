// Ручные пары для всех групп (пока нет расписания или для замен).
//   DATA_KEY=... node scripts/extra.mjs set 2026-10-29 "16:30/Предмет" "17:00/Предмет" ...
//   DATA_KEY=... node scripts/extra.mjs clear 2026-10-29
// Конец пары = начало следующей, у последней +45 минут. Потом запусти fetch-schedule.
import { SHARED_FILE, readShared, sharedKey, writeJSON } from './lib/common.mjs';
import { encryptJSON } from '../docs/js/crypto.js';

const [cmd, date, ...items] = process.argv.slice(2);
const shared = await readShared();
shared.extraDays ??= {};

const plus = (hhmm, min) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

if (cmd === 'set' && date && items.length) {
  const lessons = items.map(s => {
    const [time, ...rest] = s.split('/');
    return { start: time.padStart(5, '0'), subject: rest.join('/').trim() };
  });
  shared.extraDays[date] = lessons.map((l, i) => ({
    start: l.start,
    end: lessons[i + 1]?.start || plus(l.start, 45),
    subject: l.subject,
    teacher: '',
    place: '',
    note: '',
  }));
} else if (cmd === 'clear' && date) {
  delete shared.extraDays[date];
} else {
  console.log('Команды: set <дата> "ЧЧ:ММ/Предмет" ... | clear <дата>');
  process.exit(1);
}
writeJSON(SHARED_FILE, await encryptJSON(shared, sharedKey()));
console.log(`Ручные дни: ${Object.keys(shared.extraDays).sort().join(', ') || 'нет'}`);
