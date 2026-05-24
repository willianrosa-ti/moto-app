import { Platform } from 'react-native';

type CorridaNotificacao = {
  id?: string | number;
  passageiro?: string;
  busca?: string;
  destino?: string;
  valor?: number;
};

type ResultadoNotificacaoWeb = {
  supported: boolean;
  permission?: NotificationPermission;
  subscribed?: boolean;
  reason?: string;
};

const WEB_PUSH_PUBLIC_KEY = process.env.EXPO_PUBLIC_WEB_PUSH_PUBLIC_KEY || '';
const WEB_PUSH_ENDPOINT = process.env.EXPO_PUBLIC_WEB_PUSH_ENDPOINT || '';

export function notificacoesWebDisponiveis() {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator
  );
}

export async function registrarServiceWorkerWeb() {
  if (!notificacoesWebDisponiveis()) {
    return { supported: false, reason: 'unsupported' };
  }

  const registro = await navigator.serviceWorker.register('/sw.js');
  return { supported: true, registration: registro };
}

export async function prepararNotificacoesWeb(
  apiBase: string,
  token: string
): Promise<ResultadoNotificacaoWeb> {
  if (!notificacoesWebDisponiveis()) {
    return { supported: false, reason: 'unsupported' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { supported: true, permission, subscribed: false };
  }

  const registro = await navigator.serviceWorker.ready;

  if (!('PushManager' in window)) {
    return { supported: true, permission, subscribed: false, reason: 'push-unavailable' };
  }

  if (!WEB_PUSH_PUBLIC_KEY) {
    return { supported: true, permission, subscribed: false, reason: 'missing-vapid-key' };
  }

  try {
    const inscricaoAtual = await registro.pushManager.getSubscription();
    const inscricao = inscricaoAtual || await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_PUBLIC_KEY),
    });

    await enviarInscricaoParaApi(apiBase, token, inscricao);
    return { supported: true, permission, subscribed: true };
  } catch {
    return { supported: true, permission, subscribed: false, reason: 'subscription-failed' };
  }
}

export async function notificarCorridaWeb(corrida: CorridaNotificacao) {
  if (!notificacoesWebDisponiveis() || Notification.permission !== 'granted') {
    return false;
  }

  const registro = await navigator.serviceWorker.ready;
  const valor = Number(corrida.valor || 0);
  const origem = corrida.busca ? `Buscar em: ${corrida.busca}` : 'Toque para abrir o app do motorista.';
  const corpo = valor > 0
    ? `R$ ${valor.toFixed(2).replace('.', ',')} - ${origem}`
    : origem;

  const opcoes = {
    body: corpo,
    icon: '/pwa/icon-192.png',
    badge: '/pwa/badge-96.png',
    tag: `corrida-${corrida.id || Date.now()}`,
    renotify: true,
    requireInteraction: true,
    data: { url: '/radar' },
  } as NotificationOptions & { renotify?: boolean };

  await registro.showNotification('Nova corrida disponível', opcoes);

  return true;
}

async function enviarInscricaoParaApi(apiBase: string, token: string, inscricao: PushSubscription) {
  const endpoint = WEB_PUSH_ENDPOINT || `${apiBase.replace(/\/+$/, '')}/api/WebPush/motorista/inscrever`;

  await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      plataforma: 'pwa-ios',
      userAgent: navigator.userAgent,
      subscription: inscricao.toJSON(),
    }),
  });
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
