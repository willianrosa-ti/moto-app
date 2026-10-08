import AsyncStorage from '@react-native-async-storage/async-storage';

export type MensagemChat = { id: number; motoristaId: number; remetente: string; texto: string; criadoEm: string; lidaEm?: string | null; clienteId: string; audioId?: string | null; duracaoAudioMs?: number | null };

// O histórico do chat fica no aparelho. O servidor guarda cada mensagem só até a entrega e a leitura.
export const LIMITE_MENSAGENS_LOCAIS = 500;
const chave = (motoristaId: string) => `chatMotorista:${motoristaId}`;

export function juntarMensagens(lista: MensagemChat[], novas: MensagemChat[]) {
  const porId = new Map(lista.map(m => [m.id, m]));
  for (const nova of novas) {
    const atual = porId.get(nova.id);
    porId.set(nova.id, atual ? { ...atual, ...nova, lidaEm: nova.lidaEm ?? atual.lidaEm } : nova);
  }
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

export async function lerHistoricoLocal(motoristaId: string): Promise<MensagemChat[]> {
  try {
    const bruto = await AsyncStorage.getItem(chave(motoristaId));
    const dados = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

export async function salvarHistoricoLocal(motoristaId: string, mensagens: MensagemChat[]) {
  try {
    await AsyncStorage.setItem(chave(motoristaId), JSON.stringify(mensagens.slice(-LIMITE_MENSAGENS_LOCAIS)));
  } catch { /* Sem espaço no aparelho: a conversa continua disponível enquanto o app estiver aberto. */ }
}
