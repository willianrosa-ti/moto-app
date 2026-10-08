import { reservarMicrofone } from './audioFocus';
let player: HTMLAudioElement | null = null;
let liberar: (() => void) | null = null;
export const radioMedia = {
  async microphone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('O rádio precisa de HTTPS e acesso ao microfone.');
    // Criado durante o gesto do usuário (chamar/aceitar) para liberar áudio no navegador.
    player ??= document.createElement('audio');
    player.autoplay = true;
    liberar = reservarMicrofone('radio');
    try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
    catch (e) { liberar?.(); liberar = null; throw e; }
  },
  peer: (config: RTCConfiguration) => new RTCPeerConnection(config),
  candidate: (data: RTCIceCandidateInit) => new RTCIceCandidate(data),
  description: (data: RTCSessionDescriptionInit) => new RTCSessionDescription(data),
  remote(stream: MediaStream) { if (player) { player.srcObject = stream; player.play().catch(() => {}); } },
  clear() { liberar?.(); liberar = null; if (player) { player.pause(); player.srcObject = null; } },
};
