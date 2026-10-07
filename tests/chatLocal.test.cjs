const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function carregar() {
  const armazenamento = new Map();
  const asyncStorage = { getItem: async k => armazenamento.get(k) ?? null, setItem: async (k, v) => { armazenamento.set(k, v); } };
  const exports = {};
  const codigo = ts.transpileModule(fs.readFileSync(require.resolve('../services/chatLocal.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(codigo, { exports, require: () => asyncStorage, JSON });
  return { chat: exports, armazenamento };
}
const msg = (id, extra = {}) => ({ id, motoristaId: 1, remetente: 'Agencia', texto: `m${id}`, criadoEm: '2026-10-06T10:00:00Z', clienteId: `c${id}`, ...extra });

test('mensagens apagadas do servidor continuam no histórico do aparelho e a leitura não se perde', () => {
  const { chat } = carregar();
  const local = [msg(1, { lidaEm: '2026-10-06T10:05:00Z' }), msg(2)];
  const servidor = [msg(1, { lidaEm: null }), msg(2, { lidaEm: '2026-10-06T10:06:00Z' }), msg(3)];
  const juntas = chat.juntarMensagens(local, servidor);
  assert.deepEqual([...juntas.map(m => m.id)], [1, 2, 3]);
  assert.equal(juntas[0].lidaEm, '2026-10-06T10:05:00Z');
  assert.equal(juntas[1].lidaEm, '2026-10-06T10:06:00Z');
  assert.deepEqual([...chat.juntarMensagens(juntas, [msg(0)]).map(m => m.id)], [0, 1, 2, 3]);
});

test('o aparelho guarda só as mensagens mais recentes de cada motorista', async () => {
  const { chat, armazenamento } = carregar();
  const muitas = Array.from({ length: chat.LIMITE_MENSAGENS_LOCAIS + 20 }, (_, i) => msg(i + 1));
  await chat.salvarHistoricoLocal('7', muitas);
  const salvas = await chat.lerHistoricoLocal('7');
  assert.equal(salvas.length, chat.LIMITE_MENSAGENS_LOCAIS);
  assert.equal(salvas[0].id, 21);
  assert.equal((await chat.lerHistoricoLocal('8')).length, 0);
  armazenamento.set('chatMotorista:9', '{corrompido');
  assert.equal((await chat.lerHistoricoLocal('9')).length, 0);
});
