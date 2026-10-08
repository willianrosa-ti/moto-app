// Protocolo compartilhado pelo app e painel; sem dependência de DOM ou React Native.
export class RadioClient {
  constructor({ hub, config, media, update, invite = () => {}, id = uuid }) {
    Object.assign(this, { hub, config, media, update, invite, id });
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
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (this.state.conectado) this.hub.invoke('Batimento').catch(() => { this.offline(); this.hub.stop(); });
      }, 15000);
    } catch { if (!this.disposed) this.retry = setTimeout(() => this.start(), 5000); }
  }
  async prepare() {
    if (this.stream) return;
    if (!this.state.conectado) throw new Error('Rádio sem conexão. Aguarde a reconexão.');
    const g = this.generation;
    this.emit({ preparando: true, erro: '' });
    try {
      const c = await this.config(true);
      if (!c.voz.habilitado) throw new Error(c.voz.mensagem);
      this.iceServers = c.voz.iceServers;
      const stream = await this.media.microphone();
      stream.getAudioTracks().forEach(t => { t.enabled = false; });
      if (g !== this.generation || this.disposed) { stream.getTracks().forEach(t => t.stop()); this.media.clear(); throw new Error('Convite encerrado.'); }
      this.stream = stream;
    } finally { this.emit({ preparando: false }); }
  }
  async call(perfil, id) {
    if (this.state.chamada || this.state.preparando) return;
    try { await this.prepare(); this.emit({ preparando: true }); this.receive(await this.hub.invoke('Chamar', perfil, id, this.id())); }
    catch (e) { this.cleanup(); this.emit({ erro: cleanError(e) }); }
    finally { this.emit({ preparando: false }); }
  }
  async accept() {
    const c = this.state.chamada;
    if (!c || c.status !== 'Tocando' || this.state.preparando) return;
    try { await this.prepare(); this.receive(await this.hub.invoke('Acao', c.id, 'Aceitar')); }
    catch (e) { await this.end(); this.emit({ erro: cleanError(e) }); }
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
    this.emit({ chamada: e, erro: '' });
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => this.end('O tempo do rádio terminou.'), Math.max(0, Date.parse(e.expiraEm) - Date.now()));
    if (nova && e.destino.chave === this.state.eu.chave && e.status === 'Tocando') this.invite(e);
    this.applyFloor();
    if (e.status === 'Conectando' || e.status === 'Ativa') {
      this.serial = this.serial.then(async () => {
        if (this.state.chamada?.id !== e.id) return;
        await this.connect();
        if (this.state.chamada?.origemPronta && this.state.chamada?.destinoPronto && e.origem.chave === this.state.eu.chave && !this.offered) {
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
    if (!this.stream) throw new Error('Microfone indisponível. Faça uma nova chamada.');
    const c = this.state.chamada;
    const pc = this.pc = this.media.peer({ iceServers: this.iceServers });
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
    if (this.held || this.state.chamada?.status !== 'Ativa') return;
    this.held = true;
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
    clearTimeout(this.floorTimer);
    const c = this.state.chamada;
    const remaining = c?.falaAte ? Date.parse(c.falaAte) - Date.now() : 0;
    const valid = c?.status === 'Ativa' && remaining > 0 && this.state.conectado;
    this.stream?.getAudioTracks().forEach(t => { t.enabled = Boolean(valid && this.held && c.falante === this.state.eu?.chave); });
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
    this.generation++; this.held = false;
    clearTimeout(this.floorTimer); clearTimeout(this.expiry);
    const pc = this.pc; this.pc = null;
    if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; pc.close(); }
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
