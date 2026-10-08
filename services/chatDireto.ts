import AsyncStorage from '@react-native-async-storage/async-storage';
export type MensagemDireta = { id: number; remetenteMotoristaId: number; destinatarioMotoristaId: number; texto: string; clienteId: string; criadoEm: string; lidaEm?: string | null; audioId?: string; duracaoAudioMs?: number };
const ouvintes = new Set<(m: MensagemDireta) => void>();
let aberto: number | null = null;
const escritas = new Map<string, Promise<unknown>>();
export const colegaAberto = () => aberto;
export function abrirColega(id: number | null) { aberto = id; }
export function observarDiretas(fn: (m: MensagemDireta) => void) { ouvintes.add(fn); return () => { ouvintes.delete(fn); }; }
export function emitirDireta(m: MensagemDireta) { ouvintes.forEach(fn => fn(m)); }
const chave = (eu: number, colega: number) => `chatDireto:${eu}:${colega}`;
export function juntarDiretas(a: MensagemDireta[], b: MensagemDireta[]) {
  const mapa = new Map(a.map(m => [m.id, m]));
  b.forEach(m => mapa.set(m.id, { ...mapa.get(m.id), ...m, lidaEm: m.lidaEm || mapa.get(m.id)?.lidaEm }));
  return [...mapa.values()].sort((a, b) => a.id - b.id);
}
export async function lerDiretas(eu: number, colega: number): Promise<MensagemDireta[]> {
  try { const dados = JSON.parse(await AsyncStorage.getItem(chave(eu, colega)) || '[]'); return Array.isArray(dados) ? dados : []; } catch { return []; }
}
export function guardarDiretas(eu: number, colega: number, lista: MensagemDireta[]) {
  const key = chave(eu, colega);
  const next = (escritas.get(key) || Promise.resolve()).then(async () => { await AsyncStorage.setItem(key, JSON.stringify(juntarDiretas(await lerDiretas(eu, colega), lista).slice(-500))); });
  escritas.set(key, next.catch(() => {}));
  return next;
}
