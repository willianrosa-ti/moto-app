import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Volume do PRI RADIO (bipe ao falar e quando o outro começa a falar), separado do volume da voz.
// No Android fica também no lado nativo, para o rádio que funciona com o app fechado.
export const NIVEIS_BIPE = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1];
let atual = 1;
const nativo = () => Platform.OS === 'android'
  ? NativeModules.RadioVoz as { definirVolumeBipe?: (v: number) => Promise<void> } | undefined
  : undefined;
// Ao abrir o app, o lado nativo recebe o volume guardado (o rádio com o app fechado usa o mesmo).
AsyncStorage.getItem('volumeBipeRadio').then(v => {
  const n = Number(v);
  if (v === null || !Number.isFinite(n)) return;
  atual = n;
  nativo()?.definirVolumeBipe?.(atual)?.catch(() => {});
}).catch(() => {});

export const volumeBipe = () => atual;

export async function definirVolumeBipe(valor: number) {
  atual = Math.max(0, Math.min(1, valor));
  await AsyncStorage.setItem('volumeBipeRadio', String(atual)).catch(() => {});
  // Espera o Android guardar: o bipe de teste logo em seguida já sai no volume novo.
  await nativo()?.definirVolumeBipe?.(atual)?.catch(() => {});
}

export async function lerVolumeBipe() {
  const v = await AsyncStorage.getItem('volumeBipeRadio').catch(() => null);
  const n = Number(v);
  atual = v !== null && Number.isFinite(n) ? n : 1;
  return atual;
}
