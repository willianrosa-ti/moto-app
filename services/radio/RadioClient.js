// Protocolo compartilhado pelo app e painel; sem dependência de DOM ou React Native.
export class RadioClient {
  // autoAtender(chamada): quem é chamado conecta sozinho, como num rádio (sem aceitar).
  // bipe(tipo): toca o bipe do rádio ('falar' ao apertar, 'ouvir' quando o outro começa a falar);
  // ao apertar, devolve quantos ms o microfone espera para o bipe não ir junto com a voz.
  // aoAlertar(chamada): quem é chamado recebeu um alerta (entre motoristas; no terceiro, conecta).
  constructor({ hub, config, media, update, invite = () => {}, id = uuid, autoAtender = () => false, bipe = () => 0, aoAlertar = () => {} }) {
    Object.assign(this, { hub, config, media, update, invite, id, autoAtender, bipe, aoAlertar });
    this.state = { chamada: null, eu: null, conectado: false, preparando: false, erro: '' };
    this.closed = new Set(); this.signals = []; this.ice = []; this.held = false;
    this.serial = Promise.resolve(); this.generation = 0; this.disposed = false;
    hub.on('RadioEstado', e => this.receive(e));
    hub.on('RadioSinal', s => { this.serial = this.serial.then(() => this.signal(s)).catch(e => this.fail(e)); });
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
      // Credencial de voz já fica pronta: chamar e conectar não esperam por ela.
      this.obterVoz().catch(() => {});
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (this.state.conectado) this.hub.invoke('Batimento').catch(() => { this.offline(); this.hub.stop(); });
      }, 15000);
    } catch { if (!this.disposed) this.retry = setTimeout(() => this.start(), 5000); }
  }
  // Credenciais TURN valem 1 h no servidor; aqui são reaproveitadas por até 20 min.
  async obterVoz() {
    if (this.voz && Date.now() - this.voz.em < 20 * 60000) return this.voz.dados;
    const c = await this.config(true);
    this.voz = { dados: c.voz, em: Date.now() };
    return c.voz;
  }
  async prepare() {
    if (this.stream) return;
    if (!this.state.conectado) throw new Error('Rádio sem conexão. Aguarde a reconexão.');
    const g = this.generation;
    this.emit({ preparando: true, erro: '' });
    try {
      const voz = await this.obterVoz();
      if (!voz.habilitado) throw new Error(voz.mensagem);
      this.iceServers = voz.iceServers;
      // Começa a reservar o caminho de voz (TURN) enquanto o convite ainda circula.
      if (!this.pcPrevio && this.media.peer && g === this.generation) this.pcPrevio = this.media.peer({ iceServers: this.iceServers, iceCandidatePoolSize: 1 });
      const stream = await this.media.microphone();
      stream.getAudioTracks().forEach(t => { t.enabled = false; });
      if (g !== this.generation || this.disposed) { stream.getTracks().forEach(t => t.stop()); this.media.clear(); throw new Error('Convite encerrado.'); }
      this.stream = stream;
    } finally { this.emit({ preparando: false }); }
  }
  async call(perfil, id) {
    if (this.state.chamada || this.state.preparando) return;
    try {
      const voz = await this.obterVoz();
      if (!voz.habilitado) throw new Error(voz.mensagem);
      // Microfone e rota de áudio abrem em paralelo com o convite.
      this.preparo = this.prepare(); this.preparo.catch(() => {});
      this.emit({ preparando: true });
      this.receive(await this.hub.invoke('Chamar', perfil, id, this.id()));
      await this.preparo;
    } catch (e) { await this.end(); this.emit({ erro: cleanError(e) }); }
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
    if (!c || c.status !== 'Tocando' || this.state.preparando || this.atendendo === c.id) return;
    this.atendendo = c.id;
    // Microfone e rota de áudio abrem em paralelo com o aceite.
    this.preparo = this.prepare(); this.preparo.catch(() => {});
    try { this.receive(await this.hub.invoke('Acao', c.id, 'Aceitar')); }
    catch (e) {
      // Conexão automática que outro aparelho da mesma conta atendeu primeiro: só fecha aqui, sem aviso.
      if (automatico) { if (this.state.chamada?.id === c.id) { this.closed.add(c.id); this.cleanup(); this.emit({ chamada: null }); } return; }
      await this.end(); this.emit({ erro: cleanError(e) }); return;
    }
    try { await this.preparo; }
    catch (e) { if (this.state.chamada?.id === c.id) { await this.end(); this.emit({ erro: cleanError(e) }); } else this.cleanup(); }
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
      if (nova) this.invite(e);
      if ((e.alertas || 0) > (current?.alertas || 0)) this.aoAlertar(e);
      if (this.autoAtender(e)) this.accept(true);
    }
    if (e.status === 'Ativa' && e.falante && e.falante !== this.state.eu.chave && e.falante !== falanteAntes) this.tocarBipe('ouvir');
    this.applyFloor();
    if (e.status === 'Conectando' || e.status === 'Ativa') {
      this.serial = this.serial.then(async () => {
        if (this.state.chamada?.id !== e.id) return;
        await this.connect();
        // Quem chamou envia a oferta logo após o aceite; o outro lado guarda os sinais até ficar pronto.
        if (e.origem.chave === this.state.eu.chave && !this.offered) {
          this.offered = true;
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          await this.hub.invoke('Sinalizar', e.id, 'offer', JSON.stringify(offer));
        }
      }).catch(err => this.fail(err));
    }
  }
  async connect() {
    if (this.pc) return;
    if (!this.stream && this.preparo) await this.preparo;
    if (!this.stream) throw new Error('Microfone indisponível. Faça uma nova chamada.');
    if (this.pc) return;
    const c = this.state.chamada;
    const pc = this.pc = this.pcPrevio || this.media.peer({ iceServers: this.iceServers });
    this.pcPrevio = null;
    this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream));
    pc.onicecandidate = ev => {
      if (ev.candidate && this.pc === pc) this.hub.invoke('Sinalizar', c.id, 'ice', JSON.stringify(ev.candidate.toJSON())).catch(e => this.fail(e));
    };
    pc.ontrack = ev => {
      if (this.pc !== pc) return;
      this.remote = ev.streams[0]; this.media.remote(this.remote); this.applyFloor();
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') {
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind !== 'audio') continue;
          const params = sender.getParameters();
          if (params.encodings?.length) { params.encodings.forEach(e => { e.maxBitrate = 24000; }); sender.setParameters(params).catch(() => {}); }
        }
        this.hub.invoke('Acao', c.id, 'Conectado').then(e => this.receive(e)).catch(e => this.fail(e));
      }
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.end('Conexão de voz interrompida. Faça uma nova chamada.');
    };
    await this.hub.invoke('Acao', c.id, 'Pronto').then(e => this.receive(e));
    const pending = this.signals.splice(0);
    for (const s of pending) await this.signal(s);
  }
  async signal(s) {
    if (s.id !== this.state.chamada?.id) return;
    if (!this.pc) { if (this.signals.length < 100) this.signals.push(s); return; }
    const pc = this.pc, data = JSON.parse(s.json);
    if (s.tipo === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(this.media.candidate(data));
      else if (this.ice.length < 100) this.ice.push(data);
      return;
    }
    await pc.setRemoteDescription(this.media.description(data));
    for (const ice of this.ice.splice(0)) await pc.addIceCandidate(this.media.candidate(ice));
    if (s.tipo === 'offer') {
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      await this.hub.invoke('Sinalizar', s.id, 'answer', JSON.stringify(answer));
    }
  }
  async press() {
    const atual = this.state.chamada;
    if (this.held || atual?.status !== 'Ativa') return;
    this.held = true;
    // Canal livre: toca o bipe e só abre o microfone depois dele, como num rádio comunicador.
    const livre = !atual.falante || !atual.falaAte || Date.parse(atual.falaAte) <= Date.now();
    this.micLiberadoEm = livre ? Date.now() + this.tocarBipe('falar') : 0;
    try {
      const e = await this.hub.invoke('Acao', this.state.chamada.id, 'PedirFala');
      this.receive(e);
      // Soltar antes da resposta nunca pode ligar o microfone.
      if (!this.held) await this.release();
    } catch (e) { this.held = false; this.applyFloor(); this.emit({ erro: cleanError(e) }); }
  }
  async release() {
    this.held = false; this.applyFloor();
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
    this.stream?.getAudioTracks().forEach(t => { t.enabled = minhaVez && esperaBipe <= 0; });
    if (esperaBipe > 0) this.bipeTimer = setTimeout(() => this.applyFloor(), esperaBipe);
    this.remote?.getAudioTracks().forEach(t => { t.enabled = Boolean(valid && c.falante && c.falante !== this.state.eu?.chave); });
    if (remaining > 0) this.floorTimer = setTimeout(() => { this.held = false; this.applyFloor(); }, Math.min(remaining + 10, 20010));
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
    this.generation++; this.held = false; this.micLiberadoEm = 0;
    clearTimeout(this.floorTimer); clearTimeout(this.expiry); clearTimeout(this.bipeTimer);
    const pc = this.pc; this.pc = null;
    if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; pc.close(); }
    this.pcPrevio?.close(); this.pcPrevio = null; this.preparo = null; this.atendendo = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.remote = null; this.media.clear(); this.signals = []; this.ice = []; this.offered = false;
  }
  async dispose() {
    this.disposed = true; clearInterval(this.heartbeat); clearTimeout(this.retry);
    await this.end(); await this.hub.stop();
  }
}
export function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.random() * 16 | 0; return (c === 'x' ? n : (n & 3) | 8).toString(16); }); }
export function cleanError(e) { return (e?.message || 'Não foi possível conectar o rádio.').replace(/^.*HubException:\s*/, ''); }
