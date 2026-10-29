// Управление пользователями. У каждого свой пароль и свой файл data/users/<id>.enc.json
// (профиль, ДЗ и общий ключ). Расписание и преподаватели — в общих файлах под общим ключом.
//
//   DATA_KEY=... node scripts/users.mjs init-shared            создать shared.enc.json из seed/store.json
//   DATA_KEY=... node scripts/users.mjs add "ФИО" 3426 [--password X]   новый пользователь, печатает пароль
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SHARED_FILE, USERS_DIR, readJSON, readShared, sharedKey, writeJSON } from './lib/common.mjs';
import { encryptJSON, userFileId } from '../docs/js/crypto.js';
import { normGroup } from '../docs/js/lessons.js';

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'init-shared') {
  const seed = readJSON(join(ROOT, 'seed', 'store.json'));
  writeJSON(SHARED_FILE, await encryptJSON({ teachers: seed.teachers, groups: [] }, sharedKey()));
  console.log(`shared.enc.json: ${seed.teachers.length} преподавателей`);
} else if (cmd === 'add') {
  const [fio, groupArg] = args;
  if (!fio || !groupArg) throw new Error('Нужно: add "ФИО" группа');
  const group = normGroup(groupArg);
  const pi = args.indexOf('--password');
  const password = pi > 0 ? args[pi + 1] : randomBytes(12).toString('base64url');
  const file = join(USERS_DIR, (await userFileId(password)) + '.enc.json');
  if (existsSync(file)) throw new Error('Пользователь с таким паролем уже есть');
  const user = { settings: { fio, group }, homework: [], sharedKey: sharedKey() };
  writeJSON(file, await encryptJSON(user, password));

  const shared = await readShared();
  if (!shared.groups.includes(group)) {
    shared.groups.push(group);
    writeJSON(SHARED_FILE, await encryptJSON(shared, sharedKey()));
  }
  console.log(`${fio} (${group}): ${password}`);
} else {
  console.log('Команды: init-shared | add "ФИО" группа [--password X]');
}
