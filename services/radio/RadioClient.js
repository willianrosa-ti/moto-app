// Protocolo compartilhado pelo app e painel; sem dependência de DOM ou React Native.
// Rádio pelo servidor (estilo Zello): a voz vai em pedaços de ~200 ms pela conexão já aberta com a API,
// que repassa na hora para o outro lado. Não há ligação para montar: chamar → o outro lado atende sozinho → canal ativo.
// media: abrir() prepara a saída de áudio (sem microfone); microfone(modo, aoPedaco) com modo 'parado' | 'pronto'
// (microfone aberto, sem enviar) | 'enviando' e, ao parar de enviar, devolve o último pedaço; tocar(pedaco); fimFala(); clear().
export class RadioClient {
  // autoAtender(chamada): quem é chamado conecta sozinho, como num rádio (sem aceitar).
  // bipe(tipo): toca o bipe do rádio ('falar' ao apertar, 'ouvir' quando o outro começa a falar);
  // ao apertar, devolve quantos ms o microfone espera para o bipe não ir junto com a voz.
  // aoAlertar(chamada): quem é chamado recebeu um alerta (entre motoristas; no terceiro, conecta).
  constructor({ hub, config, media, update, invite = () => {}, id = uuid, autoAtender = () => false, bipe = () => 0, aoAlertar = () => {} }) {
    Object.assign(this, { hub, config, media, update, invite, id, autoAtender, bipe, aoAlertar });
    this.state = { chamada: null, eu: null, conectado: false, preparando: false, erro: '' };
    this.closed = new Set(); this.held = false; this.disposed = false;
    this.modo = 'parado'; this.micFila = Promise.resolve(); this.geracao = 0; this.seq = 0;
    hub.on('RadioEstado', e => this.receive(e));
    hub.on('RadioVoz', v => this.ouvir(v));
    hub.onreconnecting(() => this.offline());
    hub.onreconnected(() => { this.emit({ conectado: true }); });
    hub.onclose(() => { this.offline(); if (!this.disposed) this.retry = setTimeout(() => this.start(), 4000); });
  }
  emit(patch = {}) { this.state = { ...this.state, ...patch }; if (!this.disposed) this.update(this.state); }
  async start() {
    if (this.disposed) return;
    try {
      const c = await this.config(); if (this.disposed) return;
      this.emit({ eu: c.eu });
      await this.hub.start();
      if (this.disposed) { await this.hub.stop(); return; }
      this.emit({ conectado: true });
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (this.state.conectado) this.hub.invoke('Batimento').catch(() => { this.offline(); this.hub.stop(); });
      }, 15000);
    } catch { if (!this.disposed) this.retry = setTimeout(() => this.start(), 5000); }
  }
  async call(perfil, id) {
    if (this.state.chamada || this.state.preparando) return;
    if (!this.state.conectado) { this.emit({ erro: 'Rádio sem conexão. Aguarde a reconexão.' }); return; }
    this.emit({ preparando: true, erro: '' });
    try { this.receive(await this.hub.invoke('ChamarServidor', perfil, id, this.id())); }
    catch (e) { await this.end(); this.emit({ erro: cleanError(e) }); }
    finally { this.emit({ preparando: false }); }
  }
  // Entre motoristas: quem chamou envia um alerta (até três) para quem não está no app.
  async alertar() {
    const c = this.state.chamada;
    if (!c || c.status !== 'Tocando' || c.origem.chave !== this.state.eu?.chave) return;
    try { this.receive(await this.hub.invoke('Alertar', c.id)); }
    catch (e) { this.emit({ erro: cleanError(e) }); }
  }
  async accept(automatico = false) {
    const c = this.state.chamada;
    if (!c || c.status !== 'Tocando' || c.destino.chave !== this.state.eu?.chave || this.atendendo === c.id) return;
    this.atendendo = c.id;
    try { this.receive(await this.hub.invoke('Acao', c.id, 'Atender')); }
    catch (e) {
      // Conexão automática que outro aparelho da mesma conta atendeu primeiro: só fecha aqui, sem aviso.
      if (automatico) { if (this.state.chamada?.id === c.id) { this.closed.add(c.id); this.cleanup(); this.emit({ chamada: null }); } return; }
      await this.end(); this.emit({ erro: cleanError(e) });
    }
  }
  // Ao voltar para o app com uma chamada aguardando, conecta direto.
  atenderPendente() {
    const c = this.state.chamada;
    if (c?.status === 'Tocando' && c.destino.chave === this.state.eu?.chave) this.accept(true);
  }
  tocarBipe(tipo) {
    try { return Math.max(0, Number(this.bipe(tipo)) || 0); } catch { return 0; }
  }
  receive(e) {
    if (this.disposed || this.closed.has(e.id) || !this.state.eu) return;
    const current = this.state.chamada;
    if (current && current.id === e.id && e.versao <= current.versao) return;
    const mine = e.origem.chave === this.state.eu.chave ? e.origemAparelho : e.destinoAparelho;
    if (mine && mine !== this.hub.connectionId) {
      if (current?.id === e.id) { this.cleanup(); this.emit({ chamada: null }); }
      return;
    }
    if (e.status === 'Encerrada') {
      this.closed.add(e.id); if (this.closed.size > 50) this.closed.delete(this.closed.values().next().value);
      if (current?.id === e.id) { this.cleanup(); this.emit({ chamada: null, erro: e.motivo || '' }); }
      return;
    }
    if (current && current.id !== e.id) return;
    const nova = !current;
    const falanteAntes = current?.falante;
    this.emit({ chamada: e, erro: '' });
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => this.end('O tempo do rádio terminou.'), Math.max(0, Date.parse(e.expiraEm) - Date.now()));
    if (e.status === 'Tocando' && e.destino.chave === this.state.eu.chave) {
      if (!e.servidor) { this.end('Quem chamou está com o rádio antigo. Peça para atualizar o app ou o painel.'); return; }
      if (nova) this.invite(e);
      if ((e.alertas || 0) > (current?.alertas || 0)) this.aoAlertar(e);
      if (this.autoAtender(e)) this.accept(true);
    }
    if (e.status === 'Ativa') {
      // Saída de áudio (alto-falante/fone) abre uma vez por conversa; o microfone só ao apertar.
      if (!this.aberto) {
        this.aberto = true;
        Promise.resolve().then(() => this.media.abrir()).catch(err => { if (this.state.chamada?.id === e.id) this.fail(err); });
      }
      const outro = falanteAntes && falanteAntes !== this.state.eu.chave;
      if (e.falante && e.falante !== this.state.eu.chave && e.falante !== falanteAntes) this.tocarBipe('ouvir');
      if (outro && e.falante !== falanteAntes) this.media.fimFala();
    }
    this.applyFloor();
  }
  // Pedaço de voz de quem tem a vez (o servidor só repassa de quem pode falar): toca na hora.
  ouvir(v) {
    const c = this.state.chamada;
    if (!c || v?.id !== c.id || c.status !== 'Ativa' || this.held) return;
    // Um pedaço perdido não derruba o rádio; só avisa se o aparelho não consegue tocar a voz.
    try { this.media.tocar(v); } catch (e) { if (e?.message) this.emit({ erro: e.message }); }
  }
  async press() {
    const atual = this.state.chamada;
    if (this.held || atual?.status !== 'Ativa') return;
    this.held = true;
    // Canal livre: toca o bipe e só envia a voz depois dele, como num rádio comunicador.
    const livre = !atual.falante || !atual.falaAte || Date.parse(atual.falaAte) <= Date.now();
    this.micLiberadoEm = livre ? Date.now() + this.tocarBipe('falar') : 0;
    // O microfone já abre durante o bipe, sem enviar nada.
    this.applyFloor();
    try {
      const e = await this.hub.invoke('Acao', atual.id, 'PedirFala');
      this.receive(e);
      // Soltar antes da resposta nunca pode transmitir.
      if (!this.held) await this.release();
    } catch (e) { this.held = false; this.applyFloor(); this.emit({ erro: cleanError(e) }); }
  }
  async release() {
    this.held = false;
    // O último pedaço da fala sai antes de liberar a vez.
    await this.applyFloor();
    const c = this.state.chamada;
    if (c && this.state.conectado) try { this.receive(await this.hub.invoke('Acao', c.id, 'LiberarFala')); } catch { /* microfone já fechado */ }
  }
  applyFloor() {
    clearTimeout(this.floorTimer); clearTimeout(this.bipeTimer);
    const c = this.state.chamada;
    const remaining = c?.falaAte ? Date.parse(c.falaAte) - Date.now() : 0;
    const valid = c?.status === 'Ativa' && remaining > 0 && this.state.conectado;
    const minhaVez = Boolean(valid && this.held && c.falante === this.state.eu?.chave);
    const esperaBipe = minhaVez ? (this.micLiberadoEm || 0) - Date.now() : 0;
    if (esperaBipe > 0) this.bipeTimer = setTimeout(() => this.applyFloor(), esperaBipe);
    if (remaining > 0) this.floorTimer = setTimeout(() => { this.held = false; this.applyFloor(); }, Math.min(remaining + 10, 20010));
    const modo = minhaVez && esperaBipe <= 0 ? 'enviando' : this.held && c?.status === 'Ativa' && this.state.conectado ? 'pronto' : 'parado';
    return this.microfone(modo);
  }
  // As trocas de modo do microfone acontecem uma de cada vez, na ordem; um modo já superado por outro
  // pedido é pulado. Se a conversa acabar no meio (ex.: enquanto o celular pede a permissão), o microfone fecha de novo.
  microfone(modo) {
    if (modo === this.modo) return this.micFila;
    this.modo = modo;
    const id = this.state.chamada?.id, geracao = this.geracao;
    this.micFila = this.micFila.then(async () => {
      if (geracao !== this.geracao || modo !== this.modo) return;
      const ultimo = await this.media.microfone(modo, p => this.enviarVoz(id, p));
      if (geracao !== this.geracao) { if (modo !== 'parado') await this.media.microfone('parado', () => {}); return; }
      if (ultimo) this.enviarVoz(id, ultimo);
    }).catch(e => {
      if (modo === 'parado' || geracao !== this.geracao) return;
      // Sem microfone (permissão negada, ocupado): solta o botão e avisa depois de liberar a vez.
      const erro = cleanError(e, 'Não foi possível abrir o microfone.');
      this.held = false; this.modo = 'falhou';
      setTimeout(() => { this.release().finally(() => { if (geracao === this.geracao) this.emit({ erro }); }); }, 0);
    });
    return this.micFila;
  }
  enviarVoz(id, p) {
    if (!id || !p?.dados || this.state.chamada?.id !== id || !this.state.conectado) return;
    try { Promise.resolve(this.hub.send('Voz', id, p.fala, this.seq++, p.codec, p.dados)).catch(() => {}); } catch { /* pedaço perdido */ }
  }
  async end(message = '') {
    const c = this.state.chamada;
    this.cleanup(); this.emit({ chamada: null, erro: message });
    if (c) {
      this.closed.add(c.id);
      try { await this.hub.invoke('Acao', c.id, 'Encerrar'); } catch { /* expiração também limpa o servidor */ }
    }
  }
  fail(e) { return this.end(cleanError(e)); }
  offline() {
    const c = this.state.chamada; if (c) this.closed.add(c.id);
    this.cleanup(); this.emit({ conectado: false, chamada: null, erro: c ? 'Conexão perdida. Chame novamente quando reconectar.' : this.state.erro });
  }
  cleanup() {
    this.held = false; this.micLiberadoEm = 0; this.aberto = false; this.atendendo = null;
    clearTimeout(this.floorTimer); clearTimeout(this.expiry); clearTimeout(this.bipeTimer);
    this.modo = 'parado'; this.geracao++;
    try { this.media.clear(); } catch { /* mídia já fechada */ }
  }
  async dispose() {
    this.disposed = true; clearInterval(this.heartbeat); clearTimeout(this.retry);
    await this.end(); await this.hub.stop();
  }
}
export function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.random() * 16 | 0; return (c === 'x' ? n : (n & 3) | 8).toString(16); }); }
export function cleanError(e, padrao = 'Não foi possível conectar o rádio.') { return (e?.message || padrao).replace(/^.*HubException:\s*/, ''); }
