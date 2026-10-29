import * as XLSX from 'xlsx';

// Формат файла КНН.xlsx: лист дописывается блоками по дням.
//   строка-заголовок: A = дата (число Excel), дальше номера групп (по 2 колонки на группу)
//   строка урока:     A = "16:00-16:45", [col] = предмет, [col+1] = место/примечание
//   следующая строка: [col+1] = преподаватель, [col] = примечание

export function normGroup(v) {
  return String(v ?? '')
    .toUpperCase()
    .replace(/A/g, 'А') // латинская A -> кириллица
    .replace(/[\s\-–]/g, '');
}

function clean(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s || '';
}

function headerDate(v) {
  if (typeof v === 'number' && v > 40000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400e3)).toISOString().slice(0, 10);
  }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(clean(v));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function parseTime(v) {
  const m = /(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})/.exec(clean(v));
  if (!m) return null;
  return { start: `${m[1].padStart(2, '0')}:${m[2]}`, end: `${m[3].padStart(2, '0')}:${m[4]}` };
}

export function parseSchedule(buffer, group) {
  const target = normGroup(group);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const days = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    let date = null;
    let col = -1;
    rows.forEach((row, r) => {
      if (!row) return;
      const d = headerDate(row[0]);
      if (d) {
        date = d;
        col = row.findIndex(v => normGroup(v) === target);
        if (col > 0) days[date] = []; // повторный блок того же дня (замена) перезаписывает старый
        return;
      }
      const t = parseTime(row[0]);
      if (!t || !date || col <= 0) return;
      const subject = clean(row[col]);
      if (!subject) return;
      const next = rows[r + 1] || [];
      days[date].push({
        start: t.start,
        end: t.end,
        subject,
        teacher: parseTime(next[0]) ? '' : clean(next[col + 1]),
        place: clean(row[col + 1]),
        note: parseTime(next[0]) ? '' : clean(next[col]),
      });
    });
  }
  for (const d of Object.keys(days)) if (!days[d].length) delete days[d];
  return days;
}
