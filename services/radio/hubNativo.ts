import { DeviceEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';

// No Android, o rádio vive no serviço nativo (RadioNucleo) e funciona com o app aberto, em segundo plano ou
// fechado. A tela usa a mesma conexão por esta ponte, com a mesma forma do HubConnection do SignalR.
type Ponte = {
  hubConectar(token: string, apiBase: string): Promise<string>;
  hubDesconectar(): Promise<void>;
  hubInvocar(alvo: string, argumentosJson: string): Promise<string | null>;
  hubEnviar(alvo: string, argumentosJson: string): void;
};
type EventoHub = { tipo: 'conectado' | 'evento' | 'reconectando'; alvo?: string; argumentos?: string; connectionId?: string };

const ponte = NativeModules.RadioVoz as Partial<Ponte> | undefined;
export const radioNativoDisponivel = Platform.OS === 'android' && typeof ponte?.hubConectar === 'function';

export function criarHubNativo(apiBase: string, obterToken: () => Promise<string>) {
  const nativo = ponte as Ponte;
  const ouvintes = new Map<string, (...args: any[]) => void>();
  let aoReconectar: (() => void) | null = null, aoReconectado: (() => void) | null = null;
  let inscricao: EmitterSubscription | null = null;
  let caiu = false;
  const hub = {
    connectionId: null as string | null,
    on(nome: string, fn: (...args: any[]) => void) { ouvintes.set(nome, fn); },
    onreconnecting(fn: () => void) { aoReconectar = fn; },
    onreconnected(fn: () => void) { aoReconectado = fn; },
    // O rádio nativo religa sozinho; a tela só acompanha (reconectando → conectado).
    onclose(_fn: () => void) { /* sem uso */ },
    async start() {
      inscricao ??= DeviceEventEmitter.addListener('RadioHub', (e: EventoHub) => {
        if (e.tipo === 'evento' && e.alvo) {
          let argumentos: unknown[] = [];
          try { argumentos = JSON.parse(e.argumentos || '[]'); } catch { /* evento ilegível */ }
          ouvintes.get(e.alvo)?.(...argumentos);
        } else if (e.tipo === 'reconectando') {
          hub.connectionId = null; caiu = true; aoReconectar?.();
        } else if (e.tipo === 'conectado' && e.connectionId) {
          const voltou = caiu || (hub.connectionId !== null && hub.connectionId !== e.connectionId);
          hub.connectionId = e.connectionId; caiu = false;
          if (voltou) aoReconectado?.();
        }
      });
      hub.connectionId = await nativo.hubConectar(await obterToken(), apiBase);
    },
    // A tela sai, mas o rádio nativo continua ligado para funcionar com o app fechado.
    async stop() {
      inscricao?.remove(); inscricao = null;
      await nativo.hubDesconectar().catch(() => {});
    },
    async invoke(alvo: string, ...argumentos: unknown[]) {
      const resultado = await nativo.hubInvocar(alvo, JSON.stringify(argumentos));
      return resultado == null ? null : JSON.parse(resultado);
    },
    send(alvo: string, ...argumentos: unknown[]) {
      nativo.hubEnviar(alvo, JSON.stringify(argumentos));
      return Promise.resolve();
    },
  };
  return hub;
}
