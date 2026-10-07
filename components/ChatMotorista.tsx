import { Ionicons } from '@expo/vector-icons';
import * as signalR from '@microsoft/signalr';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppOverlay from '../native/AppOverlay';
import { emitirAvisoRecebido } from '../services/avisos';
import { juntarMensagens as juntar, lerHistoricoLocal, salvarHistoricoLocal, type MensagemChat as Mensagem } from '../services/chatLocal';
import { API_BASE, motoristaFetch, obterTokenMotorista, observarSessaoEncerrada } from '../services/motoristaApi';

const hora = (data: string) => new Date(/Z|[+-]\d\d:\d\d$/.test(data) ? data : `${data}Z`).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const clienteId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
});

export default function ChatMotorista() {
  const pathname = usePathname();
  const { chat } = useGlobalSearchParams<{ chat?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [naoLidas, setNaoLidas] = useState(0);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [anteriores, setAnteriores] = useState(false);
  const [conectado, setConectado] = useState(false);
  const [nomeAgencia, setNomeAgencia] = useState('');
  const abertoRef = useRef(false);
  const conhecidoRef = useRef(0);
  const inicializadoRef = useRef(false);
  const enviandoRef = useRef(false);
  const pendenteRef = useRef<{ texto: string; id: string } | null>(null);
  const consultaRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const acompanharRef = useRef(true);
  const cicloRef = useRef(0);
  const motoristaIdRef = useRef<string | null>(null);
  const historicoProntoRef = useRef(false);
  const sincronizadoRef = useRef(0);
  const nomeAgenciaRef = useRef('');
  const ativo = pathname.startsWith('/radar');
  const tituloNotificacao = () => `Mensagem - ${nomeAgenciaRef.current || 'Agência'}`;

  const ler = useCallback(async (ateId: number) => {
    if (!ateId || AppState.currentState !== 'active') return;
    const resposta = await motoristaFetch('/api/Chat/ler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ateId }) });
    if (resposta.ok) setNaoLidas(0);
  }, []);

  const carregar = useCallback(async () => {
    if (consultaRef.current || !historicoProntoRef.current) return;
    consultaRef.current = true;
    const ciclo = cicloRef.current;
    try {
      const resposta = await motoristaFetch('/api/Chat/mensagens');
      if (!resposta.ok) throw new Error('Não foi possível carregar a conversa.');
      const dados = await resposta.json();
      let lista: Mensagem[] = dados.mensagens;
      // Busca no servidor o que chegou entre a última mensagem guardada no aparelho e as 60 mais recentes.
      const sincronizado = sincronizadoRef.current;
      let temMais = dados.temAnteriores;
      for (let paginas = 0; sincronizado > 0 && temMais && lista.length && lista[0].id > sincronizado && paginas < 10; paginas++) {
        const pagina = await motoristaFetch(`/api/Chat/mensagens?antesId=${lista[0].id}`);
        if (!pagina.ok) break;
        const anterioresServidor = await pagina.json();
        lista = [...anterioresServidor.mensagens, ...lista];
        temMais = anterioresServidor.temAnteriores;
      }
      if (ciclo !== cicloRef.current) return;
      if (dados.nomeAgencia) { nomeAgenciaRef.current = dados.nomeAgencia; setNomeAgencia(dados.nomeAgencia); }
      setMensagens(atual => juntar(atual, lista));
      if (!inicializadoRef.current) setAnteriores(dados.temAnteriores && sincronizado === 0);
      setNaoLidas(dados.naoLidas);
      const ultima = lista.at(-1)?.id || 0;
      const novas = lista.filter(m => m.remetente === 'Agencia' && !m.lidaEm && m.id > conhecidoRef.current);
      if (!abertoRef.current && novas.length) {
        const m = novas.at(-1)!;
        AppOverlay.notifyMessage(String(m.id), tituloNotificacao(), m.texto).catch(() => {});
      }
      conhecidoRef.current = Math.max(conhecidoRef.current, ultima);
      sincronizadoRef.current = Math.max(sincronizado, ultima);
      inicializadoRef.current = true;
      if (abertoRef.current && dados.naoLidas) await ler(ultima);
      setErro('');
    } catch (e) { if (abertoRef.current) setErro(e instanceof Error ? e.message : 'Sem conexão. Tente novamente.'); }
    finally { consultaRef.current = false; }
  }, [ler]);

  useEffect(() => observarSessaoEncerrada(() => {
    AppOverlay.stopRideMonitor().catch(() => {});
    setAberto(false); router.replace('/');
  }), [router]);

  // Guarda no aparelho o histórico da conversa.
  useEffect(() => {
    if (historicoProntoRef.current && motoristaIdRef.current && mensagens.length) salvarHistoricoLocal(motoristaIdRef.current, mensagens);
  }, [mensagens]);

  useEffect(() => {
    if (!ativo) return;
    const ciclo = ++cicloRef.current;
    let encerrado = false;
    let tentativa: ReturnType<typeof setTimeout> | undefined;
    const conexao = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE}/hub-corridas`, { accessTokenFactory: async () => (await obterTokenMotorista()) || '' })
      .withAutomaticReconnect().build();
    conexao.on('ChatMensagem', (m: Mensagem) => {
      setMensagens(atual => juntar(atual, [m]));
      if (m.remetente === 'Agencia' && m.id > conhecidoRef.current) {
        if (!abertoRef.current || AppState.currentState !== 'active') {
          setNaoLidas(n => n + 1);
          AppOverlay.notifyMessage(String(m.id), tituloNotificacao(), m.texto).catch(() => {});
        } else ler(m.id).catch(() => {});
      }
      conhecidoRef.current = Math.max(conhecidoRef.current, m.id);
    });
    conexao.on('ChatLida', (dados: { ateId: number; lidaPor: string; lidaEm: string }) => {
      if (dados.lidaPor === 'Agencia') setMensagens(lista => lista.map(m => m.id <= dados.ateId && m.remetente === 'Motorista' ? { ...m, lidaEm: dados.lidaEm } : m));
      else carregar();
    });
    conexao.on('AvisoMotorista', emitirAvisoRecebido);
    conexao.onreconnecting(() => setConectado(false));
    conexao.onreconnected(() => { setConectado(true); carregar(); });
    const iniciar = async () => {
      try { await conexao.start(); if (!encerrado) { setConectado(true); carregar(); } }
      catch { if (!encerrado) tentativa = setTimeout(iniciar, 5000); }
    };
    conexao.onclose(() => { setConectado(false); if (!encerrado) tentativa = setTimeout(iniciar, 5000); });
    (async () => {
      const [id, nome] = await Promise.all([AsyncStorage.getItem('idMotorista'), AsyncStorage.getItem('nomeAgencia')]);
      const locais = id ? await lerHistoricoLocal(id) : [];
      if (ciclo !== cicloRef.current) return;
      motoristaIdRef.current = id;
      if (nome && !nomeAgenciaRef.current) { nomeAgenciaRef.current = nome; setNomeAgencia(nome); }
      if (locais.length) {
        const maior = locais[locais.length - 1].id;
        setMensagens(atual => juntar(locais, atual));
        conhecidoRef.current = Math.max(conhecidoRef.current, maior);
        sincronizadoRef.current = maior;
      }
      historicoProntoRef.current = true;
      carregar();
    })();
    iniciar();
    const intervalo = setInterval(() => { if (AppState.currentState === 'active') carregar(); }, 15000);
    const estado = AppState.addEventListener('change', s => { if (s === 'active') carregar(); });
    return () => { encerrado = true; cicloRef.current = ciclo + 1; clearInterval(intervalo); clearTimeout(tentativa); estado.remove(); conexao.stop(); setConectado(false); };
  }, [ativo, carregar, ler]);

  useEffect(() => {
    if (pathname === '/radar/suporte' || (ativo && chat === '1')) { setAberto(true); abertoRef.current = true; acompanharRef.current = true; carregar(); }
    if (!ativo) {
      setAberto(false); abertoRef.current = false; setMensagens([]); setTexto(''); setNaoLidas(0); pendenteRef.current = null; inicializadoRef.current = false; conhecidoRef.current = 0;
      historicoProntoRef.current = false; sincronizadoRef.current = 0; motoristaIdRef.current = null; nomeAgenciaRef.current = ''; setNomeAgencia('');
    }
  }, [pathname, ativo, chat, carregar]);

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || enviandoRef.current) return;
    enviandoRef.current = true; setEnviando(true); setErro('');
    if (pendenteRef.current?.texto !== conteudo) pendenteRef.current = { texto: conteudo, id: clienteId() };
    try {
      const resposta = await motoristaFetch('/api/Chat/mensagens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: conteudo, clienteId: pendenteRef.current.id }),
      });
      if (!resposta.ok) throw new Error('Não foi possível enviar. Sua mensagem foi preservada; tente novamente.');
      const mensagem = await resposta.json();
      setMensagens(lista => juntar(lista, [mensagem])); setTexto(''); pendenteRef.current = null;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Sem conexão. Tente novamente.'); }
    finally { enviandoRef.current = false; setEnviando(false); }
  }

  async function carregarAnteriores() {
    if (!mensagens.length || carregando) return;
    setCarregando(true);
    try {
      const res = await motoristaFetch(`/api/Chat/mensagens?antesId=${mensagens[0].id}`);
      if (!res.ok) throw new Error('Não foi possível carregar o histórico.');
      const dados = await res.json(); setMensagens(lista => juntar(lista, dados.mensagens)); setAnteriores(dados.temAnteriores);
    } catch { setErro('Não foi possível carregar o histórico. Tente novamente.'); }
    finally { setCarregando(false); }
  }

  if (!ativo) return null;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Conversar com a agência, ${naoLidas} mensagens não lidas`} style={[styles.fab, { bottom: insets.bottom + 22 }]} onPress={() => {
      abertoRef.current = true; acompanharRef.current = true; setAberto(true); carregar(); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    }}>
      <Ionicons name="chatbubbles-outline" size={26} color="#fff" />
      {naoLidas > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{naoLidas > 99 ? '99+' : naoLidas}</Text></View>}
    </Pressable>
    <Modal visible={aberto} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { abertoRef.current = false; setAberto(false); }}>
      {/* O teclado empurra a conversa para cima (Android e iPhone), mantendo o campo de digitação visível. */}
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Fechar conversa" onPress={() => { abertoRef.current = false; setAberto(false); }} />
        <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.header}>
            <View style={styles.avatar}><Ionicons name="headset-outline" size={24} color="#047857" /></View>
            <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{nomeAgencia || 'Sua agência'}</Text><Text style={styles.subtitle}>{conectado ? 'Conversa em tempo real' : 'Reconectando conversa…'}</Text></View>
            <Pressable accessibilityLabel="Fechar conversa" onPress={() => { abertoRef.current = false; setAberto(false); }} style={styles.close}><Ionicons name="close" size={25} color="#475569" /></Pressable>
          </View>
          <ScrollView ref={scrollRef} style={styles.history} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled"
            scrollEventThrottle={100} onScroll={({ nativeEvent: e }) => { acompanharRef.current = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 100; }}
            onContentSizeChange={() => { if (acompanharRef.current) scrollRef.current?.scrollToEnd({ animated: false }); }}
            onLayout={() => { if (acompanharRef.current) scrollRef.current?.scrollToEnd({ animated: false }); }}>
            {anteriores && <Pressable onPress={carregarAnteriores}><Text style={styles.older}>{carregando ? 'Carregando…' : 'Carregar mensagens anteriores'}</Text></Pressable>}
            {!mensagens.length && <View style={styles.empty}><Ionicons name="chatbubble-ellipses-outline" size={40} color="#94a3b8" /><Text style={styles.emptyText}>Precisa de ajuda? Envie uma mensagem para sua agência.</Text></View>}
            {mensagens.map(m => <View key={m.id} style={[styles.bubble, m.remetente === 'Motorista' ? styles.sent : styles.received]}>
              <Text style={styles.messageText} selectable>{m.texto}</Text>
              <Text style={styles.time}>{hora(m.criadoEm)}{m.remetente === 'Motorista' ? m.lidaEm ? ' · Lida' : ' · Enviada' : ''}</Text>
            </View>)}
          </ScrollView>
          {!!erro && <Pressable onPress={carregar}><Text accessibilityRole="alert" style={styles.error}>{erro}</Text></Pressable>}
          <View style={styles.composer}>
            <TextInput accessibilityLabel="Mensagem para a agência" style={styles.input} placeholder="Escreva sua mensagem…" placeholderTextColor="#64748b" value={texto} onChangeText={setTexto} maxLength={2000} multiline
              onFocus={() => { acompanharRef.current = true; setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250); }} />
            <Pressable accessibilityLabel="Enviar mensagem" disabled={enviando || !texto.trim()} onPress={enviar} style={[styles.send, (!texto.trim() || enviando) && { opacity: 0.5 }]}>{enviando ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-up" size={24} color="#fff" />}</Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: '#047857', alignItems: 'center', justifyContent: 'center', elevation: 8, zIndex: 2000, shadowColor: '#064e3b', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 12 },
  badge: { position: 'absolute', right: -3, top: -3, backgroundColor: '#dc2626', borderRadius: 12, paddingHorizontal: 6, minWidth: 23, height: 23, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' }, badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.32)', justifyContent: 'flex-end', alignItems: 'center' },
  panel: { height: '82%', maxHeight: 700, width: '100%', maxWidth: 520, backgroundColor: '#f8fafc', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  header: { backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', padding: 18, gap: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }, avatar: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 17, fontWeight: '700', color: '#0f172a' }, subtitle: { fontSize: 12, color: '#64748b', marginTop: 3 }, close: { padding: 8 },
  history: { flex: 1 }, messages: { padding: 18, gap: 10 }, bubble: { maxWidth: '86%', padding: 12, borderRadius: 18 }, sent: { alignSelf: 'flex-end', backgroundColor: '#d1fae5', borderBottomRightRadius: 5 }, received: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderBottomLeftRadius: 5 }, messageText: { color: '#0f172a', fontSize: 15, lineHeight: 22 }, time: { fontSize: 10, color: '#64748b', textAlign: 'right', marginTop: 6 }, empty: { paddingVertical: 65, alignItems: 'center', gap: 14 }, emptyText: { color: '#64748b', textAlign: 'center', lineHeight: 22, maxWidth: 270 }, older: { color: '#047857', textAlign: 'center', padding: 10, fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' }, input: { flex: 1, maxHeight: 120, minHeight: 46, backgroundColor: '#f1f5f9', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, color: '#0f172a', fontSize: 15 }, send: { width: 46, height: 46, backgroundColor: '#047857', borderRadius: 23, alignItems: 'center', justifyContent: 'center' }, error: { color: '#b91c1c', fontSize: 12, paddingHorizontal: 18, paddingVertical: 8 },
});
