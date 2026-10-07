import { motoristaFetch } from './motoristaApi';

export type AvisoMotorista = { id: number; texto: string; criadoEm: string; vistoEm?: string | null; nomeAgencia?: string | null };

// A conexão em tempo real do chat repassa os avisos recebidos para quem estiver observando.
const ouvintes = new Set<(aviso: AvisoMotorista) => void>();

export function emitirAvisoRecebido(aviso: AvisoMotorista) {
  ouvintes.forEach(ouvinte => ouvinte(aviso));
}

export function observarAvisos(ouvinte: (aviso: AvisoMotorista) => void) {
  ouvintes.add(ouvinte);
  return () => { ouvintes.delete(ouvinte); };
}

export async function buscarAvisos(): Promise<{ nomeAgencia: string; avisos: AvisoMotorista[] }> {
  const resposta = await motoristaFetch('/api/Avisos/meus');
  if (!resposta.ok) throw new Error('Não foi possível carregar os avisos.');
  const dados = await resposta.json();
  return { nomeAgencia: dados.nomeAgencia || 'Agência', avisos: Array.isArray(dados.avisos) ? dados.avisos : [] };
}

export async function marcarAvisoVisto(id: number) {
  const resposta = await motoristaFetch(`/api/Avisos/${id}/visto`, { method: 'POST' });
  if (!resposta.ok && resposta.status !== 404) throw new Error('Não foi possível confirmar a leitura do aviso.');
}
