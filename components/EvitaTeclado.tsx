import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

// Sobe o conteúdo quando o teclado abre, para o campo de digitação nunca ficar escondido.
// Mede a posição real na tela (o KeyboardAvoidingView usa a posição dentro do bloco de cima e, abaixo do
// cabeçalho e da barra de status, deixava o teclado cobrindo o que se escreve).
export default function EvitaTeclado({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const caixa = useRef<View>(null);
  const [espaco, setEspaco] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const abriu = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', evento => {
      const topoTeclado = evento.endCoordinates.screenY;
      caixa.current?.measureInWindow((_x, y, _largura, altura) => setEspaco(Math.max(0, Math.round(y + altura - topoTeclado))));
    });
    const fechou = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setEspaco(0));
    return () => { abriu.remove(); fechou.remove(); };
  }, []);
  return <View ref={caixa} style={[style, { paddingBottom: espaco }]}>{children}</View>;
}
