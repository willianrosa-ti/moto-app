import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } from 'react-native-webrtc';
import { reservarMicrofone } from './audioFocus';
import AppOverlay from '../../native/AppOverlay';
let liberar: (() => void) | null = null;
export const radioMedia = {
  async microphone() {
    liberar = reservarMicrofone('radio');
    try { await AppOverlay.startRadioAudio(); return await mediaDevices.getUserMedia({ audio: true, video: false }); }
    catch (e) { liberar?.(); liberar = null; AppOverlay.stopRadioAudio().catch(() => {}); throw e; }
  },
  peer: (config: ConstructorParameters<typeof RTCPeerConnection>[0]) => new RTCPeerConnection(config),
  candidate: (data: ConstructorParameters<typeof RTCIceCandidate>[0]) => new RTCIceCandidate(data),
  description: (data: ConstructorParameters<typeof RTCSessionDescription>[0]) => new RTCSessionDescription(data),
  remote() { /* WebRTC nativo reproduz a faixa remota. */ },
  clear() { liberar?.(); liberar = null; AppOverlay.stopRadioAudio().catch(() => {}); },
};
