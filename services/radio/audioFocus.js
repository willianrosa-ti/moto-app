let owner = null;
const listeners = new Set();
export const radioOcupado = () => owner?.tipo === 'radio';
export function reservarMicrofone(tipo) {
  if (owner) throw new Error(owner.tipo === 'radio' ? 'Encerre o rádio antes de gravar uma mensagem.' : 'Conclua ou descarte a gravação antes de abrir o rádio.');
  const reserva = { tipo }; owner = reserva;
  listeners.forEach(fn => fn(tipo));
  return () => { if (owner === reserva) { owner = null; listeners.forEach(fn => fn(null)); } };
}
export function observarMicrofone(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
