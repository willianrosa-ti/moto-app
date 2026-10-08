import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { reservarMicrofone } from './radio/audioFocus';
import { API_BASE, motoristaFetch, obterTokenMotorista, renovarSessao } from './motoristaApi';

// Áudios de chat e de corrida ficam guardados no celular: o servidor só os mantém até a entrega.
export const DURACAO_MAXIMA_MS = 120_000;
export type Gravacao = { duracaoMs: number; tipo: string; uri?: string; blob?: Blob };
export type GravacaoAtiva = { inicio: number; parar: () => Promise<Gravacao>; cancelar: () => Promise<void> };

export function formatarDuracao(ms?: number | null) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const OPCOES_GRAVACAO: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: { extension: '.m4a', outputFormat: Audio.AndroidOutputFormat.MPEG_4, audioEncoder: Audio.AndroidAudioEncoder.AAC, sampleRate: 44100, numberOfChannels: 1, bitRate: 64000 },
  ios: { extension: '.m4a', outputFormat: Audio.IOSOutputFormat.MPEG4AAC, audioQuality: Audio.IOSAudioQuality.MEDIUM, sampleRate: 44100, numberOfChannels: 1, bitRate: 64000 },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
};
// No iPhone (PWA) o Safari grava MP4/AAC, que toca em todos os aparelhos.
const FORMATOS_WEB = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

export async function iniciarGravacao(): Promise<GravacaoAtiva> {
  const liberar = reservarMicrofone('gravacao');
  try {
    const gravador = await iniciarGravacaoLivre();
    return { inicio: gravador.inicio, parar: async () => { try { return await gravador.parar(); } finally { liberar(); } }, cancelar: async () => { try { await gravador.cancelar(); } finally { liberar(); } } };
  } catch (e) { liberar(); throw e; }
}
async function iniciarGravacaoLivre(): Promise<GravacaoAtiva> {
  if (Platform.OS === 'web') return iniciarGravacaoWeb();
  const permissao = await Audio.requestPermissionsAsync();
  if (!permissao.granted) throw new Error('Permita o uso do microfone para gravar o áudio.');
  const { recording } = await Audio.Recording.createAsync(OPCOES_GRAVACAO);
  const inicio = Date.now();
  return {
    inicio,
    parar: async () => {
      const status = await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error('A gravação falhou. Tente de novo.');
      return { uri, tipo: 'audio/mp4', duracaoMs: Math.min(status.durationMillis || Date.now() - inicio, DURACAO_MAXIMA_MS) };
    },
    cancelar: async () => {
      try { await recording.stopAndUnloadAsync(); } catch { /* já parada */ }
      const uri = recording.getURI();
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    },
  };
}

async function iniciarGravacaoWeb(): Promise<GravacaoAtiva> {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('Este aparelho não permite gravar áudio.');
  let fluxo: MediaStream;
  try { fluxo = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { throw new Error('Permita o uso do microfone para gravar o áudio.'); }
  const tipo = FORMATOS_WEB.find(f => MediaRecorder.isTypeSupported(f));
  const gravador = new MediaRecorder(fluxo, tipo ? { mimeType: tipo, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 });
  const partes: Blob[] = [];
  const inicio = Date.now();
  gravador.ondataavailable = e => { if (e.data?.size) partes.push(e.data); };
  gravador.start(250);
  const liberar = () => fluxo.getTracks().forEach(t => t.stop());
  return {
    inicio,
    parar: () => new Promise((resolve, reject) => {
      gravador.onstop = () => {
        liberar();
        const blob = new Blob(partes, { type: (gravador.mimeType || tipo || 'audio/webm').split(';')[0] });
        if (!blob.size) reject(new Error('A gravação ficou vazia. Tente de novo.'));
        else resolve({ blob, tipo: blob.type, duracaoMs: Math.min(Date.now() - inicio, DURACAO_MAXIMA_MS) });
      };
      if (gravador.state === 'inactive') liberar(); else gravador.stop();
    }),
    cancelar: async () => { gravador.onstop = liberar; if (gravador.state !== 'inactive') gravador.stop(); else liberar(); },
  };
}

// Envia a gravação e já guarda a cópia no celular. Devolve o id do áudio no servidor.
export async function enviarGravacao(gravacao: Gravacao, colegaId?: number): Promise<string> {
  const formulario = new FormData();
  const extensao = gravacao.tipo.includes('webm') ? 'webm' : 'm4a';
  if (gravacao.blob) formulario.append('arquivo', gravacao.blob, `audio.${extensao}`);
  else formulario.append('arquivo', { uri: gravacao.uri, name: `audio.${extensao}`, type: gravacao.tipo } as any);
  formulario.append('duracaoMs', String(Math.round(gravacao.duracaoMs)));
  if (colegaId) formulario.append('colegaId', String(colegaId));
  const resposta = await motoristaFetch('/api/Audios', { method: 'POST', body: formulario });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.mensagem || 'Não foi possível enviar o áudio.');
  await guardarGravacao(dados.id, gravacao).catch(() => {});
  return dados.id;
}

// ---------- Armazenamento no aparelho ----------
const PASTA = `${FileSystem.documentDirectory}audios/`;
const EXTENSOES = ['m4a', 'webm', 'ogg', 'mp3', 'aac'];
const extensaoDoTipo = (tipo?: string | null) => /webm/.test(tipo || '') ? 'webm' : /ogg/.test(tipo || '') ? 'ogg' : /mpeg/.test(tipo || '') ? 'mp3' : /aac/.test(tipo || '') ? 'aac' : 'm4a';

async function arquivoLocal(id: string) {
  for (const ext of EXTENSOES) {
    const uri = `${PASTA}${id}.${ext}`;
    if ((await FileSystem.getInfoAsync(uri)).exists) return uri;
  }
  return null;
}

async function guardarGravacao(id: string, gravacao: Gravacao) {
  if (Platform.OS === 'web') { if (gravacao.blob) await salvarBlobWeb(id, gravacao.blob); return; }
  await FileSystem.makeDirectoryAsync(PASTA, { intermediates: true }).catch(() => {});
  await FileSystem.copyAsync({ from: gravacao.uri!, to: `${PASTA}${id}.${extensaoDoTipo(gravacao.tipo)}` });
}

async function baixarNativo(id: string) {
  await FileSystem.makeDirectoryAsync(PASTA, { intermediates: true }).catch(() => {});
  const temporario = `${PASTA}${id}.baixando`;
  const baixar = async (token: string | null) => FileSystem.downloadAsync(`${API_BASE}/api/Audios/${id}`, temporario, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let resultado = await baixar(await obterTokenMotorista());
  if (resultado.status === 401) resultado = await baixar(await renovarSessao());
  if (resultado.status !== 200) {
    await FileSystem.deleteAsync(temporario, { idempotent: true }).catch(() => {});
    throw new Error('Áudio indisponível neste aparelho.');
  }
  const tipo = resultado.headers['Content-Type'] || resultado.headers['content-type'];
  const destino = `${PASTA}${id}.${extensaoDoTipo(tipo)}`;
  await FileSystem.moveAsync({ from: temporario, to: destino });
  return destino;
}

const emAndamento = new Map<string, Promise<string>>();
// Endereço local do áudio para tocar; baixa e guarda no celular na primeira vez.
export function obterUriAudio(id: string): Promise<string> {
  if (!emAndamento.has(id)) {
    const promessa = Platform.OS === 'web' ? obterUrlWeb(id) : arquivoLocal(id).then(local => local || baixarNativo(id));
    emAndamento.set(id, promessa);
    promessa.catch(() => emAndamento.delete(id));
  }
  return emAndamento.get(id)!;
}

// ---------- Web (iPhone/PWA): IndexedDB ----------
let bancoWeb: Promise<IDBDatabase | null> | null = null;
function abrirBancoWeb() {
  bancoWeb ??= new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const pedido = indexedDB.open('millin-motorista', 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore('audios');
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => resolve(null);
  });
  return bancoWeb;
}

async function salvarBlobWeb(id: string, blob: Blob) {
  const db = await abrirBancoWeb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const transacao = db.transaction('audios', 'readwrite');
    transacao.objectStore('audios').put(blob, id);
    transacao.oncomplete = transacao.onerror = transacao.onabort = () => resolve();
  });
}

async function lerBlobWeb(id: string): Promise<Blob | null> {
  const db = await abrirBancoWeb();
  if (!db) return null;
  return new Promise(resolve => {
    const pedido = db.transaction('audios').objectStore('audios').get(id);
    pedido.onsuccess = () => resolve(pedido.result instanceof Blob ? pedido.result : null);
    pedido.onerror = () => resolve(null);
  });
}

async function obterUrlWeb(id: string) {
  let blob = await lerBlobWeb(id);
  if (!blob) {
    const resposta = await motoristaFetch(`/api/Audios/${id}`);
    if (!resposta.ok) throw new Error('Áudio indisponível neste aparelho.');
    blob = await resposta.blob();
    await salvarBlobWeb(id, blob);
  }
  return URL.createObjectURL(blob);
}
