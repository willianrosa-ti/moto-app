import { NativeModules, Platform } from 'react-native';

type SuporteSobreposicao = {
  isSupported: boolean;
};

type PermissaoSobreposicao = {
  granted: boolean;
};

type PedidoPermissaoSobreposicao = {
  granted?: boolean;
  openedSettings?: boolean;
  fallback?: string;
};

type AppOverlayNativeModule = {
  isSupported: () => Promise<SuporteSobreposicao>;
  hasPermission: () => Promise<PermissaoSobreposicao>;
  requestPermission: () => Promise<PedidoPermissaoSobreposicao>;
  showOverlay: (label: string) => Promise<void>;
  hideOverlay: () => Promise<void>;
  playBuzina: () => Promise<void>;
  startRideMonitor: (token: string, apiBase: string, refreshToken: string, radarAtivo: boolean) => Promise<void>;
  notifyMessage: (id: string, title: string, text: string) => Promise<void>;
  startRadioAudio: () => Promise<void>;
  tocarBipeRadio: () => Promise<number>;
  stopRadioAudio: () => Promise<void>;
  stopRideMonitor: () => Promise<void>;
  setRideMonitorForeground: (appEmPrimeiroPlano: boolean) => Promise<void>;
};

const moduloNativo = NativeModules.AppOverlay as AppOverlayNativeModule | undefined;
const mensagensNotificadas = new Set<string>();

const AppOverlay = {
  async tocarBipeRadio() { return Platform.OS === 'android' && moduloNativo?.tocarBipeRadio ? moduloNativo.tocarBipeRadio() : 0; },
  async startRadioAudio() { if (Platform.OS === 'android' && moduloNativo?.startRadioAudio) await moduloNativo.startRadioAudio(); },
  async stopRadioAudio() { if (Platform.OS === 'android' && moduloNativo?.stopRadioAudio) await moduloNativo.stopRadioAudio(); },
  async isSupported() {
    if (Platform.OS !== 'android' || !moduloNativo) {
      return { isSupported: false };
    }

    return moduloNativo.isSupported();
  },

  async hasPermission() {
    if (Platform.OS !== 'android' || !moduloNativo) {
      return { granted: false };
    }

    return moduloNativo.hasPermission();
  },

  async requestPermission() {
    if (Platform.OS !== 'android' || !moduloNativo) {
      return { granted: false };
    }

    return moduloNativo.requestPermission();
  },

  async showOverlay(label = 'MIL-LIN') {
    if (Platform.OS !== 'android' || !moduloNativo) return;
    await moduloNativo.showOverlay(label);
  },

  async hideOverlay() {
    if (Platform.OS !== 'android' || !moduloNativo) return;
    await moduloNativo.hideOverlay();
  },

  async playBuzina() {
    if (Platform.OS !== 'android') return false;
    if (!moduloNativo) {
      throw new Error('Modulo nativo AppOverlay indisponivel.');
    }

    await moduloNativo.playBuzina();
    return true;
  },

  async startRideMonitor(token: string, apiBase: string, refreshToken = '', radarAtivo = true) {
    if (Platform.OS !== 'android' || !moduloNativo) return;
    await moduloNativo.startRideMonitor(token, apiBase, refreshToken, radarAtivo);
  },

  async notifyMessage(id: string, title: string, text: string) {
    if (Platform.OS === 'android' && moduloNativo?.notifyMessage) {
      await moduloNativo.notifyMessage(id, title, text);
    } else if (Platform.OS === 'web' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      if (mensagensNotificadas.has(id)) return;
      const destino = id.startsWith('radio-') ? '/radar?radio=1' : id.startsWith('direta-') ? `/radar?colega=${encodeURIComponent(id.split('-')[1])}` : id.startsWith('suporte-') ? '/radar/notificacoes' : '/radar?chat=1';
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        const tag = `chat-${id}`;
        if (!(await registration.getNotifications({ tag })).length) await registration.showNotification(title, { body: text, tag, data: { url: destino } });
      } else {
        const aviso = new Notification(title, { body: text, tag: `chat-${id}` });
        aviso.onclick = () => { window.focus(); window.location.assign(destino); aviso.close(); };
      }
      mensagensNotificadas.add(id);
      if (mensagensNotificadas.size > 500) mensagensNotificadas.delete(mensagensNotificadas.values().next().value!);
    }
  },

  async stopRideMonitor() {
    if (Platform.OS !== 'android' || !moduloNativo) return;
    await moduloNativo.stopRideMonitor();
  },

  async setRideMonitorForeground(appEmPrimeiroPlano: boolean) {
    if (Platform.OS !== 'android' || !moduloNativo) return;
    await moduloNativo.setRideMonitorForeground(appEmPrimeiroPlano);
  },
};

export default AppOverlay;
