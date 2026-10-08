const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function carregar() {
  const dados = new Map(), exports = {};
  const storage = { getItem: async k => dados.get(k) || null, setItem: async (k,v) => { dados.set(k,v); } };
  const code = ts.transpileModule(fs.readFileSync('services/chatDireto.ts','utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true } }).outputText;
  vm.runInNewContext(code, {exports,require:()=>storage,JSON}); return exports;
}
const m = (id, lidaEm = null) => ({id,remetenteMotoristaId:1,destinatarioMotoristaId:2,texto:'Oi',criadoEm:'2026-10-08T10:00:00Z',clienteId:String(id),lidaEm});
test('chat direto conserva mensagens de eventos simultâneos e isola contatos e contas', async () => {
  const chat = carregar();
  await Promise.all([chat.guardarDiretas(1,2,[m(1)]),chat.guardarDiretas(1,2,[m(2)]),chat.guardarDiretas(1,3,[m(3)])]);
  assert.deepEqual([...(await chat.lerDiretas(1,2)).map(x=>x.id)], [1,2]);
  assert.deepEqual([...(await chat.lerDiretas(1,3)).map(x=>x.id)], [3]);
  assert.equal((await chat.lerDiretas(4,2)).length,0);
});
test('leitura não regride e cache limita armazenamento sem limitar a paginação na tela', async () => {
  const chat = carregar(), lista = Array.from({length:510},(_,i)=>m(i+1));
  assert.equal(chat.juntarDiretas(lista,[]).length,510);
  await chat.guardarDiretas(1,2,lista); assert.equal((await chat.lerDiretas(1,2)).length,500);
  await chat.guardarDiretas(1,2,[m(510,'2026-10-08T10:05:00Z')]); await chat.guardarDiretas(1,2,[m(510)]);
  assert.equal((await chat.lerDiretas(1,2)).at(-1).lidaEm,'2026-10-08T10:05:00Z');
});
test('rádio e gravação não disputam microfone; liberar reserva antiga não libera a atual', async () => {
  const mod = await import('data:text/javascript;base64,'+fs.readFileSync('services/radio/audioFocus.js').toString('base64'));
  const pararGravacao = mod.reservarMicrofone('gravacao'); assert.throws(()=>mod.reservarMicrofone('radio'));
  pararGravacao(); const pararRadio = mod.reservarMicrofone('radio'); pararGravacao(); assert.equal(mod.radioOcupado(),true);
  assert.throws(()=>mod.reservarMicrofone('gravacao')); pararRadio(); assert.equal(mod.radioOcupado(),false);
});
