import React from 'react';
import { View } from 'react-native';

// Ícone do alerta (BIP BIP ALERTA): bola vermelha com "riscos vibrantes" dos dois lados, no lugar do sino.
export default function IconeAlerta({ tamanho = 24, cor = '#dc2626' }: { tamanho?: number; cor?: string }) {
  const bola = tamanho * 0.44;
  const arco = (altura: number, lado: 'esquerda' | 'direita') => (
    <View style={{
      width: altura / 2, height: altura, borderRadius: altura, borderWidth: Math.max(1.6, tamanho * 0.08),
      borderColor: 'transparent', [lado === 'esquerda' ? 'borderLeftColor' : 'borderRightColor']: cor,
    }} />
  );
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: tamanho, gap: tamanho * 0.04 }}>
      {arco(tamanho, 'esquerda')}
      {arco(tamanho * 0.66, 'esquerda')}
      <View style={{ width: bola, height: bola, borderRadius: bola / 2, backgroundColor: cor, marginHorizontal: tamanho * 0.06 }} />
      {arco(tamanho * 0.66, 'direita')}
      {arco(tamanho, 'direita')}
    </View>
  );
}
