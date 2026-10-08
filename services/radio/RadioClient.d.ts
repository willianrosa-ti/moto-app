export type Pessoa = { perfil: string; id: number; agenciaId: number; nome: string; chave: string };
export type Chamada = { id: string; origem: Pessoa; destino: Pessoa; status: string; falante: string | null; falaAte: string | null; expiraEm: string; versao: number };
export type EstadoRadio = { chamada: Chamada | null; eu: Pessoa | null; conectado: boolean; preparando: boolean; erro: string };
export class RadioClient {
  constructor(options: { hub: any; config: (voz?: boolean) => Promise<any>; media: any; update: (state: EstadoRadio) => void; invite?: (c: Chamada) => void;
    autoAtender?: () => boolean; bipe?: (tipo: 'falar' | 'ouvir') => number });
  state: EstadoRadio;
  start(): Promise<void>; call(perfil: string, id: number): Promise<void>; accept(automatico?: boolean): Promise<void>; atenderPendente(): void; end(message?: string): Promise<void>;
  press(): Promise<void>; release(): Promise<void>; dispose(): Promise<void>; emit(patch: Partial<EstadoRadio>): void;
}
export function uuid(): string;
