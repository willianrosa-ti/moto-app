import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter, Modal, Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { usePathname } from 'expo-router';
import * as signalR from '@microsoft/signalr';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE, motoristaFetch, obterTokenMotorista } from '../services/motoristaApi';
import { RadioClient, type AlertaAvulso, type EstadoRadio } from '../services/radio/RadioClient';
import { radioMedia } from '../services/radio/media';
import { criarHubNativo, radioNativoDisponivel } from '../services/radio/hubNativo';
import IconeAlerta from './IconeAlerta';
import IconeRadio from './IconeRadio';
import { volumeBipe } from '../services/volumeBipe';
import AppOverlay from '../native/AppOverlay';
import { Audio } from 'expo-av';

const vazio: EstadoRadio = { chamada: null, eu: null, conectado: false, preparando: false, erro: '' };
const RadioContext = createContext({ chamar: (_perfil: string, _id: number) => {}, estado: vazio,
  // Alerta avulso pelo chat (BIP BIP ALERTA); devolve a confirmação ou lança o motivo.
  alertar: async (_perfil: string, _id: number): Promise<string> => '' });
export const useRadio = () => useContext(RadioContext);

// Duração do PRI RADIO: o microfone só abre depois do bipe, como num rádio comunicador.
const DURACAO_BIPE_MS = 650;
function tocarBipeRadio() {
  // Volume do bipe nas Configurações; mudo = não toca e o microfone abre na hora.
  const volume = volumeBipe();
  if (volume <= 0) return 0;
  // No Android o bipe é nativo (usa o mesmo volume) e não toma o foco de áudio (tomar o foco encerraria o rádio).
  if (Platform.OS === 'android') AppOverlay.tocarBipeRadio().catch(() => {});
  else Audio.Sound.createAsync(require('../assets/sounds/pri-radio.mp3'), { shouldPlay: true, volume })
    .then(({ sound }) => sound.setOnPlaybackStatusUpdate(s => { if (s.isLoaded && s.didJustFinish) sound.unloadAsync().catch(() => {}); }))
    .catch(() => {});
  return DURACAO_BIPE_MS;
}
// Teste do volume nas Configurações.
export function tocarBipeTeste() { tocarBipeRadio(); }
// BIP BIP ALERTA: no Android toca como alarme (inclusive com o motorista em outro app).
function tocarAlertaRadio(chave: string) {
  if (Platform.OS === 'android') AppOverlay.tocarAlertaRadio(chave).catch(() => {});
  else Audio.Sound.createAsync(require('../assets/sounds/bip-alerta.mp3'), { shouldPlay: true })
    .then(({ sound }) => sound.setOnPlaybackStatusUpdate(s => { if (s.isLoaded && s.didJustFinish) sound.unloadAsync().catch(() => {}); }))
    .catch(() => {});
}
const ALERTAS_PARA_CONECTAR = 3;

export default function RadioProvider({ children }: { children: React.ReactNode }) {
  const ativo = usePathname().startsWith('/radar');
  const [estado, setEstado] = useState(vazio);
  const [alertaRecebido, setAlertaRecebido] = useState<AlertaAvulso | null>(null);
  const client = useRef<RadioClient | null>(null);
  useEffect(() => {
    if (!ativo) return;
    // Android: a tela usa a conexão do rádio nativo (que funciona com o app fechado). Navegador: SignalR direto.
    const hub = radioNativoDisponivel
      ? criarHubNativo(API_BASE, async () => (await obterTokenMotorista()) || '')
      : new signalR.HubConnectionBuilder().withUrl(`${API_BASE}/hub-radio`, { accessTokenFactory: async () => await obterTokenMotorista() || '' }).withAutomaticReconnect().build();
    const c = new RadioClient({ hub, media: radioMedia, update: setEstado,
      config: async () => { const r = await motoristaFetch('/api/Radio/config'); if (!r.ok) throw new Error('Rádio indisponível.'); return r.json(); },
      // Rádio sem "atender": com o app aberto conecta na hora. Fora do app, no Android quem conecta é o rádio nativo
      // (agência, "rádio direto" ou 3º alerta); no navegador, a própria tela.
      autoAtender: chamada => AppState.currentState === 'active' || (!radioNativoDisponivel &&
        (chamada.origem.perfil === 'Agencia' || !!chamada.direto || (chamada.alertas || 0) >= ALERTAS_PARA_CONECTAR)),
      // O bipe de quem começa a falar, no Android, toca pelo rádio nativo.
      bipe: tipo => tipo === 'ouvir' && radioNativoDisponivel ? 0 : tocarBipeRadio(),
      aoAlertar: chamada => {
        tocarAlertaRadio(`${chamada.id}:${chamada.alertas}`);
        Vibration.vibrate([0, 300, 150, 300]);
      },
      // Alerta pelo chat: toca o BIP BIP ALERTA (também com o app em segundo plano) e mostra quem chamou.
      aoAlertaAvulso: alerta => {
        tocarAlertaRadio(`avulso:${alerta.id}`);
        Vibration.vibrate([0, 300, 150, 300]);
        if (AppState.currentState !== 'active' && !radioNativoDisponivel) AppOverlay.notifyMessage(`radio-avulso-${alerta.id}`, `Alerta · ${alerta.de.nome}`, 'Toque para abrir a conversa.').catch(() => {});
        setAlertaRecebido(alerta);
      },
      invite: chamada => {
        Vibration.vibrate([0, 180, 100, 180]);
        if (AppState.currentState !== 'active' && !radioNativoDisponivel) AppOverlay.notifyMessage(`radio-${chamada.id}`, `Rádio · ${chamada.origem.nome}`,
          chamada.origem.perfil === 'Agencia' ? 'Rádio da agência ligado. Toque para responder.' : 'Rádio chamando. Toque para abrir e conectar.').catch(() => {});
      },
    });
    client.current = c; c.start();
    const audioFocus = DeviceEventEmitter.addListener('RadioInterrompido', () => c.end('Rádio interrompido por outro áudio ou ligação.'));
    // Sair do app só solta o botão de falar: a voz continua saindo no celular.
    const listener = AppState.addEventListener('change', s => {
      // Ao voltar: retoma a conversa que o rádio nativo atendeu e conecta a que estiver chamando.
      if (s === 'active') { c.sincronizar(); c.atenderPendente(); } else c.release();
    });
    return () => { listener.remove(); audioFocus.remove(); client.current = null; c.dispose(); setEstado(vazio); setAlertaRecebido(null); };
  }, [ativo]);
  const chamada = estado.chamada;
  const recebendo = chamada?.status === 'Tocando' && chamada.destino.chave === estado.eu?.chave;
  const outro = chamada?.origem.chave === estado.eu?.chave ? chamada?.destino : chamada?.origem;
  const falando = chamada?.falante === estado.eu?.chave && !!chamada?.falante;
  const alertas = chamada?.alertas || 0;
  const podeAlertar = chamada?.status === 'Tocando' && !recebendo && chamada.origem.chave === estado.eu?.chave && chamada.destino.perfil === 'Motorista';
  const texto = chamada?.status === 'Tocando' ? recebendo ? 'Conectando o rádio…' : podeAlertar ? (alertas >= ALERTAS_PARA_CONECTAR ? 'Alerta 3/3 enviado · conectando o rádio…' : 'Chamando… se o colega não estiver no app, envie o alerta') : 'Chamando… conectando o rádio' : chamada?.status === 'Ativa' ? falando ? 'Você está falando' : chamada.falante ? `${outro?.nome} está falando` : 'Canal livre' : 'Conectando áudio…';
  const abrirConversa = (a: AlertaAvulso) => {
    setAlertaRecebido(null);
    // O chat (ChatMotorista) abre na conversa de quem mandou o alerta.
    DeviceEventEmitter.emit('abrirConversa', { perfil: a.de.perfil, id: a.de.id });
  };
  return <RadioContext.Provider value={{ chamar: (perfil, id) => { client.current?.call(perfil, id); }, estado,
    alertar: async (perfil, id) => { if (!client.current) throw new Error('Rádio indisponível.'); return client.current.alertarAvulso(perfil, id); } }}>
    {children}
    <Modal transparent visible={ativo && !!alertaRecebido && !chamada} animationType="fade" onRequestClose={() => setAlertaRecebido(null)}>
      <View style={s.backdrop}><View style={s.card} accessibilityViewIsModal>
        <View style={[s.icon, { backgroundColor: '#fee2e2' }]}><IconeAlerta tamanho={30} /></View>
        <Text style={s.eyebrow}>ALERTA</Text><Text style={s.name}>{alertaRecebido?.de.nome || 'Alerta'}</Text>
        <Text style={s.status}>{alertaRecebido?.de.perfil === 'Agencia' ? 'A agência está chamando você.' : 'Seu colega está chamando você.'}</Text>
        <Pressable accessibilityRole="button" onPress={() => alertaRecebido && abrirConversa(alertaRecebido)} style={s.alerta}>
          <Ionicons name="chatbubbles" size={24} color="#fff" /><Text style={s.white}>Abrir conversa</Text>
        </Pressable>
        <Pressable style={s.end} onPress={() => setAlertaRecebido(null)}><Text style={[s.endText, { color: '#475569' }]}>Fechar</Text></Pressable>
      </View></View>
    </Modal>
    <Modal transparent visible={ativo && (!!chamada || !!estado.erro || estado.preparando)} animationType="fade" onRequestClose={() => client.current?.end()}>
      <View style={s.backdrop}><View style={s.card} accessibilityViewIsModal>
        <View style={s.icon}><IconeRadio tamanho={32} cor="#065f46" /></View>
        <Text style={s.eyebrow}>RÁDIO PRIVADO</Text><Text style={s.name}>{outro?.nome || 'Rádio'}</Text>
        {!!chamada && <Text accessibilityLiveRegion="polite" style={s.status}>{texto}</Text>}
        {estado.preparando && <Text style={s.status}>Abrindo o rádio…</Text>}
        {!!estado.erro && <Text accessibilityRole="alert" style={s.error}>{estado.erro}</Text>}
        {podeAlertar && alertas < ALERTAS_PARA_CONECTAR && <>
          <Pressable accessibilityRole="button" accessibilityLabel={`Enviar alerta, ${alertas} de ${ALERTAS_PARA_CONECTAR}`} onPress={() => client.current?.alertar()} style={s.alerta}>
            <IconeAlerta tamanho={24} cor="#fff" /><Text style={s.white}>Enviar alerta ({alertas}/{ALERTAS_PARA_CONECTAR})</Text>
          </Pressable><Text style={s.hint}>No 3º alerta o rádio do colega liga sozinho e a sua voz sai no celular dele.</Text>
        </>}
        {chamada?.status === 'Ativa' && <>
          <Pressable accessibilityRole="button" accessibilityLabel="Segure para falar no rádio" onPressIn={() => client.current?.press()} onPressOut={() => client.current?.release()} onTouchCancel={() => client.current?.release()} style={[s.talk, falando && s.talking]}>
            <IconeRadio tamanho={38} cor="#fff" /><Text style={s.white}>{falando ? 'Falando…' : 'Segure para falar'}</Text>
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
  alerta: { backgroundColor: '#dc2626', padding: 18, borderRadius: 18, width: '100%', alignItems: 'center', gap: 6, marginTop: 8 },
  talk: { backgroundColor: '#047857', padding: 26, borderRadius: 24, width: '100%', alignItems: 'center', gap: 10, marginTop: 12 }, talking: { backgroundColor: '#ea580c' },
  white: { color: '#fff', fontWeight: '700', fontSize: 16 }, hint: { color: '#64748b', fontSize: 12, textAlign: 'center' }, end: { padding: 16 }, endText: { color: '#b91c1c', fontWeight: '600' },
});
