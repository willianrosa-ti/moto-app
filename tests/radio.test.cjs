const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const modulo = import('data:text/javascript;base64,' + fs.readFileSync('services/radio/RadioClient.js').toString('base64'));
const a = { chave: 'Agencia:1', nome: 'Agência' }, b = { chave: 'Motorista:2', nome: 'Piloto' };
test('abrir app já deixa a credencial de voz pronta; voz indisponível não captura microfone', async () => {
  const { RadioClient } = await modulo;
  const consultas = []; let capturas = 0;
  const hub = { on() {}, onreconnecting() {}, onreconnected() {}, onclose() {}, start: async () => {}, stop: async () => {}, invoke: async () => {} };
  const client = new RadioClient({ hub, update() {},
    config: async (voz = false) => { consultas.push(voz); return { eu: a, voz: { habilitado: false, mensagem: 'Voz indisponível' } }; },
    media: { microphone: async () => { capturas++; }, clear() {} },
  });
  try {
    await client.start(); assert.deepEqual(consultas, [false, true]);
    await client.call('Motorista', 2); assert.deepEqual(consultas, [false, true]);
    assert.equal(capturas, 0); assert.equal(client.state.erro, 'Voz indisponível');
  } finally { await client.dispose(); }
});
function chamada(patch = {}) { return { id: '1', origem: a, destino: b, origemAparelho: 'a', destinoAparelho: 'b', status: 'Ativa', falante: null, falaAte: null, expiraEm: new Date(Date.now() + 60000).toISOString(), versao: 1, ...patch }; }
async function fixture() {
  const { RadioClient } = await modulo;
  const eventos = {}, log = []; let invoke = async (...args) => { log.push(args); };
  const hub = { connectionId: 'a', on: (n, fn) => eventos[n] = fn, onreconnecting(fn) { eventos.reconnecting = fn; }, onreconnected() {}, onclose() {}, invoke: (...args) => invoke(...args), stop: async () => {} };
  const track = { enabled: false, stop() { this.stopped = true; } }, remoto = { enabled: false };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const client = new RadioClient({ hub, config: async () => ({ eu: a, voz: { habilitado: true, iceServers: [] } }), media: { microphone: async () => stream, clear() {} }, update() {} });
  client.state.eu = a; client.state.conectado = true; client.state.chamada = chamada();
  // Conversa já conectada: a oferta de conexão já foi feita.
  client.stream = stream; client.remote = { getAudioTracks: () => [remoto] }; client.pc = { close() {} }; client.offered = true;
  return { client, track, remoto, eventos, log, invoke(fn) { invoke = fn; } };
}
test('microfone só abre após receber a vez e fecha imediatamente ao soltar', async () => {
  const f = await fixture();
  f.invoke(async (metodo, id, acao) => chamada({ falante: acao === 'PedirFala' ? a.chave : null, falaAte: new Date(Date.now() + 20000).toISOString(), versao: acao === 'PedirFala' ? 2 : 3 }));
  await f.client.press(); assert.equal(f.track.enabled, true); await f.client.release(); assert.equal(f.track.enabled, false);
  await f.client.dispose();
});
test('soltar antes da resposta nunca abre o microfone', async () => {
  const f = await fixture(); let grant;
  f.invoke((_, id, acao) => acao === 'PedirFala' ? new Promise(resolve => grant = resolve) : Promise.resolve(chamada({ versao: 3 })));
  const press = f.client.press(); await f.client.release();
  grant(chamada({ falante: a.chave, falaAte: new Date(Date.now() + 20000).toISOString(), versao: 2 })); await press;
  assert.equal(f.track.enabled, false); await f.client.dispose();
});
test('desconectar fecha microfone, encerra mídia e rejeita estado antigo', async () => {
  const f = await fixture(); f.client.held = true;
  f.client.receive(chamada({ versao: 4, falante: a.chave, falaAte: new Date(Date.now() + 20000).toISOString() }));
  assert.equal(f.track.enabled, true); f.eventos.reconnecting();
  assert.equal(f.track.stopped, true); assert.equal(f.client.state.chamada, null);
  f.client.receive(chamada({ versao: 5 })); assert.equal(f.client.state.chamada, null); await f.client.dispose();
});
test('não escuta áudio sem vez concedida ao interlocutor', async () => {
  const f = await fixture(); f.client.applyFloor(); assert.equal(f.remoto.enabled, false);
  f.client.receive(chamada({ versao: 2, falante: b.chave, falaAte: new Date(Date.now() + 20000).toISOString() }));
  assert.equal(f.remoto.enabled, true); assert.equal(f.track.enabled, false); await f.client.dispose();
});
test('limite local fecha microfone mesmo sem resposta do servidor', async () => {
  const f = await fixture(); f.client.held = true;
  f.client.receive(chamada({ versao: 2, falante: a.chave, falaAte: new Date(Date.now() + 30).toISOString() }));
  assert.equal(f.track.enabled, true); await new Promise(resolve => setTimeout(resolve, 65)); assert.equal(f.track.enabled, false); await f.client.dispose();
});
test('estados fora de ordem não reabrem vez encerrada', async () => {
  const f = await fixture(); f.client.held = true;
  f.client.receive(chamada({ versao: 5 })); f.client.receive(chamada({ versao: 4, falante: a.chave, falaAte: new Date(Date.now() + 20000).toISOString() }));
  assert.equal(f.track.enabled, false); await f.client.dispose();
});
function convite(patch = {}) { return chamada({ origem: b, destino: a, origemAparelho: 'x', destinoAparelho: null, status: 'Tocando', ...patch }); }
async function chamado({ aberto = { valor: true }, aceitar } = {}) {
  const { RadioClient } = await modulo;
  const log = [];
  const track = { enabled: false, stop() {} }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const hub = { connectionId: 'a', on() {}, onreconnecting() {}, onreconnected() {}, onclose() {}, stop: async () => {},
    invoke: async (metodo, id, acao) => { log.push(acao || metodo); if (acao === 'Aceitar') return aceitar ? aceitar() : convite({ versao: 2, destinoAparelho: 'a' }); } };
  const client = new RadioClient({ hub, update() {}, config: async () => ({ eu: a, voz: { habilitado: true, iceServers: [] } }),
    media: { microphone: async () => stream, clear() {} }, autoAtender: () => aberto.valor });
  client.state.eu = a; client.state.conectado = true;
  return { client, log };
}
const espera = ms => new Promise(resolve => setTimeout(resolve, ms));
test('rádio: quem é chamado conecta direto, sem aceitar, com o app aberto', async () => {
  const f = await chamado();
  f.client.receive(convite()); await espera(10);
  assert.ok(f.log.includes('Aceitar')); assert.equal(f.client.state.erro, ''); await f.client.dispose();
});
test('rádio: chamado em segundo plano conecta ao voltar para o app', async () => {
  const aberto = { valor: false }; const f = await chamado({ aberto });
  f.client.receive(convite()); await espera(10); assert.ok(!f.log.includes('Aceitar'));
  aberto.valor = true; f.client.atenderPendente(); await espera(10);
  assert.ok(f.log.includes('Aceitar')); await f.client.dispose();
});
test('rádio: outro aparelho da mesma conta conectou primeiro, sem erro na tela', async () => {
  const f = await chamado({ aceitar: async () => { throw new Error('HubException: Convite já atendido.'); } });
  f.client.receive(convite()); await espera(10);
  assert.equal(f.client.state.chamada, null); assert.equal(f.client.state.erro, ''); await f.client.dispose();
});
test('rádio: bipe ao apertar e microfone só abre depois dele', async () => {
  const f = await fixture(); const bipes = [];
  f.client.bipe = tipo => { bipes.push(tipo); return 40; };
  f.invoke(async (metodo, id, acao) => chamada({ falante: acao === 'PedirFala' ? a.chave : null, falaAte: new Date(Date.now() + 20000).toISOString(), versao: acao === 'PedirFala' ? 2 : 3 }));
  await f.client.press();
  assert.deepEqual(bipes, ['falar']); assert.equal(f.track.enabled, false);
  await espera(60); assert.equal(f.track.enabled, true);
  await f.client.release(); assert.equal(f.track.enabled, false); await f.client.dispose();
});
test('rádio: bipe toca uma vez quando o outro começa a falar', async () => {
  const f = await fixture(); const bipes = [];
  f.client.bipe = tipo => { bipes.push(tipo); return 0; };
  const fala = { falante: b.chave, falaAte: new Date(Date.now() + 20000).toISOString() };
  f.client.receive(chamada({ versao: 2, ...fala })); f.client.receive(chamada({ versao: 3, ...fala }));
  assert.deepEqual(bipes, ['ouvir']); await f.client.dispose();
});
test('rádio: alertas tocam no chamado e o terceiro conecta sozinho', async () => {
  const { RadioClient } = await modulo;
  const log = [], alertas = [];
  const track = { enabled: false, stop() {} }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const hub = { connectionId: 'a', on() {}, onreconnecting() {}, onreconnected() {}, onclose() {}, stop: async () => {},
    invoke: async (metodo, id, acao) => { log.push(acao || metodo); if (acao === 'Aceitar') return convite({ versao: 9, destinoAparelho: 'a' }); } };
  const client = new RadioClient({ hub, update() {}, config: async () => ({ eu: a, voz: { habilitado: true, iceServers: [] } }),
    media: { microphone: async () => stream, clear() {} }, autoAtender: c => (c.alertas || 0) >= 3, aoAlertar: c => alertas.push(c.alertas) });
  client.state.eu = a; client.state.conectado = true;
  client.receive(convite({ versao: 1 })); client.receive(convite({ versao: 2, alertas: 1 })); client.receive(convite({ versao: 3, alertas: 2 }));
  await espera(10); assert.ok(!log.includes('Aceitar'));
  client.receive(convite({ versao: 4, alertas: 3 })); await espera(10);
  assert.deepEqual(alertas, [1, 2, 3]); assert.ok(log.includes('Aceitar')); await client.dispose();
});
test('rádio: quem chamou envia alerta; microfone abre em paralelo com o convite', async () => {
  const { RadioClient } = await modulo;
  const ordem = []; let liberarChamada;
  const track = { enabled: false, stop() {} }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const tocando = chamada({ origem: a, destino: b, status: 'Tocando', destinoAparelho: null });
  const hub = { connectionId: 'a', on() {}, onreconnecting() {}, onreconnected() {}, onclose() {}, stop: async () => {},
    invoke: async (metodo, id, acao) => { ordem.push(metodo === 'Acao' ? acao : metodo);
      if (metodo === 'Chamar') return new Promise(resolve => { liberarChamada = () => resolve(tocando); });
      if (metodo === 'Alertar') return { ...tocando, versao: 2, alertas: 1 }; } };
  const client = new RadioClient({ hub, update() {}, config: async () => ({ eu: a, voz: { habilitado: true, iceServers: [] } }),
    media: { microphone: async () => { ordem.push('microfone'); return stream; }, clear() {} } });
  client.state.eu = a; client.state.conectado = true;
  const chamando = client.call('Motorista', 2); await espera(10);
  assert.deepEqual(ordem, ['Chamar', 'microfone']);
  liberarChamada(); await chamando;
  await client.alertar(); assert.equal(client.state.chamada.alertas, 1); assert.ok(ordem.includes('Alertar'));
  await client.dispose();
});
