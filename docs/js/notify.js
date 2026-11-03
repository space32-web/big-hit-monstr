// Уведомления: привязка ВК-бота кодом и push на это устройство. Отправляет их scripts/notify.mjs.
import { S, saveNotify } from './data.js';
import { $, copy, esc, icon, toast } from './util.js';

const VAPID_PUBLIC = 'BKhuCcZJKGziPwwAvCnnoq5iYMXvoXVvqfR98rrDz6eHGRaB7ibMmPW_b9_6S3c7UAre3Cu7q5tFkZvrmRFuNSc';

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const status = (on, text) => `<span class="status ${on ? 'on' : ''}"><i></i>${text}</span>`;

function renderVk() {
  const box = $('#vkBlock');
  if (S.links.vk[S.uid]) {
    box.innerHTML = `${status(true, 'Подключён')}<p class="muted small">Отключить — напиши боту «стоп».</p>`;
  } else if (!S.shared.vkGroup) {
    box.innerHTML = `${status(false, 'Недоступен')}<p class="muted small">Сообщество ВК ещё не подключено, этим занимается админ.</p>`;
  } else if (!S.notify.vkCode) {
    box.innerHTML = `${status(false, 'Не подключён')}<button class="btn primary" data-action="vk-code">${icon('vk')}Подключить ВК</button>`;
  } else {
    box.innerHTML = `
      ${status(false, 'Ждём код')}
      <ol class="steps">
        <li><a class="btn" href="https://vk.me/${esc(S.shared.vkGroup)}" target="_blank" rel="noopener">${icon('vk')}Открыть сообщество</a></li>
        <li>Отправь туда код
          <button class="code" data-action="vk-copy" title="Скопировать">${esc(S.notify.vkCode)}${icon('copy')}</button></li>
        <li class="muted small">Бот ответит в течение 5–10 минут, и здесь появится «Подключён».</li>
      </ol>`;
  }
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function renderPush() {
  const box = $('#pushBlock');
  if (!pushSupported()) {
    box.innerHTML = isIOS
      ? `${status(false, 'Нужно приложение')}<p class="muted small">На iPhone push работает только с экрана «Домой»: в Safari нажми «Поделиться» → «На экран Домой», открой трекер с иконки и включи здесь.</p>`
      : `${status(false, 'Недоступно')}<p class="muted small">Этот браузер не поддерживает push-уведомления.</p>`;
    return;
  }
  if (Notification.permission === 'denied') {
    box.innerHTML = `${status(false, 'Запрещено')}<p class="muted small">Уведомления запрещены в настройках браузера для этого сайта. Разреши их там и обнови страницу.</p>`;
    return;
  }
  const sub = await currentSubscription().catch(() => null);
  const on = sub && S.notify.push.some(p => p.endpoint === sub.endpoint);
  box.innerHTML = on
    ? `${status(true, 'Включены на этом устройстве')}
       <div class="links"><button class="btn small" data-action="push-test">${icon('bell')}Проверить</button><button class="btn small ghost" data-action="push-off">Отключить</button></div>`
    : `${status(false, 'Выключены')}<button class="btn primary" data-action="push-on">${icon('bell')}Включить на этом устройстве</button>`;
}

export function renderNotify() {
  renderVk();
  renderPush();
}

function b64urlToBytes(s) {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function pushOn() {
  if ((await Notification.requestPermission()) !== 'granted') return renderPush();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC) }));
    const json = sub.toJSON();
    S.notify.push = S.notify.push.filter(p => p.endpoint !== json.endpoint);
    S.notify.push.push({ endpoint: json.endpoint, keys: json.keys, device: navigator.userAgent.slice(0, 120), at: new Date().toISOString() });
    if (await saveNotify('Push: новое устройство')) toast('Push включены');
  } catch (e) {
    toast('Не получилось включить push: ' + e.message);
  }
  renderPush();
}

async function pushOff() {
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    S.notify.push = S.notify.push.filter(p => p.endpoint !== sub.endpoint);
    await sub.unsubscribe().catch(() => {});
    await saveNotify('Push: устройство отключено');
  }
  renderPush();
}

async function vkCode() {
  S.notify.vkCode = String((crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000);
  if (!(await saveNotify('ВК: код привязки'))) S.notify.vkCode = undefined;
  renderVk();
}

export const notifyActions = {
  'vk-code': vkCode,
  'vk-copy': async () => toast((await copy(S.notify.vkCode)) ? 'Код скопирован' : S.notify.vkCode),
  'push-on': pushOn,
  'push-off': pushOff,
  'push-test': async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('КНН трекер', { body: 'Так будут выглядеть напоминания о парах', icon: 'icon.svg', tag: 'test' });
  },
};
