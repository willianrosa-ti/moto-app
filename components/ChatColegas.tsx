import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { motoristaFetch } from '../services/motoristaApi';
import { abrirColega, guardarDiretas, juntarDiretas, lerDiretas, observarDiretas, type MensagemDireta } from '../services/chatDireto';
import { DURACAO_MAXIMA_MS, enviarGravacao, formatarDuracao, iniciarGravacao, obterUriAudio, type Gravacao, type GravacaoAtiva } from '../services/audioMotorista';
import { uuid } from '../services/radio/RadioClient';
import { useRadio } from './RadioProvider';
import PlayerAudio from './PlayerAudio';

// radio: "radio" (pode bipar), "alerta" (só alerta), "ocupado" ou "nenhum".
type Colega = { id: number; nome: string; online: boolean; naoLidas: number; radio?: string };
const disponibilidade = (c?: Colega) => c?.radio || (c?.online ? 'radio' : 'nenhum');
function situacao(c: Colega) {
  const r = disponibilidade(c);
  if (r === 'ocupado') return 'Ocupado · pode deixar mensagem';
  if (c.online) return 'Online';
  return r === 'radio' ? 'Offline · recebe rádio' : r === 'alerta' ? 'Offline · recebe alerta' : 'Offline · pode deixar mensagem';
}
type AudioPendente = Gravacao & { clienteId: string; audioId?: string };
async function api(path: string, body?: object) {
  const r = await motoristaFetch(`/api/ChatDireto${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!r.ok) { const erro = await r.json().catch(() => ({})); throw new Error(erro.mensagem || 'Não foi possível acessar a conversa. Tente novamente.'); }
  return r.status === 204 ? null : r.json();
}
export default function ChatColegas({ inicial }: { inicial?: number }) {
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
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(''), 2500); return () => clearTimeout(t); }, [aviso]);
  const enviarAlerta = (id: number) => alertar('Motorista', id).then(m => { setErro(''); setAviso(m || 'Alerta enviado.'); }).catch(e => setErro((e as Error).message));
  useEffect(() => { AsyncStorage.getItem('idMotorista').then(id => setEu(Number(id))); }, []);
  useEffect(() => { if (inicial) setSelecionado(inicial); }, [inicial]);
  const contatos = useCallback(() => api('/colegas').then(setColegas).catch(e => setErro(e.message)), []);
  useEffect(() => { contatos(); const t = setInterval(contatos, 15000); return () => clearInterval(t); }, [contatos]);
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
  if (!selecionado) return <View style={s.root}>
    <TextInput style={s.search} accessibilityLabel="Buscar colega" placeholder="Buscar motorista…" value={busca} onChangeText={setBusca} />
    <ScrollView>{colegas.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase())).map(c => <Pressable key={c.id} style={s.contact} onPress={() => setSelecionado(c.id)}>
      <View style={s.avatar}><Ionicons name="person-outline" size={22} color="#047857" /></View><View style={{ flex: 1 }}><Text style={s.name}>{c.nome}</Text><Text style={s.small}>{situacao(c)}</Text></View>{c.naoLidas > 0 && <Text style={s.unread}>{c.naoLidas}</Text>}
    </Pressable>)}{!colegas.length && <Text style={s.empty}>Os motoristas da sua agência aparecerão aqui.</Text>}</ScrollView>
    {!!erro && <Text style={s.error}>{erro}</Text>}
  </View>;
  return <View style={s.root}>
    <View style={s.header}><Pressable accessibilityLabel="Voltar aos motoristas" disabled={enviando} onPress={() => setSelecionado(null)}><Ionicons name="arrow-back" size={24} color="#334155" /></Pressable><Text style={[s.name, { flex: 1 }]}>{colega?.nome || 'Motorista'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Enviar alerta" disabled={enviando || !['radio', 'alerta'].includes(disponibilidade(colega))} onPress={() => enviarAlerta(selecionado)} style={[s.alertBtn, !['radio', 'alerta'].includes(disponibilidade(colega)) && { opacity: 0.4 }]}><Ionicons name="notifications-outline" size={20} color="#b45309" /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Bipar para chamar no rádio" disabled={enviando || disponibilidade(colega) !== 'radio'} onPress={() => chamar('Motorista', selecionado)} style={[s.beep, disponibilidade(colega) !== 'radio' && { opacity: 0.4 }]}><Ionicons name="radio-outline" size={20} color="#047857" /><Text style={s.beepText}>Bipar</Text></Pressable>
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
      {gravando || audio ? <><Text style={[s.text, { flex: 1 }]}>{gravando ? `Gravando ${formatarDuracao(tempo)}` : `Áudio · ${formatarDuracao(audio?.duracaoMs)}`}</Text><Pressable disabled={enviando} accessibilityLabel="Descartar áudio" onPress={() => { gravador.current?.cancelar(); gravador.current = null; setGravando(false); setAudio(null); }}><Ionicons name="trash-outline" color="#b91c1c" size={22} /></Pressable></> : <TextInput value={texto} onChangeText={setTexto} style={s.input} editable={!enviando} placeholder="Mensagem…" accessibilityLabel="Mensagem para o motorista" maxLength={2000} multiline />}
      <Pressable disabled={enviando} onPress={gravando || audio || texto.trim() ? enviar : gravar} accessibilityLabel={gravando || audio || texto.trim() ? 'Enviar mensagem' : 'Gravar áudio'} style={s.send}><Ionicons name={gravando || audio || texto.trim() ? 'arrow-up' : 'mic'} size={24} color="#fff" /></Pressable>
    </View>
  </View>;
}
const s = StyleSheet.create({ root: { flex: 1 }, search: { margin: 12, padding: 14, backgroundColor: '#e2e8f0', borderRadius: 16, color: '#0f172a' }, contact: { flexDirection: 'row', padding: 16, gap: 12, alignItems: 'center' }, avatar: { backgroundColor: '#d1fae5', padding: 12, borderRadius: 18 }, name: { fontSize: 15, fontWeight: '700', color: '#0f172a' }, small: { fontSize: 12, color: '#64748b', marginTop: 3 }, unread: { backgroundColor: '#047857', color: '#fff', padding: 6, borderRadius: 10 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, backgroundColor: '#fff' }, beep: { flexDirection: 'row', padding: 10, gap: 5, backgroundColor: '#d1fae5', borderRadius: 14 }, beepText: { color: '#047857', fontWeight: '700' }, alertBtn: { padding: 10, backgroundColor: '#fef3c7', borderRadius: 14 }, situacao: { fontSize: 12, color: '#64748b', paddingHorizontal: 16, paddingBottom: 6, backgroundColor: '#fff' }, aviso: { color: '#047857', fontSize: 12, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#ecfdf5' }, messages: { padding: 16, gap: 10 }, bubble: { padding: 12, borderRadius: 18, maxWidth: '90%' }, sent: { alignSelf: 'flex-end', backgroundColor: '#d1fae5' }, received: { alignSelf: 'flex-start', backgroundColor: '#fff' }, text: { color: '#0f172a', fontSize: 15 }, time: { color: '#64748b', fontSize: 10, textAlign: 'right', marginTop: 6 }, empty: { color: '#64748b', padding: 30, textAlign: 'center' }, error: { color: '#b91c1c', padding: 12, fontSize: 12 }, older: { color: '#047857', textAlign: 'center', padding: 10 }, composer: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff' }, input: { flex: 1, backgroundColor: '#f1f5f9', maxHeight: 100, padding: 12, borderRadius: 18, color: '#0f172a' }, send: { backgroundColor: '#047857', borderRadius: 24, padding: 12 } });
