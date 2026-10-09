// Formato dos pedaços de voz do rádio, igual no app Android (RadioVozModule.java), no navegador e no painel.
// opus: pacotes Opus de 20 ms (48 kHz, mono), cada um precedido do tamanho em 2 bytes (big-endian).
// pcmu: G.711 μ-law a 8 kHz, para aparelhos/navegadores sem codificador Opus.
export const TAXA_OPUS = 48000, TAXA_PCMU = 8000, PEDACO_MS = 200;

export function juntarPacotes(pacotes) {
  const total = pacotes.reduce((n, p) => n + 2 + p.length, 0);
  const saida = new Uint8Array(total); let pos = 0;
  for (const p of pacotes) { saida[pos++] = (p.length >> 8) & 0xff; saida[pos++] = p.length & 0xff; saida.set(p, pos); pos += p.length; }
  return saida;
}
export function separarPacotes(bytes) {
  const pacotes = []; let pos = 0;
  while (pos + 2 <= bytes.length) {
    const tam = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2;
    if (tam <= 0 || pos + tam > bytes.length) break;
    pacotes.push(bytes.subarray(pos, pos + tam)); pos += tam;
  }
  return pacotes;
}
export function juntarBytes(partes) {
  const saida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0)); let pos = 0;
  for (const p of partes) { saida.set(p, pos); pos += p.length; }
  return saida;
}
export function paraBase64(bytes) {
  let texto = '';
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}
export function deBase64(texto) {
  const bin = atob(texto); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const BIAS = 0x84, CLIP = 32635;
export function linearParaMuLaw(amostra) {
  let s = Math.max(-32768, Math.min(32767, Math.round(amostra)));
  const sinal = s < 0 ? 0x80 : 0;
  if (sinal) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let expoente = 7;
  for (let mascara = 0x4000; (s & mascara) === 0 && expoente > 0; mascara >>= 1) expoente--;
  const mantissa = (s >> (expoente + 3)) & 0x0f;
  return ~(sinal | (expoente << 4) | mantissa) & 0xff;
}
export function muLawParaLinear(u) {
  u = ~u & 0xff;
  const sinal = u & 0x80, expoente = (u >> 4) & 0x07, mantissa = u & 0x0f;
  const s = (((mantissa << 3) + BIAS) << expoente) - BIAS;
  return sinal ? -s : s;
}
// Float (-1..1) → μ-law.
export function codificarMuLaw(f32) {
  const saida = new Uint8Array(f32.length);
  for (let i = 0; i < f32.length; i++) saida[i] = linearParaMuLaw(f32[i] * 32767);
  return saida;
}
export function decodificarMuLaw(bytes) {
  const saida = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) saida[i] = muLawParaLinear(bytes[i]) / 32768;
  return saida;
}
// Reduz a taxa pela média de cada janela (filtro simples contra chiado). `estado` guarda a sobra entre quadros.
export function reduzirTaxa(f32, de, para, estado = { pos: 0, soma: 0, n: 0 }) {
  const razao = de / para, saida = [];
  for (let i = 0; i < f32.length; i++) {
    estado.soma += f32[i]; estado.n++; estado.pos += 1;
    if (estado.pos >= razao) { estado.pos -= razao; saida.push(estado.soma / estado.n); estado.soma = 0; estado.n = 0; }
  }
  return Float32Array.from(saida);
}
// Reamostragem linear (ex.: 44,1 kHz → 48 kHz).
export function reamostrar(f32, de, para) {
  if (de === para || !f32.length) return f32;
  const n = Math.max(1, Math.round(f32.length * para / de)), saida = new Float32Array(n), passo = de / para;
  for (let i = 0; i < n; i++) {
    const x = i * passo, a = Math.min(Math.floor(x), f32.length - 1), b = Math.min(a + 1, f32.length - 1), t = x - a;
    saida[i] = f32[a] * (1 - t) + f32[b] * t;
  }
  return saida;
}
