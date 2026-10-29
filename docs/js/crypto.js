// Шифрование данных паролем (AES-GCM + PBKDF2). Общий код для браузера и Node 20+.
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 150000;

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Имя файла пользователя выводится из его пароля — логин вводить не нужно
export async function userFileId(password) {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode('knn-user:' + password));
  return [...new Uint8Array(hash).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function encryptJSON(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

export async function decryptJSON(box, password) {
  const key = await deriveKey(password, fromB64(box.salt));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
  return JSON.parse(dec.decode(plain));
}
