import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppOverlay from '@/native/AppOverlay';

const CHAVE_PERMISSAO_SOBREPOSICAO = 'permissaoSobreposicaoSolicitadaMotorista';

export default function NativeAppSetup() {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    let ativo = true;
    let abrindoConfiguracoes = false;

    async function configurarSobreposicao() {
      if (!ativo || abrindoConfiguracoes) return;

      try {
        const suporte = await AppOverlay.isSupported();
        if (!suporte.isSupported) return;

        const permissao = await AppOverlay.hasPermission();
        if (permissao.granted) {
          await AppOverlay.showOverlay('MIL-LIN');
          return;
        }

        const jaSolicitada = await AsyncStorage.getItem(CHAVE_PERMISSAO_SOBREPOSICAO);
        if (jaSolicitada) return;

        abrindoConfiguracoes = true;
        await AsyncStorage.setItem(CHAVE_PERMISSAO_SOBREPOSICAO, 'true');
        await AppOverlay.requestPermission();
        abrindoConfiguracoes = false;
      } catch (erro) {
        abrindoConfiguracoes = false;
        console.warn('[SOBREPOSICAO] Nao foi possivel configurar a sobreposicao:', erro);
      }
    }

    configurarSobreposicao();

    const assinatura = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') {
        configurarSobreposicao();
      }
    });

    return () => {
      ativo = false;
      assinatura.remove();
    };
  }, []);

  return null;
}
