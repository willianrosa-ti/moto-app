import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter, Modal, Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { usePathname } from 'expo-router';
import * as signalR from '@microsoft/signalr';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE, motoristaFetch, obterTokenMotorista } from '../services/motoristaApi';
import { RadioClient, type EstadoRadio } from '../services/radio/RadioClient';
import { radioMedia } from '../services/radio/media';
import AppOverlay from '../native/AppOverlay';
import { Audio } from 'expo-av';

const vazio: EstadoRadio = { chamada: null, eu: null, conectado: false, preparando: false, erro: '' };
const RadioContext = createContext({ chamar: (_perfil: string, _id: number) => {}, estado: vazio });
export const useRadio = () => useContext(RadioContext);

// Duração do PRI RADIO: o microfone só abre depois do bipe, como num rádio comunicador.
const DURACAO_BIPE_MS = 650;
function tocarBipeRadio() {
  // No Android o bipe é nativo e não toma o foco de áudio (tomar o foco encerraria o rádio).
  if (Platform.OS === 'android') AppOverlay.tocarBipeRadio().catch(() => {});
  else Audio.Sound.createAsync(require('../assets/sounds/pri-radio.mp3'), { shouldPlay: true })
    .then(({ sound }) => sound.setOnPlaybackStatusUpdate(s => { if (s.isLoaded && s.didJustFinish) sound.unloadAsync().catch(() => {}); }))
    .catch(() => {});
  return DURACAO_BIPE_MS;
}

export default function RadioProvider({ children }: { children: React.ReactNode }) {
  const ativo = usePathname().startsWith('/radar');
  const [estado, setEstado] = useState(vazio);
  const client = useRef<RadioClient | null>(null);
  useEffect(() => {
    if (!ativo) return;
    const hub = new signalR.HubConnectionBuilder().withUrl(`${API_BASE}/hub-radio`, { accessTokenFactory: async () => await obterTokenMotorista() || '' }).withAutomaticReconnect().build();
    const c = new RadioClient({ hub, media: radioMedia, update: setEstado,
      config: async (voz = false) => { const r = await motoristaFetch(`/api/Radio/config?voz=${voz}`); if (!r.ok) throw new Error('Rádio indisponível.'); return r.json(); },
      // Rádio não tem "atender": com o app aberto, a conexão é feita na hora.
      autoAtender: () => AppState.currentState === 'active',
      bipe: () => tocarBipeRadio(),
      invite: chamada => {
        Vibration.vibrate([0, 180, 100, 180]);
        if (AppState.currentState !== 'active') AppOverlay.notifyMessage(`radio-${chamada.id}`, `Rádio · ${chamada.origem.nome}`, 'Rádio chamando. Toque para abrir.').catch(() => {});
      },
    });
    client.current = c; c.start();
    const audioFocus = DeviceEventEmitter.addListener('RadioInterrompido', () => c.end('Rádio interrompido por outro áudio ou ligação.'));
    const listener = AppState.addEventListener('change', s => {
      if (s === 'active') { c.atenderPendente(); return; }
      c.release();
      if (c.state.chamada && c.state.chamada.status !== 'Tocando') c.end('Rádio encerrado ao sair do app. Chame novamente para continuar.');
    });
    return () => { listener.remove(); audioFocus.remove(); client.current = null; c.dispose(); setEstado(vazio); };
  }, [ativo]);
  const chamada = estado.chamada;
  const recebendo = chamada?.status === 'Tocando' && chamada.destino.chave === estado.eu?.chave;
  const outro = chamada?.origem.chave === estado.eu?.chave ? chamada?.destino : chamada?.origem;
  const falando = chamada?.falante === estado.eu?.chave && !!chamada?.falante;
  const texto = chamada?.status === 'Tocando' ? recebendo ? 'Conectando o rádio…' : 'Chamando… conectando o rádio' : chamada?.status === 'Ativa' ? falando ? 'Você está falando' : chamada.falante ? `${outro?.nome} está falando` : 'Canal livre' : 'Conectando áudio…';
  return <RadioContext.Provider value={{ chamar: (perfil, id) => { client.current?.call(perfil, id); }, estado }}>
    {children}
    <Modal transparent visible={ativo && (!!chamada || !!estado.erro || estado.preparando)} animationType="fade" onRequestClose={() => client.current?.end()}>
      <View style={s.backdrop}><View style={s.card} accessibilityViewIsModal>
        <View style={s.icon}><Ionicons name="radio-outline" color="#065f46" size={32} /></View>
        <Text style={s.eyebrow}>RÁDIO PRIVADO</Text><Text style={s.name}>{outro?.nome || 'Rádio'}</Text>
        {!!chamada && <Text accessibilityLiveRegion="polite" style={s.status}>{texto}</Text>}
        {estado.preparando && <Text style={s.status}>Preparando microfone…</Text>}
        {!!estado.erro && <Text accessibilityRole="alert" style={s.error}>{estado.erro}</Text>}
        {chamada?.status === 'Ativa' && <>
          <Pressable accessibilityRole="button" accessibilityLabel="Segure para falar no rádio" onPressIn={() => client.current?.press()} onPressOut={() => client.current?.release()} onTouchCancel={() => client.current?.release()} style={[s.talk, falando && s.talking]}>
            <Ionicons name="mic" size={38} color="#fff" /><Text style={s.white}>{falando ? 'Falando…' : 'Segure para falar'}</Text>
          </Pressable><Text style={s.hint}>Espere o bipe para falar · solte para ouvir · até 20 s por fala</Text>
        </>}
        <Pressable style={s.end} onPress={() => client.current?.end()}><Text style={s.endText}>{chamada ? 'Encerrar rádio' : 'Fechar'}</Text></Pressable>
      </View></View>
    </Modal>
  </RadioContext.Provider>;
}
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0f172aa6', justifyContent: 'center', padding: 28, alignItems: 'center' },
  card: { width: '100%', maxWidth: 400, borderRadius: 28, backgroundColor: '#fff', padding: 28, alignItems: 'center', gap: 12 },
  icon: { width: 70, height: 70, backgroundColor: '#d1fae5', borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 11, letterSpacing: 2, color: '#64748b', fontWeight: '700' }, name: { fontSize: 24, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  status: { color: '#475569', textAlign: 'center' }, error: { color: '#b91c1c', textAlign: 'center' },
  talk: { backgroundColor: '#047857', padding: 26, borderRadius: 24, width: '100%', alignItems: 'center', gap: 10, marginTop: 12 }, talking: { backgroundColor: '#ea580c' },
  white: { color: '#fff', fontWeight: '700', fontSize: 16 }, hint: { color: '#64748b', fontSize: 12, textAlign: 'center' }, end: { padding: 16 }, endText: { color: '#b91c1c', fontWeight: '600' },
});
