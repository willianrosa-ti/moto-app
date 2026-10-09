import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, DeviceEventEmitter, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { motoristaFetch } from '../services/motoristaApi';
import { abrirColega, guardarDiretas, juntarDiretas, lerDiretas, observarDiretas, type MensagemDireta } from '../services/chatDireto';
import { DURACAO_MAXIMA_MS, enviarGravacao, formatarDuracao, iniciarGravacao, obterUriAudio, type Gravacao, type GravacaoAtiva } from '../services/audioMotorista';
import { uuid } from '../services/radio/RadioClient';
import { useRadio } from './RadioProvider';
import PlayerAudio from './PlayerAudio';
import IconeAlerta from './IconeAlerta';
import { useAgenciaComunicacao } from '../services/agenciaComunicacao';

// podeRadio/podeAlerta: o que o colega recebe agora (online, ocupado ou offline, conforme as Configurações dele).
// radio: formato antigo ("radio", "alerta", "ocupado" ou "nenhum") de servidores anteriores.
type Colega = { id: number; nome: string; online: boolean; naoLidas: number; radio?: string; podeRadio?: boolean; podeAlerta?: boolean;
  situacao?: 'online' | 'ocupado' | 'offline'; ultimaMensagem?: string | null; ultimaEm?: string | null };
const legado = (c?: Colega) => c?.radio || (c?.online ? 'radio' : 'nenhum');
const podeBipar = (c?: Colega) => c?.podeRadio ?? legado(c) === 'radio';
const podeAlertar = (c?: Colega) => c?.podeAlerta ?? ['radio', 'alerta'].includes(legado(c));
function situacao(c: Colega) {
  const extra = podeBipar(c) ? 'recebe rádio' : podeAlertar(c) ? 'recebe alerta' : 'pode deixar mensagem';
  if ((c.situacao ?? (legado(c) === 'ocupado' ? 'ocupado' : null)) === 'ocupado') return `Ocupado · ${extra}`;
  if (c.online) return 'Online';
  return `Offline · ${extra}`;
}
type Previa = { texto: string; em: string };
function horaPrevia(em: string) {
  const d = new Date(em); if (Number.isNaN(d.getTime())) return '';
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
type AudioPendente = Gravacao & { clienteId: string; audioId?: string };
async function api(path: string, body?: object) {
  const r = await motoristaFetch(`/api/ChatDireto${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!r.ok) { const erro = await r.json().catch(() => ({})); throw new Error(erro.mensagem || 'Não foi possível acessar a conversa. Tente novamente.'); }
  return r.status === 204 ? null : r.json();
}
// embutido: tela principal da conta só de comunicação (lista de contatos e últimas conversas, tipo WhatsApp).
export default function ChatColegas({ inicial, embutido = false }: { inicial?: number; embutido?: boolean }) {
  const [colegas, setColegas] = useState<Colega[]>([]);
  const [selecionado, setSelecionado] = useState<number | null>(inicial || null);
  const [mensagens, setMensagens] = useState<MensagemDireta[]>([]);
  const [eu, setEu] = useState(0);
  const [texto, setTexto] = useState(''); const [busca, setBusca] = useState('');
  const [erro, setErro] = useState(''); const [enviando, setEnviando] = useState(false); const [aviso, setAviso] = useState('');
  const [anteriores, setAnteriores] = useState(false); const [gravando, setGravando] = useState(false);
  const [tempo, setTempo] = useState(0); const [audio, setAudio] = useState<AudioPendente | null>(null);
  const gravador = useRef<GravacaoAtiva | null>(null), pendente = useRef<{ texto: string; id: string } | null>(null);
  const trava = useRef(false), ciclo = useRef(0), scroll = useRef<ScrollView>(null);
  const { chamar, alertar } = useRadio();
  // Conta só de comunicação: aparecem só os contatos (quem você adicionou ou quem adicionou você).
  const comunicacao = useAgenciaComunicacao();
  const [adicionando, setAdicionando] = useState(false);
  const [novoTelefone, setNovoTelefone] = useState(''); const [novoApelido, setNovoApelido] = useState('');
  async function adicionarContato() {
    setEnviando(true);
    try {
      const r = await motoristaFetch('/api/ChatDireto/contatos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefone: novoTelefone, apelido: novoApelido }) });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.mensagem || 'Não foi possível adicionar o contato.');
      setAviso(dados.mensagem || 'Contato adicionado.'); setErro(''); setAdicionando(false); setNovoTelefone(''); setNovoApelido('');
      contatos();
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }
  function removerContato(c: Colega) {
    const remover = async () => {
      try { const r = await motoristaFetch(`/api/ChatDireto/contatos/${c.id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(); contatos(); }
      catch { setErro('Não foi possível remover o contato.'); }
    };
    if (Platform.OS === 'web') { remover(); return; }
    Alert.alert('Remover contato', `Remover ${c.nome} dos seus contatos? Vocês deixam de se ver no chat e no rádio.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Remover', style: 'destructive', onPress: remover }]);
  }
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(''), 2500); return () => clearTimeout(t); }, [aviso]);
  const enviarAlerta = (id: number) => alertar('Motorista', id).then(m => { setErro(''); setAviso(m || 'Alerta enviado.'); }).catch(e => setErro((e as Error).message));
  useEffect(() => { AsyncStorage.getItem('idMotorista').then(id => setEu(Number(id))); }, []);
  useEffect(() => { if (inicial) setSelecionado(inicial); }, [inicial]);
  const contatos = useCallback(() => api('/colegas').then(setColegas).catch(e => setErro(e.message)), []);
  useEffect(() => { contatos(); const t = setInterval(contatos, 15000); return () => clearInterval(t); }, [contatos]);
  // Lista: atualiza quando chega mensagem de qualquer contato (a última conversa sobe para o topo).
  useEffect(() => observarDiretas(() => { setTimeout(contatos, 300); }), [contatos]);
  // Últimas conversas guardadas no aparelho (o servidor apaga as antigas).
  const [previas, setPrevias] = useState<Record<number, Previa>>({});
  useEffect(() => {
    if (!comunicacao || !eu) return;
    let ativo = true;
    Promise.all(colegas.map(async c => [c.id, (await lerDiretas(eu, c.id)).at(-1)] as const)).then(pares => {
      if (!ativo) return;
      const mapa: Record<number, Previa> = {};
      pares.forEach(([id, m]) => { if (m) mapa[id] = { texto: m.texto, em: m.criadoEm }; });
      setPrevias(mapa);
    });
    return () => { ativo = false; };
  }, [comunicacao, eu, colegas]);
  const ultimaDe = (c: Colega): Previa | null => {
    const local = previas[c.id] || null, servidor = c.ultimaEm ? { texto: c.ultimaMensagem || '', em: c.ultimaEm } : null;
    if (!local || !servidor) return local || servidor;
    return Date.parse(local.em) >= Date.parse(servidor.em) ? local : servidor;
  };
  // Tela principal: abre a conversa pedida (alerta recebido, notificação) e o "voltar" do Android fecha a conversa.
  const { colega: colegaParam } = useGlobalSearchParams<{ colega?: string }>();
  useEffect(() => { if (embutido && Number(colegaParam)) setSelecionado(Number(colegaParam)); }, [embutido, colegaParam]);
  useEffect(() => {
    if (!embutido) return;
    const sub = DeviceEventEmitter.addListener('abrirConversa', (d?: { perfil?: string; id?: number }) => { if (d?.perfil === 'Motorista' && d.id) setSelecionado(d.id); });
    return () => sub.remove();
  }, [embutido]);
  useEffect(() => {
    if (!embutido || !selecionado) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSelecionado(null); return true; });
    return () => sub.remove();
  }, [embutido, selecionado]);
  const adicionar = useCallback((lista: MensagemDireta[]) => {
    setMensagens(a => juntarDiretas(a, lista));
    if (eu && selecionado) guardarDiretas(eu, selecionado, lista).catch(() => {});
    lista.forEach(m => { if (m.audioId) obterUriAudio(m.audioId).catch(() => {}); });
  }, [eu, selecionado]);
  useEffect(() => {
    const versao = ++ciclo.current; setMensagens([]); setTexto(''); setErro(''); setAnteriores(false); pendente.current = null;
    if (!selecionado || !eu) return;
    abrirColega(selecionado);
    let ocupado = false;
    async function carregar() {
      if (ocupado || AppState.currentState !== 'active') return; ocupado = true;
      try {
        const locais = await lerDiretas(eu, selecionado!);
        if (versao !== ciclo.current) return;
        adicionar(locais);
        let dados = await api(`/${selecionado}/mensagens`), lista: MensagemDireta[] = dados.mensagens;
        const ultimo = locais.at(-1)?.id || 0;
        for (let n = 0; ultimo && dados.temAnteriores && lista[0]?.id > ultimo && n < 10; n++) {
          dados = await api(`/${selecionado}/mensagens?antesId=${lista[0].id}`); lista = [...dados.mensagens, ...lista];
        }
        if (versao !== ciclo.current) return;
        adicionar(lista); setAnteriores(dados.temAnteriores); setErro('');
        if (lista.length) await api(`/${selecionado}/ler`, { ateId: lista.at(-1)!.id });
        contatos();
      } catch (e) { if (versao === ciclo.current) setErro((e as Error).message); }
      finally { ocupado = false; }
    }
    carregar(); const timer = setInterval(carregar, 10000);
    const app = AppState.addEventListener('change', s => { if (s === 'active') carregar(); });
    const off = observarDiretas(m => {
      const colega = m.remetenteMotoristaId === eu ? m.destinatarioMotoristaId : m.remetenteMotoristaId;
      if (colega === selecionado) { adicionar([m]); if (m.destinatarioMotoristaId === eu && AppState.currentState === 'active') api(`/${selecionado}/ler`, { ateId: m.id }).catch(() => {}); }
      contatos();
    });
    return () => { ciclo.current = versao + 1; clearInterval(timer); app.remove(); off(); abrirColega(null); gravador.current?.cancelar(); gravador.current = null; setGravando(false); setAudio(null); };
  }, [eu, selecionado, adicionar, contatos]);
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => { const ms = Date.now() - (gravador.current?.inicio || Date.now()); setTempo(ms); if (ms >= DURACAO_MAXIMA_MS) parar(); }, 250);
    return () => clearInterval(t);
  }, [gravando]);
  async function gravar() {
    const versao = ciclo.current;
    try { const g = await iniciarGravacao(); if (ciclo.current !== versao) { await g.cancelar(); return; } gravador.current = g; setTempo(0); setGravando(true); setErro(''); }
    catch (e) { setErro((e as Error).message); }
  }
  async function parar(): Promise<AudioPendente | null> {
    const g = gravador.current; if (!g) return null; gravador.current = null; setGravando(false);
    try { const a = { ...await g.parar(), clienteId: uuid() }; setAudio(a); return a; }
    catch (e) { setErro((e as Error).message); return null; }
  }
  async function enviar() {
    if (!selecionado || trava.current) return;
    trava.current = true; setEnviando(true);
    try {
      let a: AudioPendente | null = gravador.current ? await parar() : audio;
      let dados;
      if (a) {
        if (!a.audioId) { a = { ...a, audioId: await enviarGravacao(a, selecionado) }; setAudio(a); }
        dados = { audioId: a.audioId, clienteId: a.clienteId };
      } else {
        if (!texto.trim()) return;
        if (pendente.current?.texto !== texto.trim()) pendente.current = { texto: texto.trim(), id: uuid() };
        dados = { texto: pendente.current.texto, clienteId: pendente.current.id };
      }
      adicionar([await api(`/${selecionado}/mensagens`, dados)]); setTexto(''); setAudio(null); pendente.current = null; setErro('');
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    } catch (e) { setErro(`${(e as Error).message} O envio foi preservado.`); }
    finally { trava.current = false; setEnviando(false); }
  }
  const colega = colegas.find(c => c.id === selecionado);
  const filtrados = colegas.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()));
  const lista = comunicacao
    ? [...filtrados].sort((a, b) => (Date.parse(ultimaDe(b)?.em || '') || 0) - (Date.parse(ultimaDe(a)?.em || '') || 0) || b.naoLidas - a.naoLidas || a.nome.localeCompare(b.nome))
    : filtrados;
  if (!selecionado) return <View style={[s.root, embutido && s.embutido]}>
    <View style={s.barraBusca}>
      <TextInput style={[s.search, { flex: 1 }]} placeholderTextColor="#475569" accessibilityLabel={comunicacao ? 'Buscar contato' : 'Buscar colega'} placeholder={comunicacao ? 'Buscar contato…' : 'Buscar motorista…'} value={busca} onChangeText={setBusca} />
      {comunicacao && <Pressable accessibilityRole="button" accessibilityLabel="Adicionar contato" onPress={() => setAdicionando(a => !a)} style={s.adicionar}><Ionicons name={adicionando ? 'close' : 'person-add-outline'} size={22} color="#fff" /></Pressable>}
    </View>
    {comunicacao && adicionando && <View style={s.formContato}>
      <Text style={s.small}>Peça ao contato o telefone e o apelido (ou placa) que ele usa para entrar no app.</Text>
      <TextInput style={s.campo} placeholderTextColor="#475569" placeholder="Telefone" keyboardType="phone-pad" value={novoTelefone} onChangeText={setNovoTelefone} accessibilityLabel="Telefone do contato" />
      <TextInput style={s.campo} placeholderTextColor="#475569" placeholder="Apelido ou placa" autoCapitalize="characters" value={novoApelido} onChangeText={setNovoApelido} accessibilityLabel="Apelido ou placa do contato" />
      <Pressable accessibilityRole="button" disabled={enviando || !novoTelefone.trim() || !novoApelido.trim()} onPress={adicionarContato} style={[s.botaoAdicionar, (enviando || !novoTelefone.trim() || !novoApelido.trim()) && { opacity: 0.5 }]}><Text style={s.textoBotao}>{enviando ? 'Adicionando…' : 'Adicionar contato'}</Text></Pressable>
    </View>}
    {!!aviso && <Text accessibilityLiveRegion="polite" style={s.aviso}>{aviso}</Text>}
    <ScrollView keyboardShouldPersistTaps="handled">{lista.map(c => {
      const ultima = comunicacao ? ultimaDe(c) : null;
      return <Pressable key={c.id} style={[s.contact, embutido && s.contactEmbutido]} onPress={() => setSelecionado(c.id)} onLongPress={comunicacao ? () => removerContato(c) : undefined} delayLongPress={600}>
        <View style={s.avatar}><Ionicons name="person-outline" size={22} color="#047857" /></View>
        <View style={{ flex: 1 }}>
          <View style={s.linhaNome}><Text style={[s.name, { flex: 1 }]} numberOfLines={1}>{c.nome}</Text>{ultima && <Text style={[s.hora, c.naoLidas > 0 && { color: '#047857', fontWeight: '700' }]}>{horaPrevia(ultima.em)}</Text>}</View>
          <View style={s.linhaNome}>
            <Text style={[s.small, { flex: 1 }, ultima && c.naoLidas > 0 && { color: '#0f172a', fontWeight: '600' }]} numberOfLines={1}>{ultima ? ultima.texto : situacao(c)}</Text>
            {c.naoLidas > 0 && <Text style={s.unread}>{c.naoLidas}</Text>}
          </View>
          {ultima && <Text style={s.situacaoLista} numberOfLines={1}>{situacao(c)}</Text>}
        </View>
      </Pressable>;
    })}{!colegas.length && <Text style={s.empty}>{comunicacao ? 'Nenhum contato ainda. Toque em + para adicionar pelo telefone e apelido.' : 'Os motoristas da sua agência aparecerão aqui.'}</Text>}{comunicacao && colegas.length > 0 && <Text style={s.dica}>Segure um contato para removê-lo.</Text>}</ScrollView>
    {!!erro && <Text style={s.error}>{erro}</Text>}
  </View>;
  return <View style={[s.root, embutido && s.embutido]}>
    <View style={s.header}><Pressable accessibilityLabel={comunicacao ? 'Voltar aos contatos' : 'Voltar aos motoristas'} disabled={enviando} onPress={() => setSelecionado(null)}><Ionicons name="arrow-back" size={24} color="#334155" /></Pressable><Text style={[s.name, { flex: 1 }]}>{colega?.nome || 'Motorista'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Enviar alerta" disabled={enviando || !podeAlertar(colega)} onPress={() => enviarAlerta(selecionado)} style={[s.alertBtn, !podeAlertar(colega) && { opacity: 0.4 }]}><IconeAlerta tamanho={20} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Bipar para chamar no rádio" disabled={enviando || !podeBipar(colega)} onPress={() => chamar('Motorista', selecionado)} style={[s.beep, !podeBipar(colega) && { opacity: 0.4 }]}><Ionicons name="radio-outline" size={20} color="#047857" /><Text style={s.beepText}>Bipar</Text></Pressable>
    </View>
    {colega && <Text style={s.situacao}>{situacao(colega)}</Text>}
    {!!aviso && <Text accessibilityLiveRegion="polite" style={s.aviso}>{aviso}</Text>}
    <ScrollView ref={scroll} contentContainerStyle={s.messages} keyboardShouldPersistTaps="handled">
      {anteriores && <Pressable onPress={async () => { try { const d = await api(`/${selecionado}/mensagens?antesId=${mensagens[0]?.id}`); adicionar(d.mensagens); setAnteriores(d.temAnteriores); } catch (e) { setErro((e as Error).message); } }}><Text style={s.older}>Carregar anteriores</Text></Pressable>}
      {!mensagens.length && <Text style={s.empty}>Envie uma mensagem ou um áudio para iniciar a conversa.</Text>}
      {mensagens.map(m => <View key={m.id} style={[s.bubble, m.remetenteMotoristaId === eu ? s.sent : s.received]}>
        {m.audioId ? <PlayerAudio audioId={m.audioId} duracaoMs={m.duracaoAudioMs} /> : <Text style={s.text}>{m.texto}</Text>}
        <Text style={s.time}>{new Date(m.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{m.remetenteMotoristaId === eu ? m.lidaEm ? ' · Lida' : ' · Enviada' : ''}</Text>
      </View>)}
    </ScrollView>
    {!!erro && <Text accessibilityRole="alert" style={s.error}>{erro}</Text>}
    <View style={s.composer}>
      {gravando || audio ? <><Text style={[s.text, { flex: 1 }]}>{gravando ? `Gravando ${formatarDuracao(tempo)}` : `Áudio · ${formatarDuracao(audio?.duracaoMs)}`}</Text><Pressable disabled={enviando} accessibilityLabel="Descartar áudio" onPress={() => { gravador.current?.cancelar(); gravador.current = null; setGravando(false); setAudio(null); }}><Ionicons name="trash-outline" color="#b91c1c" size={22} /></Pressable></> : <TextInput value={texto} onChangeText={setTexto} style={s.input} placeholderTextColor="#475569" editable={!enviando} placeholder="Mensagem…" accessibilityLabel="Mensagem para o motorista" maxLength={2000} multiline />}
      <Pressable disabled={enviando} onPress={gravando || audio || texto.trim() ? enviar : gravar} accessibilityLabel={gravando || audio || texto.trim() ? 'Enviar mensagem' : 'Gravar áudio'} style={s.send}><Ionicons name={gravando || audio || texto.trim() ? 'arrow-up' : 'mic'} size={24} color="#fff" /></Pressable>
    </View>
  </View>;
}
const s = StyleSheet.create({ root: { flex: 1 }, search: { margin: 12, padding: 14, backgroundColor: '#cbd5e1', borderRadius: 16, color: '#0f172a', fontSize: 15 }, embutido: { backgroundColor: '#f1f5f9' }, contactEmbutido: { backgroundColor: '#fff', marginHorizontal: 10, marginBottom: 6, borderRadius: 16 }, linhaNome: { flexDirection: 'row', alignItems: 'center', gap: 8 }, hora: { fontSize: 11, color: '#64748b' }, situacaoLista: { fontSize: 11, color: '#94a3b8', marginTop: 2 }, contact: { flexDirection: 'row', padding: 16, gap: 12, alignItems: 'center' }, avatar: { backgroundColor: '#d1fae5', padding: 12, borderRadius: 18 }, name: { fontSize: 15, fontWeight: '700', color: '#0f172a' }, small: { fontSize: 12, color: '#64748b', marginTop: 3 }, unread: { backgroundColor: '#047857', color: '#fff', padding: 6, borderRadius: 10 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, backgroundColor: '#fff' }, beep: { flexDirection: 'row', padding: 10, gap: 5, backgroundColor: '#d1fae5', borderRadius: 14 }, beepText: { color: '#047857', fontWeight: '700' }, alertBtn: { paddingVertical: 10, paddingHorizontal: 8, backgroundColor: '#fee2e2', borderRadius: 14 }, barraBusca: { flexDirection: 'row', alignItems: 'center', paddingRight: 12 }, adicionar: { backgroundColor: '#047857', borderRadius: 14, padding: 12 }, formContato: { marginHorizontal: 12, marginBottom: 8, padding: 12, gap: 8, backgroundColor: '#fff', borderRadius: 16 }, campo: { backgroundColor: '#cbd5e1', borderRadius: 12, padding: 12, color: '#0f172a', fontSize: 15 }, botaoAdicionar: { backgroundColor: '#047857', borderRadius: 12, padding: 12, alignItems: 'center' }, textoBotao: { color: '#fff', fontWeight: '700' }, dica: { color: '#94a3b8', fontSize: 11, textAlign: 'center', padding: 10 }, situacao: { fontSize: 12, color: '#64748b', paddingHorizontal: 16, paddingBottom: 6, backgroundColor: '#fff' }, aviso: { color: '#047857', fontSize: 12, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#ecfdf5' }, messages: { padding: 16, gap: 10 }, bubble: { padding: 12, borderRadius: 18, maxWidth: '90%' }, sent: { alignSelf: 'flex-end', backgroundColor: '#d1fae5' }, received: { alignSelf: 'flex-start', backgroundColor: '#fff' }, text: { color: '#0f172a', fontSize: 15 }, time: { color: '#64748b', fontSize: 10, textAlign: 'right', marginTop: 6 }, empty: { color: '#64748b', padding: 30, textAlign: 'center' }, error: { color: '#b91c1c', padding: 12, fontSize: 12 }, older: { color: '#047857', textAlign: 'center', padding: 10 }, composer: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff' }, input: { flex: 1, backgroundColor: '#e2e8f0', maxHeight: 100, padding: 12, borderRadius: 18, color: '#0f172a' }, send: { backgroundColor: '#047857', borderRadius: 24, padding: 12 } });
