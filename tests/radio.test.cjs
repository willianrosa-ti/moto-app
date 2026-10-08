const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const modulo = import('data:text/javascript;base64,' + fs.readFileSync('services/radio/RadioClient.js').toString('base64'));
const a = { chave: 'Agencia:1', nome: 'Agência' }, b = { chave: 'Motorista:2', nome: 'Piloto' };
test('abrir app consulta somente presença; voz indisponível não captura microfone', async () => {
  const { RadioClient } = await modulo;
  const consultas = []; let capturas = 0;
  const hub = { on() {}, onreconnecting() {}, onreconnected() {}, onclose() {}, start: async () => {}, stop: async () => {}, invoke: async () => {} };
  const client = new RadioClient({ hub, update() {},
    config: async (voz = false) => { consultas.push(voz); return { eu: a, voz: { habilitado: false, mensagem: 'Voz indisponível' } }; },
    media: { microphone: async () => { capturas++; }, clear() {} },
  });
  try {
    await client.start(); assert.deepEqual(consultas, [false]);
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
  client.stream = stream; client.remote = { getAudioTracks: () => [remoto] }; client.pc = { close() {} };
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
