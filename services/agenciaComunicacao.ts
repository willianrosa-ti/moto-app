import { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Agência "somente comunicação" (rádio, áudio e texto): o radar guarda no aparelho e avisa quando muda.
export function avisarAgenciaComunicacao(valor: boolean) {
  AsyncStorage.setItem('agenciaComunicacao', String(valor)).catch(() => {});
  DeviceEventEmitter.emit('agenciaComunicacao', valor);
}

export function useAgenciaComunicacao() {
  const [comunicacao, setComunicacao] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('agenciaComunicacao').then(v => setComunicacao(v === 'true')).catch(() => {});
    const sub = DeviceEventEmitter.addListener('agenciaComunicacao', (v: boolean) => setComunicacao(!!v));
    return () => sub.remove();
  }, []);
  return comunicacao;
}
