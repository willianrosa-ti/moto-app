import React from 'react';
import { View, type ViewStyle } from 'react-native';

// Ícone do rádio (comunicador), o mesmo desenho do painel da agência: corpo arredondado, duas antenas,
// as linhas do alto-falante e as ondas de sinal dos lados. Desenhado numa grade de 24 × 24.
export default function IconeRadio({ tamanho = 24, cor = '#047857' }: { tamanho?: number; cor?: string }) {
  const u = tamanho / 24;
  const traco = Math.max(1.5, 1.8 * u);
  const peca = (estilo: ViewStyle) => <View style={[{ position: 'absolute', backgroundColor: cor, borderRadius: traco / 2 }, estilo]} />;
  // Ondas de sinal: traços curtos na altura das antenas, um de cada lado.
  const onda = (lado: 'esquerda' | 'direita') =>
    peca({ top: 3 * u, width: traco, height: 4 * u, ...(lado === 'esquerda' ? { left: 2.8 * u - traco / 2 } : { right: 2.8 * u - traco / 2 }) });
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: tamanho, height: tamanho }}>
      {/* Antenas (a da esquerda maior) */}
      {peca({ left: 9 * u - traco / 2, top: 3 * u, width: traco, height: 5.5 * u })}
      {peca({ left: 15 * u - traco / 2, top: 6 * u, width: traco, height: 2.5 * u })}
      {/* Corpo */}
      <View style={{ position: 'absolute', left: 6 * u - traco / 2, top: 8 * u - traco / 2, width: 12 * u + traco, height: 13 * u + traco,
        borderRadius: 3.4 * u, borderWidth: traco, borderColor: cor }} />
      {/* Alto-falante */}
      {peca({ left: 9 * u, top: 12 * u - traco / 2, width: 6 * u, height: traco })}
      {peca({ left: 9 * u, top: 16 * u - traco / 2, width: 6 * u, height: traco })}
      {onda('esquerda')}
      {onda('direita')}
    </View>
  );
}
