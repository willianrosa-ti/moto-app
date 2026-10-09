import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Volume do PRI RADIO (bipe ao falar e quando o outro começa a falar), separado do volume da voz.
// No Android fica também no lado nativo, para o rádio que funciona com o app fechado.
export const NIVEIS_BIPE = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1];
let atual = 1;
AsyncStorage.getItem('volumeBipeRadio').then(v => { const n = Number(v); if (v !== null && Number.isFinite(n)) atual = n; }).catch(() => {});

export const volumeBipe = () => atual;

export async function definirVolumeBipe(valor: number) {
  atual = Math.max(0, Math.min(1, valor));
  await AsyncStorage.setItem('volumeBipeRadio', String(atual)).catch(() => {});
  const nativo = NativeModules.RadioVoz as { definirVolumeBipe?: (v: number) => void } | undefined;
  if (Platform.OS === 'android') nativo?.definirVolumeBipe?.(atual);
}

export async function lerVolumeBipe() {
  const v = await AsyncStorage.getItem('volumeBipeRadio').catch(() => null);
  const n = Number(v);
  atual = v !== null && Number.isFinite(n) ? n : 1;
  return atual;
}
