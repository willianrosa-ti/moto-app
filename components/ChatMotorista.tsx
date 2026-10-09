import { Ionicons } from '@expo/vector-icons';
import * as signalR from '@microsoft/signalr';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, DeviceEventEmitter, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppOverlay from '../native/AppOverlay';
import { emitirAvisoRecebido } from '../services/avisos';
import { DURACAO_MAXIMA_MS, enviarGravacao, formatarDuracao, iniciarGravacao, obterUriAudio, type Gravacao, type GravacaoAtiva } from '../services/audioMotorista';
import PlayerAudio from './PlayerAudio';
import ChatColegas from './ChatColegas';
import IconeAlerta from './IconeAlerta';
import { useAgenciaComunicacao } from '../services/agenciaComunicacao';
import { useRadio } from './RadioProvider';
import { colegaAberto, emitirDireta, guardarDiretas, type MensagemDireta } from '../services/chatDireto';
import { juntarMensagens as juntar, lerHistoricoLocal, salvarHistoricoLocal, type MensagemChat as Mensagem } from '../services/chatLocal';
import { API_BASE, motoristaFetch, obterTokenMotorista, observarSessaoEncerrada } from '../services/motoristaApi';

const hora = (data: string) => new Date(/Z|[+-]\d\d:\d\d$/.test(data) ? data : `${data}Z`).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const clienteId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
});
type AudioPendente = Gravacao & { clienteId: string; audioId?: string };

export default function ChatMotorista() {
  const pathname = usePathname();
  const { chat, colega } = useGlobalSearchParams<{ chat?: string; colega?: string }>();
  const [abaColegas, setAbaColegas] = useState(false);
  const [naoLidasColegas, setNaoLidasColegas] = useState(0);
  const { chamar, alertar, estado: radio } = useRadio();
  const comunicacao = useAgenciaComunicacao();
  const comunicacaoRef = useRef(comunicacao);
  comunicacaoRef.current = comunicacao;
  const [aviso, setAviso] = useState('');
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(''), 2500); return () => clearTimeout(t); }, [aviso]);
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
  const [gravando, setGravando] = useState(false);
  const [tempoGravacao, setTempoGravacao] = useState(0);
  const [audioPendente, setAudioPendente] = useState<AudioPendente | null>(null);
  const gravadorRef = useRef<GravacaoAtiva | null>(null);
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
  useEffect(() => { if (radio.chamada) { setAberto(false); abertoRef.current = false; } }, [radio.chamada]);
  useEffect(() => { if (colega && ativo) { setAbaColegas(true); setAberto(true); abertoRef.current = false; } }, [colega, ativo]);
  useEffect(() => { abertoRef.current = aberto && !abaColegas; }, [aberto, abaColegas]);
  const carregarColegas = useCallback(async () => {
    try { const r = await motoristaFetch('/api/ChatDireto/colegas'); if (r.ok) setNaoLidasColegas((await r.json()).reduce((n: number, c: { naoLidas: number }) => n + c.naoLidas, 0)); } catch { /* consulta posterior recupera */ }
  }, []);
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

  // Áudios recebidos ficam guardados no celular assim que chegam, mesmo antes de serem ouvidos.
  useEffect(() => {
    mensagens.forEach(m => { if (m.audioId) obterUriAudio(m.audioId).catch(() => {}); });
  }, [mensagens]);

  useEffect(() => {
    if (!gravando) return;
    const intervalo = setInterval(() => {
      const ms = Date.now() - (gravadorRef.current?.inicio ?? Date.now());
      setTempoGravacao(ms);
      if (ms >= DURACAO_MAXIMA_MS) pararGravacao();
    }, 250);
    return () => clearInterval(intervalo);
  }, [gravando]);

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
    conexao.on('ChatDiretaMensagem', async (m: MensagemDireta) => {
      const eu = Number(motoristaIdRef.current || await AsyncStorage.getItem('idMotorista'));
      if (m.remetenteMotoristaId !== eu && m.destinatarioMotoristaId !== eu) return;
      const idColega = m.remetenteMotoristaId === eu ? m.destinatarioMotoristaId : m.remetenteMotoristaId;
      if (eu) guardarDiretas(eu, idColega, [m]).catch(() => {});
      if (m.audioId) obterUriAudio(m.audioId).catch(() => {});
      emitirDireta(m); carregarColegas();
      if (m.destinatarioMotoristaId === eu && (colegaAberto() !== idColega || AppState.currentState !== 'active')) AppOverlay.notifyMessage(`direta-${idColega}-${m.id}`, comunicacaoRef.current ? 'Nova mensagem' : 'Mensagem de motorista', m.texto).catch(() => {});
    });
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
    iniciar(); carregarColegas();
    const intervalo = setInterval(() => { if (AppState.currentState === 'active') { carregar(); carregarColegas(); } }, 15000);
    const estado = AppState.addEventListener('change', s => { if (s === 'active') carregar(); });
    return () => { encerrado = true; cicloRef.current = ciclo + 1; clearInterval(intervalo); clearTimeout(tentativa); estado.remove(); conexao.stop(); setConectado(false); };
  }, [ativo, carregar, ler, carregarColegas]);

  // Abrir a conversa por dentro do app (alerta recebido, cartão de comunicação), sem trocar de tela.
  const [colegaEvento, setColegaEvento] = useState<number | undefined>();
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('abrirConversa', (d?: { perfil?: string; id?: number }) => {
      if (d?.perfil === 'Motorista' && d.id) { setColegaEvento(d.id); setAbaColegas(true); setAberto(true); abertoRef.current = false; }
      else { setAbaColegas(false); setAberto(true); abertoRef.current = true; acompanharRef.current = true; carregar(); }
    });
    return () => sub.remove();
  }, [carregar]);

  useEffect(() => {
    if (pathname === '/radar/suporte' || (ativo && chat === '1')) { setAbaColegas(false); setAberto(true); abertoRef.current = true; acompanharRef.current = true; carregar(); }
    if (!ativo) {
      setAberto(false); abertoRef.current = false; setMensagens([]); setTexto(''); setNaoLidas(0); pendenteRef.current = null; inicializadoRef.current = false; conhecidoRef.current = 0;
      historicoProntoRef.current = false; sincronizadoRef.current = 0; motoristaIdRef.current = null; nomeAgenciaRef.current = ''; setNomeAgencia('');
      gravadorRef.current?.cancelar().catch(() => {}); gravadorRef.current = null; setGravando(false); setAudioPendente(null);
      setAbaColegas(false); setNaoLidasColegas(0);
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

  function fechar() {
    abertoRef.current = false; setAberto(false);
    if (gravadorRef.current) descartarAudio();
  }

  async function gravarAudio() {
    setErro('');
    try { gravadorRef.current = await iniciarGravacao(); setTempoGravacao(0); setGravando(true); }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível gravar o áudio.'); }
  }

  async function pararGravacao(): Promise<AudioPendente | null> {
    const gravador = gravadorRef.current;
    if (!gravador) return null;
    gravadorRef.current = null; setGravando(false);
    try {
      const pendente = { ...(await gravador.parar()), clienteId: clienteId() };
      setAudioPendente(pendente);
      return pendente;
    } catch (e) { setErro(e instanceof Error ? e.message : 'A gravação falhou. Tente de novo.'); return null; }
  }

  function descartarAudio() {
    gravadorRef.current?.cancelar().catch(() => {}); gravadorRef.current = null;
    setGravando(false); setAudioPendente(null);
  }

  async function enviarAudio() {
    if (enviandoRef.current) return;
    let pendente = gravadorRef.current ? await pararGravacao() : audioPendente;
    if (!pendente) return;
    enviandoRef.current = true; setEnviando(true); setErro('');
    try {
      if (!pendente.audioId) { pendente = { ...pendente, audioId: await enviarGravacao(pendente) }; setAudioPendente(pendente); }
      const resposta = await motoristaFetch('/api/Chat/mensagens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioId: pendente.audioId, clienteId: pendente.clienteId }),
      });
      if (!resposta.ok) throw new Error('Não foi possível enviar o áudio.');
      const mensagem = await resposta.json();
      setMensagens(lista => juntar(lista, [mensagem])); setAudioPendente(null);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) { setErro(`${e instanceof Error ? e.message : 'Sem conexão.'} O áudio foi preservado; tente novamente.`); }
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

  async function biparAgencia() {
    try {
      const r = await motoristaFetch('/api/Radio/config'); if (!r.ok) throw new Error('Não foi possível consultar o rádio.');
      const c = await r.json();
      if (!c.podeChamarAgencia) throw new Error('Fora de uma corrida, o rádio com a agência é aberto por ela. Toque no sino para enviar um alerta.');
      chamar('Agencia', c.eu.agenciaId);
    } catch (e) { setErro((e as Error).message); }
  }

  // Alerta (BIP BIP ALERTA) para a agência, a qualquer momento.
  async function alertarAgencia() {
    try {
      const r = await motoristaFetch('/api/Radio/config'); if (!r.ok) throw new Error('Não foi possível consultar o rádio.');
      const c = await r.json();
      setAviso(await alertar('Agencia', c.eu.agenciaId) || 'Alerta enviado.'); setErro('');
    } catch (e) { setErro((e as Error).message); }
  }

  if (!ativo || comunicacao) return null;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Conversas, ${naoLidas + naoLidasColegas} mensagens não lidas`} style={[styles.fab, { bottom: insets.bottom + 22 }]} onPress={() => {
      abertoRef.current = true; acompanharRef.current = true; setAberto(true); carregar(); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    }}>
      <Ionicons name="chatbubbles-outline" size={26} color="#fff" />
      {naoLidas + naoLidasColegas > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{naoLidas + naoLidasColegas > 99 ? '99+' : naoLidas + naoLidasColegas}</Text></View>}
    </Pressable>
    <Modal visible={aberto && !radio.chamada && !radio.preparando && !radio.erro} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={fechar}>
      {/* O teclado empurra a conversa para cima (Android e iPhone), mantendo o campo de digitação visível. */}
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Fechar conversa" onPress={fechar} />
        <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.header}>
            <View style={styles.avatar}><Ionicons name="headset-outline" size={24} color="#047857" /></View>
            <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{abaColegas ? (comunicacao ? 'Contatos' : 'Motoristas') : nomeAgencia || 'Sua agência'}</Text><Text style={styles.subtitle}>{conectado ? 'Conversa em tempo real' : 'Reconectando conversa…'}</Text></View>
            {!abaColegas && <Pressable accessibilityRole="button" accessibilityLabel="Enviar alerta para a agência" onPress={alertarAgencia} style={[styles.close, { backgroundColor: '#fee2e2', borderRadius: 14 }]}><IconeAlerta tamanho={20} /></Pressable>}
            {!abaColegas && <Pressable accessibilityRole="button" accessibilityLabel="Bipar para chamar a agência no rádio" onPress={biparAgencia} style={styles.close}><Ionicons name="radio-outline" size={24} color="#047857" /></Pressable>}
            <Pressable accessibilityLabel="Fechar conversa" onPress={fechar} style={styles.close}><Ionicons name="close" size={25} color="#475569" /></Pressable>
          </View>
          <View style={{ flexDirection: 'row', padding: 8, gap: 8 }}>
            <Pressable disabled={gravando || !!audioPendente || enviando} onPress={() => { setAbaColegas(false); abertoRef.current = true; carregar(); }} style={{ flex: 1, padding: 12, backgroundColor: !abaColegas ? '#d1fae5' : '#e2e8f0', borderRadius: 14 }}><Text style={{ textAlign: 'center', color: '#065f46', fontWeight: '700' }}>Agência{naoLidas ? ` (${naoLidas})` : ''}</Text></Pressable>
            <Pressable disabled={gravando || !!audioPendente || enviando} onPress={() => { setAbaColegas(true); abertoRef.current = false; }} style={{ flex: 1, padding: 12, backgroundColor: abaColegas ? '#d1fae5' : '#e2e8f0', borderRadius: 14 }}><Text style={{ textAlign: 'center', color: '#065f46', fontWeight: '700' }}>{comunicacao ? 'Contatos' : 'Motoristas'}{naoLidasColegas ? ` (${naoLidasColegas})` : ''}</Text></Pressable>
          </View>
          {abaColegas ? aberto && <ChatColegas inicial={colegaEvento || Number(colega) || undefined} /> : <>
          <ScrollView ref={scrollRef} style={styles.history} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled"
            scrollEventThrottle={100} onScroll={({ nativeEvent: e }) => { acompanharRef.current = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 100; }}
            onContentSizeChange={() => { if (acompanharRef.current) scrollRef.current?.scrollToEnd({ animated: false }); }}
            onLayout={() => { if (acompanharRef.current) scrollRef.current?.scrollToEnd({ animated: false }); }}>
            {anteriores && <Pressable onPress={carregarAnteriores}><Text style={styles.older}>{carregando ? 'Carregando…' : 'Carregar mensagens anteriores'}</Text></Pressable>}
            {!mensagens.length && <View style={styles.empty}><Ionicons name="chatbubble-ellipses-outline" size={40} color="#94a3b8" /><Text style={styles.emptyText}>Precisa de ajuda? Envie uma mensagem para sua agência.</Text></View>}
            {mensagens.map(m => <View key={m.id} style={[styles.bubble, m.remetente === 'Motorista' ? styles.sent : styles.received]}>
              {m.audioId ? <PlayerAudio audioId={m.audioId} duracaoMs={m.duracaoAudioMs} /> : <Text style={styles.messageText} selectable>{m.texto}</Text>}
              <Text style={styles.time}>{hora(m.criadoEm)}{m.remetente === 'Motorista' ? m.lidaEm ? ' · Lida' : ' · Enviada' : ''}</Text>
            </View>)}
          </ScrollView>
          {!!erro && <Pressable onPress={carregar}><Text accessibilityRole="alert" style={styles.error}>{erro}</Text></Pressable>}
          {!!aviso && !abaColegas && <Text accessibilityLiveRegion="polite" style={{ color: '#047857', fontSize: 12, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#ecfdf5' }}>{aviso}</Text>}
          <View style={styles.composer}>
            {gravando ? (
              <View style={styles.gravacao} accessibilityLiveRegion="polite"><View style={styles.pontoGravando} /><Text style={styles.textoGravando}>Gravando {formatarDuracao(tempoGravacao)}</Text></View>
            ) : audioPendente ? (
              <View style={styles.gravacao}><Ionicons name="mic" size={18} color="#047857" /><Text style={styles.textoPendente}>Áudio de {formatarDuracao(audioPendente.duracaoMs)} pronto para enviar</Text></View>
            ) : (
              <TextInput accessibilityLabel="Mensagem para a agência" style={styles.input} placeholder="Escreva sua mensagem…" placeholderTextColor="#64748b" value={texto} onChangeText={setTexto} maxLength={2000} multiline
                onFocus={() => { acompanharRef.current = true; setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250); }} />
            )}
            {gravando || audioPendente ? <>
              <Pressable accessibilityLabel="Descartar áudio" disabled={enviando} onPress={descartarAudio} style={[styles.send, styles.descartar]}><Ionicons name="trash-outline" size={22} color="#b91c1c" /></Pressable>
              <Pressable accessibilityLabel="Enviar áudio" disabled={enviando} onPress={enviarAudio} style={[styles.send, enviando && { opacity: 0.5 }]}>{enviando ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-up" size={24} color="#fff" />}</Pressable>
            </> : texto.trim() ? (
              <Pressable accessibilityLabel="Enviar mensagem" disabled={enviando} onPress={enviar} style={[styles.send, enviando && { opacity: 0.5 }]}>{enviando ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-up" size={24} color="#fff" />}</Pressable>
            ) : (
              <Pressable accessibilityLabel="Gravar áudio" onPress={gravarAudio} style={styles.send}><Ionicons name="mic" size={24} color="#fff" /></Pressable>
            )}
          </View>
          </>}
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
  gravacao: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', borderRadius: 20 },
  pontoGravando: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#dc2626' }, textoGravando: { color: '#b91c1c', fontWeight: '700', fontSize: 14 },
  textoPendente: { color: '#0f172a', fontSize: 13, flexShrink: 1 }, descartar: { backgroundColor: '#fee2e2' },
});
