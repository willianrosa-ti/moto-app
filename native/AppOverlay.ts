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
  startRideMonitor: (token: string, apiBase: string) => Promise<void>;
  stopRideMonitor: () => Promise<void>;
  setRideMonitorForeground: (appEmPrimeiroPlano: boolean) => Promise<void>;
};

const moduloNativo = NativeModules.AppOverlay as AppOverlayNativeModule | undefined;

const AppOverlay = {
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

  async startRideMonitor(token: string, apiBase: string) {
    if (Platform.OS !== 'android' || !moduloNativo) return;
    await moduloNativo.startRideMonitor(token, apiBase);
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
