import { AppState, DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { reservarMicrofone } from './audioFocus';
import AppOverlay from '../../native/AppOverlay';
import { radioNativoDisponivel } from './hubNativo';
import type { MidiaRadio, ModoMicrofone, PedacoVoz } from './RadioClient';

// Rádio pelo servidor no Android: o módulo nativo RadioVoz grava e comprime a voz em pedaços. A voz recebida,
// os bipes, o alto-falante e o foco de áudio ficam com o rádio nativo (RadioNucleo), que também funciona com o
// app fechado; sem ele (versão antiga do módulo), a tela cuida disso como antes.
type RadioVozNativo = {
  microfone(modo: ModoMicrofone): Promise<PedacoVoz | null>;
  tocar(fala: number, codec: string, dados: string): void;
  fimFala(): void;
  parar(): void;
};
const nativo = NativeModules.RadioVoz as RadioVozNativo | undefined;
let liberar: (() => void) | null = null;
let aoPedaco: ((p: PedacoVoz) => void) | null = null;
DeviceEventEmitter.addListener('RadioVozPedaco', (p: PedacoVoz) => aoPedaco?.(p));

async function permitirMicrofone() {
  if (Platform.OS !== 'android') return;
  const permissao = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permissao)) return;
  if (await PermissionsAndroid.request(permissao) !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Permita o microfone para falar no rádio.');
}

export const radioMedia: MidiaRadio = {
  async abrir() {
    if (!nativo) throw new Error('Rádio indisponível nesta versão do app. Atualize o app.');
    liberar ??= reservarMicrofone('radio');
    if (!radioNativoDisponivel) {
      try { await AppOverlay.startRadioAudio(); }
      catch (e) { liberar?.(); liberar = null; throw e; }
    }
    // Com o app aberto, já pede o microfone: a primeira fala não espera pela permissão.
    if (AppState.currentState === 'active') permitirMicrofone().catch(() => {});
  },
  async microfone(modo, fn) {
    aoPedaco = fn;
    if (!nativo) return null;
    if (modo !== 'parado') await permitirMicrofone();
    return (await nativo.microfone(modo)) || null;
  },
  tocar(p) { if (!radioNativoDisponivel) nativo?.tocar(p.fala, p.codec, p.dados); },
  fimFala() { if (!radioNativoDisponivel) nativo?.fimFala(); },
  clear() {
    aoPedaco = null; nativo?.parar();
    liberar?.(); liberar = null;
    if (!radioNativoDisponivel) AppOverlay.stopRadioAudio().catch(() => {});
  },
};
