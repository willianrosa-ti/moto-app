const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const carregar = arquivo => import('data:text/javascript;base64,' + fs.readFileSync(arquivo).toString('base64'));
const modulo = carregar('services/radio/RadioClient.js');
const formato = carregar('services/radio/formatoVoz.js');
const a = { chave: 'Agencia:1', nome: 'Agência' }, b = { chave: 'Motorista:2', nome: 'Piloto' };
const espera = ms => new Promise(resolve => setTimeout(resolve, ms));
const ate = ms => new Date(Date.now() + ms).toISOString();
function chamada(patch = {}) { return { id: '1', origem: a, destino: b, origemAparelho: 'a', destinoAparelho: 'b', status: 'Ativa', servidor: true, falante: null, falaAte: null, expiraEm: ate(60000), versao: 1, ...patch }; }
function convite(patch = {}) { return chamada({ origem: b, destino: a, origemAparelho: 'x', destinoAparelho: null, status: 'Tocando', ...patch }); }
function midia() {
  const m = { modos: [], tocados: [], fins: 0, aberturas: 0, limpezas: 0, ultimo: null, aoPedaco: null,
    abrir: async () => { m.aberturas++; },
    microfone: async (modo, fn) => { m.modos.push(modo); m.aoPedaco = fn; if (modo !== 'enviando' && m.ultimo) { const u = m.ultimo; m.ultimo = null; return u; } return null; },
    tocar: p => { m.tocados.push(p); }, fimFala: () => { m.fins++; }, clear: () => { m.limpezas++; } };
  return m;
}
async function cliente({ invoke = async () => {}, autoAtender, bipe, aoAlertar, chamadaInicial } = {}) {
  const { RadioClient } = await modulo;
  const eventos = {}, log = [], envios = [], ref = { invoke };
  const hub = { connectionId: 'a', on: (n, fn) => { eventos[n] = fn; }, onreconnecting(fn) { eventos.reconnecting = fn; }, onreconnected() {}, onclose() {},
    invoke: (...args) => { log.push(args[0] === 'Acao' ? args[2] : args[0]); return ref.invoke(...args); },
    send: async (...args) => { log.push(args[0]); envios.push(args.slice(1)); }, start: async () => {}, stop: async () => {} };
  const media = midia();
  const client = new RadioClient({ hub, media, update() {}, config: async () => ({ eu: a }), autoAtender, bipe, aoAlertar });
  client.state.eu = a; client.state.conectado = true;
  if (chamadaInicial) client.state.chamada = chamadaInicial;
  return { client, media, eventos, log, envios, set invoke(fn) { ref.invoke = fn; } };
}

test('rádio pelo servidor: chamar não monta ligação nem abre o microfone', async () => {
  const f = await cliente({ invoke: async metodo => metodo === 'ChamarServidor' ? chamada({ status: 'Tocando', destinoAparelho: null }) : undefined });
  await f.client.call('Motorista', 2);
  assert.deepEqual(f.log, ['ChamarServidor']); assert.deepEqual(f.media.modos, []); assert.equal(f.client.state.chamada.status, 'Tocando');
  await f.client.dispose();
});
test('canal ativo abre a saída de áudio uma vez; o microfone só ao apertar', async () => {
  const f = await cliente();
  f.client.receive(chamada({ versao: 2 })); f.client.receive(chamada({ versao: 3 })); await espera(5);
  assert.equal(f.media.aberturas, 1); assert.deepEqual(f.media.modos, []); await f.client.dispose();
});
test('transmite só com a vez e depois do bipe; o último pedaço sai antes de liberar a vez', async () => {
  const f = await cliente({ chamadaInicial: chamada(), bipe: () => 30 });
  f.invoke = async (metodo, id, acao) => chamada({ falante: acao === 'PedirFala' ? a.chave : null, falaAte: acao === 'PedirFala' ? ate(20000) : null, versao: acao === 'PedirFala' ? 2 : 3 });
  await f.client.press();
  assert.deepEqual(f.media.modos, ['pronto']);
  await espera(60); assert.deepEqual(f.media.modos, ['pronto', 'enviando']);
  f.media.aoPedaco({ fala: 1, codec: 'opus', dados: 'AAA' });
  f.media.ultimo = { fala: 1, codec: 'opus', dados: 'BBB' };
  await f.client.release();
  assert.deepEqual(f.media.modos, ['pronto', 'enviando', 'parado']);
  assert.deepEqual(f.log, ['PedirFala', 'Voz', 'Voz', 'LiberarFala']);
  assert.deepEqual(f.envios, [['1', 1, 0, 'opus', 'AAA'], ['1', 1, 1, 'opus', 'BBB']]);
  await f.client.end(); f.media.aoPedaco({ fala: 1, codec: 'opus', dados: 'CCC' }); assert.equal(f.envios.length, 2);
  await f.client.dispose();
});
test('soltar antes da resposta nunca transmite', async () => {
  const f = await cliente({ chamadaInicial: chamada() }); let conceder;
  f.invoke = (metodo, id, acao) => acao === 'PedirFala' ? new Promise(resolve => { conceder = resolve; }) : Promise.resolve(chamada({ versao: 3 }));
  const apertar = f.client.press(); await f.client.release();
  conceder(chamada({ falante: a.chave, falaAte: ate(20000), versao: 2 })); await apertar; await espera(5);
  assert.ok(!f.media.modos.includes('enviando')); await f.client.dispose();
});
test('desconectar para o microfone, limpa a mídia e rejeita estado antigo', async () => {
  const f = await cliente({ chamadaInicial: chamada() }); f.client.held = true;
  f.client.receive(chamada({ versao: 4, falante: a.chave, falaAte: ate(20000) })); await espera(5);
  assert.deepEqual(f.media.modos, ['enviando']); f.eventos.reconnecting();
  assert.equal(f.media.limpezas, 1); assert.equal(f.client.state.chamada, null);
  f.client.receive(chamada({ versao: 5 })); assert.equal(f.client.state.chamada, null); await f.client.dispose();
});
test('voz recebida toca só nesta conversa e nunca enquanto eu falo; fim da fala avisa a mídia', async () => {
  const f = await cliente({ chamadaInicial: chamada() });
  f.eventos.RadioVoz({ id: '9', fala: 1, seq: 0, codec: 'opus', dados: 'x' });
  f.client.receive(chamada({ versao: 2, falante: b.chave, falaAte: ate(20000) }));
  f.eventos.RadioVoz({ id: '1', fala: 1, seq: 1, codec: 'opus', dados: 'y' });
  assert.deepEqual(f.media.tocados.map(p => p.dados), ['y']);
  f.client.receive(chamada({ versao: 3 })); assert.equal(f.media.fins, 1);
  f.client.held = true; f.eventos.RadioVoz({ id: '1', fala: 2, seq: 2, codec: 'opus', dados: 'z' });
  assert.equal(f.media.tocados.length, 1); await f.client.dispose();
});
test('limite local para de transmitir mesmo sem resposta do servidor', async () => {
  const f = await cliente({ chamadaInicial: chamada() }); f.client.held = true;
  f.client.receive(chamada({ versao: 2, falante: a.chave, falaAte: ate(30) })); await espera(5);
  assert.deepEqual(f.media.modos, ['enviando']); await espera(70);
  assert.deepEqual(f.media.modos, ['enviando', 'parado']); await f.client.dispose();
});
test('estados fora de ordem não reabrem vez encerrada', async () => {
  const f = await cliente({ chamadaInicial: chamada() }); f.client.held = true;
  f.client.receive(chamada({ versao: 5 })); f.client.receive(chamada({ versao: 4, falante: a.chave, falaAte: ate(20000) })); await espera(5);
  assert.ok(!f.media.modos.includes('enviando')); await f.client.dispose();
});
test('microfone negado solta o botão e o aviso fica na tela', async () => {
  const f = await cliente({ chamadaInicial: chamada() });
  f.media.microfone = async modo => { f.media.modos.push(modo); if (modo !== 'parado') { await espera(5); throw new Error('Permita o microfone para falar no rádio.'); } return null; };
  f.invoke = async (metodo, id, acao) => chamada({ falante: acao === 'PedirFala' ? a.chave : null, falaAte: acao === 'PedirFala' ? ate(20000) : null, versao: acao === 'PedirFala' ? 2 : 3 });
  await f.client.press(); await espera(30);
  assert.equal(f.client.held, false); assert.deepEqual(f.media.modos, ['pronto', 'parado']);
  assert.ok(f.log.includes('LiberarFala')); assert.equal(f.client.state.erro, 'Permita o microfone para falar no rádio.');
  await f.client.dispose();
});
test('rádio: quem é chamado conecta direto, sem aceitar, com o app aberto', async () => {
  const f = await cliente({ autoAtender: () => true, invoke: async (metodo, id, acao) => acao === 'Atender' ? convite({ versao: 2, status: 'Ativa', destinoAparelho: 'a' }) : undefined });
  f.client.receive(convite()); await espera(10);
  assert.ok(f.log.includes('Atender')); assert.equal(f.client.state.chamada.status, 'Ativa'); assert.equal(f.media.aberturas, 1);
  assert.equal(f.client.state.erro, ''); await f.client.dispose();
});
test('rádio: chamado em segundo plano conecta ao voltar para o app', async () => {
  const aberto = { valor: false };
  const f = await cliente({ autoAtender: () => aberto.valor, invoke: async (metodo, id, acao) => acao === 'Atender' ? convite({ versao: 2, status: 'Ativa', destinoAparelho: 'a' }) : undefined });
  f.client.receive(convite()); await espera(10); assert.ok(!f.log.includes('Atender'));
  aberto.valor = true; f.client.atenderPendente(); await espera(10);
  assert.ok(f.log.includes('Atender')); await f.client.dispose();
});
test('rádio: outro aparelho da mesma conta conectou primeiro, sem erro na tela', async () => {
  const f = await cliente({ autoAtender: () => true, invoke: async (metodo, id, acao) => { if (acao === 'Atender') throw new Error('HubException: Convite já atendido.'); } });
  f.client.receive(convite()); await espera(10);
  assert.equal(f.client.state.chamada, null); assert.equal(f.client.state.erro, ''); await f.client.dispose();
});
test('rádio: convite do rádio antigo é encerrado com aviso para atualizar', async () => {
  const f = await cliente({ autoAtender: () => true });
  f.client.receive(convite({ servidor: false })); await espera(5);
  assert.equal(f.client.state.chamada, null); assert.match(f.client.state.erro, /rádio antigo/);
  assert.ok(f.log.includes('Encerrar')); assert.ok(!f.log.includes('Atender')); await f.client.dispose();
});
test('rádio: bipe toca uma vez quando o outro começa a falar', async () => {
  const bipes = [];
  const f = await cliente({ chamadaInicial: chamada(), bipe: tipo => { bipes.push(tipo); return 0; } });
  const fala = { falante: b.chave, falaAte: ate(20000) };
  f.client.receive(chamada({ versao: 2, ...fala })); f.client.receive(chamada({ versao: 3, ...fala }));
  assert.deepEqual(bipes, ['ouvir']); await f.client.dispose();
});
test('rádio: alertas tocam no chamado e o terceiro conecta sozinho', async () => {
  const alertas = [];
  const f = await cliente({ autoAtender: c => (c.alertas || 0) >= 3, aoAlertar: c => alertas.push(c.alertas),
    invoke: async (metodo, id, acao) => acao === 'Atender' ? convite({ versao: 9, status: 'Ativa', destinoAparelho: 'a' }) : undefined });
  f.client.receive(convite({ versao: 1 })); f.client.receive(convite({ versao: 2, alertas: 1 })); f.client.receive(convite({ versao: 3, alertas: 2 }));
  await espera(10); assert.ok(!f.log.includes('Atender'));
  f.client.receive(convite({ versao: 4, alertas: 3 })); await espera(10);
  assert.deepEqual(alertas, [1, 2, 3]); assert.ok(f.log.includes('Atender')); await f.client.dispose();
});
test('rádio: quem chamou envia alerta para o colega fora do app', async () => {
  const tocando = chamada({ status: 'Tocando', destinoAparelho: null });
  const f = await cliente({ invoke: async metodo => metodo === 'ChamarServidor' ? tocando : metodo === 'Alertar' ? { ...tocando, versao: 2, alertas: 1 } : undefined });
  await f.client.call('Motorista', 2);
  await f.client.alertar(); assert.equal(f.client.state.chamada.alertas, 1); assert.ok(f.log.includes('Alertar'));
  await f.client.dispose();
});

test('voz: pacotes Opus juntam e separam com o tamanho na frente', async () => {
  const { juntarPacotes, separarPacotes, paraBase64, deBase64 } = await formato;
  const pacotes = [Uint8Array.from([1, 2, 3]), new Uint8Array(300).fill(7)];
  const bytes = juntarPacotes(pacotes);
  assert.equal(bytes.length, 2 + 3 + 2 + 300); assert.deepEqual([...bytes.slice(0, 2)], [0, 3]); assert.deepEqual([...bytes.slice(5, 7)], [1, 44]);
  assert.deepEqual(separarPacotes(deBase64(paraBase64(bytes))).map(p => [...p]), pacotes.map(p => [...p]));
  assert.deepEqual(separarPacotes(Uint8Array.from([0, 9, 1])), []);
});
test('voz: μ-law segue o G.711 e volta com erro pequeno', async () => {
  const { linearParaMuLaw, muLawParaLinear, codificarMuLaw, decodificarMuLaw } = await formato;
  assert.equal(linearParaMuLaw(0), 0xff); assert.equal(linearParaMuLaw(-1), 0x7f); assert.equal(linearParaMuLaw(32767), 0x80); assert.equal(linearParaMuLaw(-32768), 0x00);
  assert.equal(muLawParaLinear(0xff), 0); assert.equal(muLawParaLinear(0x80), 32124); assert.equal(muLawParaLinear(0x00), -32124);
  for (let x = -32000; x <= 32000; x += 97) assert.ok(Math.abs(muLawParaLinear(linearParaMuLaw(x)) - x) <= Math.max(16, Math.abs(x) / 16), `amostra ${x}`);
  const voz = Float32Array.from([0, 0.5, -0.25, 0.999]);
  decodificarMuLaw(codificarMuLaw(voz)).forEach((v, i) => assert.ok(Math.abs(v - voz[i]) < 0.04));
});
test('voz: redução para 8 kHz guarda a sobra entre quadros', async () => {
  const { reduzirTaxa, reamostrar } = await formato;
  const estado = { pos: 0, soma: 0, n: 0 };
  const total = [...reduzirTaxa(new Float32Array(960).fill(0.5), 48000, 8000, estado), ...reduzirTaxa(new Float32Array(960).fill(0.5), 48000, 8000, estado)];
  assert.equal(total.length, 320); assert.ok(total.every(v => Math.abs(v - 0.5) < 1e-6));
  assert.equal(reduzirTaxa(new Float32Array(883), 44100, 8000, { pos: 0, soma: 0, n: 0 }).length, 160);
  assert.equal(reamostrar(new Float32Array(441), 44100, 48000).length, 480);
});
test('rádio: aviso de conversa encerrada some sozinho; erro ao chamar continua na tela', async () => {
  const f = await cliente({ chamadaInicial: chamada() }); f.client.avisoMs = 30;
  f.client.receive(chamada({ versao: 2, status: 'Encerrada', motivo: 'Conversa encerrada' }));
  assert.equal(f.client.state.erro, 'Conversa encerrada'); await espera(50); assert.equal(f.client.state.erro, '');
  f.invoke = async () => { throw new Error('HubException: Piloto está ocupado e não recebe rádio agora.'); };
  await f.client.call('Motorista', 2); await espera(50);
  assert.equal(f.client.state.erro, 'Piloto está ocupado e não recebe rádio agora.'); await f.client.dispose();
});
test('rádio: alerta avulso vai pelo hub e chega pelo evento', async () => {
  const recebidos = [];
  const f = await cliente({ invoke: async (metodo, perfil, id) => metodo === 'AlertaAvulso' ? `Alerta enviado para ${perfil}:${id}.` : undefined });
  f.client.aoAlertaAvulso = a => recebidos.push(a.de.nome);
  assert.equal(await f.client.alertarAvulso('Agencia', 1), 'Alerta enviado para Agencia:1.');
  f.eventos.RadioAlertaAvulso({ id: 'x', de: b, em: new Date().toISOString() });
  assert.deepEqual(recebidos, ['Piloto']);
  f.invoke = async () => { throw new Error('HubException: Aguarde um instante para enviar outro alerta.'); };
  await assert.rejects(f.client.alertarAvulso('Agencia', 1), /Aguarde um instante/); await f.client.dispose();
});
test('rádio: ao abrir, retoma a conversa que o rádio nativo atendeu com o app fechado', async () => {
  const f = await cliente({ invoke: async metodo => metodo === 'Atual' ? chamada({ versao: 7, origem: b, destino: a, origemAparelho: 'x', destinoAparelho: 'a' }) : undefined });
  await f.client.start(); await espera(5);
  assert.equal(f.client.state.chamada?.status, 'Ativa'); assert.equal(f.media.aberturas, 1);
  assert.ok(f.log.includes('Atual')); await f.client.dispose();
});
