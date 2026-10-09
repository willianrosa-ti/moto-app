// Rádio pelo servidor no navegador (painel da agência e app no iPhone): grava com o microfone do navegador,
// comprime em Opus (WebCodecs) ou μ-law e toca os pedaços recebidos com uma pequena reserva contra a variação da rede.
import { TAXA_OPUS, TAXA_PCMU, PEDACO_MS, juntarPacotes, separarPacotes, juntarBytes, paraBase64, deBase64, codificarMuLaw, decodificarMuLaw, reduzirTaxa, reamostrar } from './formatoVoz';

const RESERVA_S = 0.25;
const CONFIG_OPUS = { codec: 'opus', sampleRate: TAXA_OPUS, numberOfChannels: 1, bitrate: 16000 };
// Entrega o som do microfone em quadros de 20 ms (a 48 kHz).
const CAPTURA = `class RadioCaptura extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(960); this.n = 0; }
  process(inputs) {
    const c = inputs[0] && inputs[0][0];
    if (c) for (let i = 0; i < c.length; i++) { this.b[this.n++] = c[i]; if (this.n === 960) { this.port.postMessage(this.b); this.b = new Float32Array(960); this.n = 0; } }
    return true;
  }
}
registerProcessor('radio-captura', RadioCaptura);`;

export function criarRadioMediaWeb(reservarMicrofone) {
  let ctx = null, captura = null, sessao = false, liberar = null, opusSuportado = null;
  let stream = null, fonte = null, no = null, mudo = null, aoPedaco = null, abrindo = null;
  let enviando = false, fala = 0, encoder = null, codec = 'pcmu', pacotes = [], partes = [], ms = 0, ts = 0, reducao = null;
  let decoder = null, falaTocando = null, cursor = 0, tsDec = 0, avisado = false;
  const fontes = new Set();

  function contexto() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('Este navegador não tem suporte a áudio para o rádio.');
    try { ctx = new AC({ sampleRate: TAXA_OPUS, latencyHint: 'interactive' }); } catch { ctx = new AC(); }
    return ctx;
  }
  // iPhone e alguns navegadores só liberam o som depois de um toque: libera no primeiro toque e volta a dormir.
  if (typeof document !== 'undefined') {
    const eventos = ['pointerup', 'touchend', 'keydown'];
    const destravar = () => {
      eventos.forEach(n => document.removeEventListener(n, destravar, true));
      try { const c = contexto(); c.resume().then(() => { if (!sessao) c.suspend().catch(() => {}); }).catch(() => {}); } catch { /* sem áudio */ }
    };
    eventos.forEach(n => document.addEventListener(n, destravar, true));
  }

  async function criarNo(c, aoQuadro) {
    if (c.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        captura ??= c.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURA], { type: 'application/javascript' })));
        await captura;
        const n = new AudioWorkletNode(c, 'radio-captura', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        n.port.onmessage = e => aoQuadro(e.data);
        return n;
      } catch { captura = null; }
    }
    const n = c.createScriptProcessor(2048, 1, 1);
    n.onaudioprocess = e => aoQuadro(new Float32Array(e.inputBuffer.getChannelData(0)));
    return n;
  }
  // O microfone do navegador leva alguns décimos de segundo para entregar som; por isso fica aberto (sem enviar
  // nada) do primeiro uso até o fim da conversa, como no rádio anterior.
  function abrirMicrofone() {
    if (stream) return Promise.resolve();
    abrindo ??= (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Use HTTPS e permita o microfone para falar no rádio.');
      const c = contexto(); await c.resume().catch(() => {});
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      try {
        if (!sessao) throw new Error('Rádio encerrado.');
        const f = c.createMediaStreamSource(s);
        const n = await criarNo(c, quadro => { if (enviando) codificar(quadro, c.sampleRate); });
        // O nó só processa ligado a uma saída; o ganho zero evita ouvir a própria voz.
        const m = c.createGain(); m.gain.value = 0;
        f.connect(n); n.connect(m); m.connect(c.destination);
        stream = s; fonte = f; no = n; mudo = m;
      } catch (e) { s.getTracks().forEach(t => t.stop()); throw e; }
    })().finally(() => { abrindo = null; });
    return abrindo;
  }
  async function microfonePermitido() {
    try { return (await navigator.permissions?.query({ name: 'microphone' }))?.state === 'granted'; } catch { return false; }
  }
  function fecharMicrofone() {
    enviando = false;
    try { fonte?.disconnect(); no?.disconnect(); mudo?.disconnect(); } catch { /* já desligado */ }
    if (no?.port) no.port.onmessage = null;
    if (no) no.onaudioprocess = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = fonte = no = mudo = null;
  }

  async function comecarFala() {
    fala++; pacotes = []; partes = []; ms = 0; ts = 0; reducao = { pos: 0, soma: 0, n: 0 }; encoder = null; codec = 'pcmu';
    if (opusSuportado === null) opusSuportado = typeof AudioEncoder !== 'undefined' && !!(await AudioEncoder.isConfigSupported(CONFIG_OPUS).catch(() => null))?.supported;
    if (opusSuportado) {
      try {
        const e = new AudioEncoder({
          output: chunk => {
            if (e !== encoder) return;
            const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); pacotes.push(b);
            ms += chunk.duration ? chunk.duration / 1000 : 20;
            if (ms >= PEDACO_MS) emitir();
          },
          // Codificador falhou no meio da fala: segue em μ-law.
          error: () => { if (e === encoder) { encoder = null; codec = 'pcmu'; pacotes = []; ms = 0; } },
        });
        e.configure(CONFIG_OPUS); encoder = e; codec = 'opus';
      } catch { encoder = null; codec = 'pcmu'; }
    }
    enviando = true;
  }
  function codificar(quadro, taxa) {
    if (codec === 'opus' && encoder) {
      const dados = taxa === TAXA_OPUS ? quadro : reamostrar(quadro, taxa, TAXA_OPUS);
      const audio = new AudioData({ format: 'f32-planar', sampleRate: TAXA_OPUS, numberOfFrames: dados.length, numberOfChannels: 1, timestamp: ts, data: dados });
      ts += Math.round(dados.length * 1e6 / TAXA_OPUS);
      try { encoder.encode(audio); } finally { audio.close(); }
      return;
    }
    const reduzido = reduzirTaxa(quadro, taxa, TAXA_PCMU, reducao);
    if (reduzido.length) partes.push(codificarMuLaw(reduzido));
    ms += quadro.length * 1000 / taxa;
    if (ms >= PEDACO_MS) emitir();
  }
  function montar() {
    const bytes = codec === 'opus' ? juntarPacotes(pacotes) : juntarBytes(partes);
    pacotes = []; partes = []; ms = 0;
    return bytes.length ? { fala, codec, dados: paraBase64(bytes) } : null;
  }
  function emitir() { const p = montar(); if (p) aoPedaco?.(p); }
  async function terminarFala() {
    if (!enviando) return null;
    enviando = false;
    const e = encoder;
    if (e) try { await e.flush(); } catch { /* sobra perdida */ }
    const ultimo = montar();
    if (e) { encoder = null; try { e.close(); } catch { /* já fechado */ } }
    return ultimo;
  }

  function decodificador() {
    if (decoder) return decoder;
    if (typeof AudioDecoder === 'undefined') return null;
    try {
      const d = new AudioDecoder({
        output: dados => { if (d === decoder) agendar(paraFloat(dados), dados.sampleRate); dados.close(); },
        error: () => { if (d === decoder) decoder = null; },
      });
      d.configure({ codec: 'opus', sampleRate: TAXA_OPUS, numberOfChannels: 1 });
      decoder = d; tsDec = 0; return d;
    } catch { return null; }
  }
  function reiniciarDecoder() { const d = decoder; decoder = null; try { d?.close(); } catch { /* já fechado */ } }
  function agendar(f32, taxa) {
    if (!f32.length || !ctx) return;
    const buffer = ctx.createBuffer(1, f32.length, taxa); buffer.copyToChannel(f32, 0);
    const som = ctx.createBufferSource(); som.buffer = buffer; som.connect(ctx.destination);
    // Começo da fala, ou a rede atrasou: guarda ~250 ms antes de tocar para não picotar.
    if (cursor < ctx.currentTime + 0.02) cursor = ctx.currentTime + RESERVA_S;
    som.start(cursor); cursor += buffer.duration;
    fontes.add(som); som.onended = () => fontes.delete(som);
  }

  return {
    async abrir() {
      liberar ??= reservarMicrofone('radio');
      sessao = true;
      await contexto().resume().catch(() => {});
      // Permissão já dada: o microfone já fica pronto, e a primeira fala sai sem atraso.
      if (await microfonePermitido() && sessao) abrirMicrofone().catch(() => {});
    },
    async microfone(modo, cb) {
      aoPedaco = cb;
      // 'parado' só encerra a fala; o microfone fecha no fim da conversa (clear).
      if (modo === 'parado') return terminarFala();
      await abrirMicrofone();
      if (modo === 'enviando') { if (!enviando) await comecarFala(); return null; }
      return terminarFala();
    },
    tocar(p) {
      const c = contexto();
      if (c.state === 'suspended') c.resume().catch(() => {});
      if (p.fala !== falaTocando) { falaTocando = p.fala; reiniciarDecoder(); cursor = Math.max(cursor, c.currentTime + RESERVA_S); }
      const bytes = deBase64(p.dados);
      if (p.codec === 'pcmu') { agendar(decodificarMuLaw(bytes), TAXA_PCMU); return; }
      if (p.codec !== 'opus') return;
      const d = decodificador();
      if (!d) {
        if (avisado) return;
        avisado = true; throw new Error('Este navegador não consegue tocar a voz do rádio. Atualize-o ou use o app.');
      }
      for (const pacote of separarPacotes(bytes)) { d.decode(new EncodedAudioChunk({ type: 'key', timestamp: tsDec, data: pacote })); tsDec += 20000; }
    },
    fimFala() { falaTocando = null; },
    clear() {
      sessao = false; aoPedaco = null; enviando = false;
      const e = encoder; encoder = null; try { e?.close(); } catch { /* já fechado */ }
      fecharMicrofone(); reiniciarDecoder(); falaTocando = null; cursor = 0;
      fontes.forEach(f => { try { f.stop(); } catch { /* já parou */ } }); fontes.clear();
      liberar?.(); liberar = null;
      ctx?.suspend().catch(() => {});
    },
  };
}

function paraFloat(dados) {
  const f = new Float32Array(dados.numberOfFrames);
  try { dados.copyTo(f, { planeIndex: 0, format: 'f32-planar' }); return f; } catch { /* navegador sem conversão */ }
  if (String(dados.format).startsWith('f32')) { const t = new Float32Array(dados.numberOfFrames * (dados.format === 'f32' ? dados.numberOfChannels : 1)); dados.copyTo(t, { planeIndex: 0 }); const passo = dados.format === 'f32' ? dados.numberOfChannels : 1; for (let i = 0; i < f.length; i++) f[i] = t[i * passo]; return f; }
  const passo = String(dados.format).endsWith('planar') ? 1 : dados.numberOfChannels;
  const s = new Int16Array(dados.numberOfFrames * passo); dados.copyTo(s, { planeIndex: 0 });
  for (let i = 0; i < f.length; i++) f[i] = s[i * passo] / 32768;
  return f;
}
