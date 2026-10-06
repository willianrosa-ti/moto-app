const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function ambiente(fetch) {
  const storage = new Map(), seguro = new Map();
  const asyncStorage = {
    getItem: async k => storage.get(k) ?? null, setItem: async (k, v) => { storage.set(k, v); }, removeItem: async k => { storage.delete(k); },
    multiSet: async pairs => pairs.forEach(([k, v]) => storage.set(k, v)), multiRemove: async keys => keys.forEach(k => storage.delete(k)),
  };
  const modules = { '@react-native-async-storage/async-storage': asyncStorage, 'react-native': { Platform: { OS: 'android' } },
    'expo-secure-store': { getItemAsync: async k => seguro.get(k) ?? null, setItemAsync: async (k, v) => { seguro.set(k, v); }, deleteItemAsync: async k => { seguro.delete(k); } } };
  const exports = {};
  const codigo = ts.transpileModule(fs.readFileSync(require.resolve('../services/motoristaApi.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(codigo, { exports, require: nome => modules[nome], fetch, Headers, AbortController, setTimeout, clearTimeout });
  return { api: exports, storage, seguro };
}
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const expirada = { token: 'antigo', tokenExpiraEm: new Date(0).toISOString(), refreshToken: 'refresh-seguro' };
const nova = { token: 'novo', tokenExpiraEm: new Date(Date.now() + 3600000).toISOString(), refreshToken: 'refresh-seguro' };

test('requisições simultâneas renovam uma única vez e usam o novo acesso', async () => {
  let renovacoes = 0; const auth = [];
  const { api, storage, seguro } = ambiente(async (url, init) => {
    if (url.endsWith('/renovar-motorista')) { renovacoes++; await new Promise(resolve => setTimeout(resolve, 10)); return json(nova); }
    auth.push(init.headers.get('Authorization')); return json([]);
  });
  await api.salvarSessao(expirada);
  await Promise.all([api.motoristaFetch('/api/Corrida/fila'), api.motoristaFetch('/api/Chat/mensagens'), api.motoristaFetch('/api/Motorista/jornada')]);
  assert.equal(renovacoes, 1); assert.deepEqual(auth, ['Bearer novo', 'Bearer novo', 'Bearer novo']);
  assert.equal(storage.has('refreshTokenMotorista'), false); assert.equal(seguro.get('refreshTokenMotorista'), 'refresh-seguro');
});
test('falta de internet preserva a sessão para a próxima tentativa', async () => {
  const { api, storage, seguro } = ambiente(async () => { throw new Error('offline'); });
  await api.salvarSessao(expirada); await assert.rejects(api.obterTokenMotorista(), /offline/);
  assert.equal(storage.get('tokenMotorista'), 'antigo'); assert.equal(seguro.get('refreshTokenMotorista'), 'refresh-seguro');
});
test('sessão revogada encerra o acesso e avisa a navegação', async () => {
  let encerrada = 0;
  const { api, storage, seguro } = ambiente(async () => new Response(null, { status: 401 }));
  api.observarSessaoEncerrada(() => encerrada++); await api.salvarSessao(expirada);
  assert.equal(await api.obterTokenMotorista(), null); assert.equal(encerrada, 1); assert.equal(storage.size, 0); assert.equal(seguro.size, 0);
});
test('401 de um token ainda válido renova e repete a chamada uma vez', async () => {
  let chamadas = 0;
  const { api } = ambiente(async (url, init) => {
    if (url.endsWith('/renovar-motorista')) return json(nova);
    chamadas++; return init.headers.get('Authorization') === 'Bearer novo' ? json([]) : new Response(null, { status: 401 });
  });
  await api.salvarSessao({ ...expirada, tokenExpiraEm: nova.tokenExpiraEm });
  assert.equal((await api.motoristaFetch('/api/Corrida/fila')).status, 200); assert.equal(chamadas, 2);
});
test('renovação atrasada não restaura uma sessão após logout', async () => {
  let concluir, iniciou;
  const iniciada = new Promise(resolve => { iniciou = resolve; });
  const { api, storage, seguro } = ambiente(async () => { iniciou(); return new Promise(resolve => { concluir = resolve; }); });
  await api.salvarSessao(expirada); const emAndamento = api.renovarSessao(); await iniciada;
  await api.limparSessao(); concluir(json(nova));
  assert.equal(await emAndamento, null); assert.equal(storage.size, 0); assert.equal(seguro.size, 0);
});
