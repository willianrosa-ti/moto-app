export type Pessoa = { perfil: string; id: number; agenciaId: number; nome: string; chave: string };
export type Chamada = { id: string; origem: Pessoa; destino: Pessoa; status: string; falante: string | null; falaAte: string | null; expiraEm: string; versao: number; alertas?: number; servidor?: boolean; direto?: boolean };
export type AlertaAvulso = { id: string; de: Pessoa; em: string };
export type EstadoRadio = { chamada: Chamada | null; eu: Pessoa | null; conectado: boolean; preparando: boolean; erro: string };
export type PedacoVoz = { fala: number; codec: 'opus' | 'pcmu'; dados: string };
export type ModoMicrofone = 'parado' | 'pronto' | 'enviando';
export type MidiaRadio = {
  abrir(): Promise<void>;
  microfone(modo: ModoMicrofone, aoPedaco: (p: PedacoVoz) => void): Promise<PedacoVoz | null>;
  tocar(p: PedacoVoz & { id: string; seq: number }): void;
  fimFala(): void;
  clear(): void;
};
export class RadioClient {
  constructor(options: { hub: any; config: () => Promise<any>; media: MidiaRadio; update: (state: EstadoRadio) => void; invite?: (c: Chamada) => void;
    autoAtender?: (c: Chamada) => boolean; bipe?: (tipo: 'falar' | 'ouvir') => number; aoAlertar?: (c: Chamada) => void; aoAlertaAvulso?: (a: AlertaAvulso) => void });
  state: EstadoRadio;
  start(): Promise<void>; sincronizar(): Promise<void>; call(perfil: string, id: number): Promise<void>; accept(automatico?: boolean): Promise<void>; atenderPendente(): void; alertar(): Promise<void>; alertarAvulso(perfil: string, id: number): Promise<string>; end(message?: string): Promise<void>;
  press(): Promise<void>; release(): Promise<void>; dispose(): Promise<void>; emit(patch: Partial<EstadoRadio>): void;
}
export function uuid(): string;
