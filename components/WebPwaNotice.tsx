import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = 'https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net';

type Props = {
  corPrimaria: string;
};

type EstadoPermissao = 'default' | 'granted' | 'denied' | 'unsupported';

const getWindow = () => (globalThis as any).window;
const getNavigator = () => (globalThis as any).navigator;

const estaInstaladoComoApp = () => {
  const janela = getWindow();
  const navegador = getNavigator();

  return Boolean(
    janela?.matchMedia?.('(display-mode: standalone)').matches ||
      navegador?.standalone === true
  );
};

const suportaWebPush = () => {
  const janela = getWindow();
  const navegador = getNavigator();

  return Boolean(
    janela?.Notification &&
      navegador?.serviceWorker &&
      janela?.PushManager
  );
};

const ehAppleMovel = () => {
  const navegador = getNavigator();
  const userAgent = navegador?.userAgent || '';
  const plataforma = navegador?.platform || '';

  return /iPad|iPhone|iPod/.test(userAgent) ||
    (plataforma === 'MacIntel' && (navegador?.maxTouchPoints || 0) > 1);
};

const converterBase64UrlParaUint8Array = (base64Url: string) => {
  const preenchimento = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = `${base64Url}${preenchimento}`.replace(/-/g, '+').replace(/_/g, '/');
  const dados = getWindow().atob(base64);
  const saida = new Uint8Array(dados.length);

  for (let i = 0; i < dados.length; i += 1) {
    saida[i] = dados.charCodeAt(i);
  }

  return saida;
};

export default function WebPwaNotice({ corPrimaria }: Props) {
  const [appleMovel, setAppleMovel] = useState(false);
  const [instalado, setInstalado] = useState(false);
  const [permissao, setPermissao] = useState<EstadoPermissao>('unsupported');
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const janela = getWindow();
    setAppleMovel(ehAppleMovel());
    setInstalado(estaInstaladoComoApp());
    setPermissao(
      suportaWebPush() ? janela.Notification.permission : 'unsupported'
    );
  }, []);

  if (Platform.OS !== 'web') return null;
  if (!appleMovel) return null;
  if (permissao === 'granted') return null;

  const mostrarAjudaInstalacao = () => {
    Alert.alert(
      'Instalar no iPhone',
      'No Safari, toque em Compartilhar e depois em Adicionar a Tela de Inicio. Abra o MIL-LIN pelo icone criado para ativar notificacoes.'
    );
  };

  const ativarNotificacoes = async () => {
    const janela = getWindow();
    const navegador = getNavigator();

    if (!instalado) {
      mostrarAjudaInstalacao();
      return;
    }

    if (!suportaWebPush()) {
      setPermissao('unsupported');
      setMensagem('Este navegador ainda nao liberou notificacoes para o app instalado.');
      return;
    }

    setCarregando(true);
    setMensagem('');

    try {
      const token = await AsyncStorage.getItem('tokenMotorista');

      if (!token) {
        setMensagem('Entre novamente para vincular as notificacoes ao motorista.');
        return;
      }

      const respostaChave = await fetch(`${API_BASE}/api/Motorista/web-push-public-key`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!respostaChave.ok) {
        setMensagem('O servidor ainda nao esta pronto para notificacoes no iPhone.');
        return;
      }

      const configuracao = await respostaChave.json();
      const chavePublica = configuracao?.publicKey;

      if (!chavePublica) {
        setMensagem('Falta configurar a chave Web Push no servidor.');
        return;
      }

      const novaPermissao = await janela.Notification.requestPermission();
      setPermissao(novaPermissao);

      if (novaPermissao !== 'granted') {
        setMensagem('Permissao de notificacao nao concedida.');
        return;
      }

      const registro = await navegador.serviceWorker.ready;
      const inscricaoExistente = await registro.pushManager.getSubscription();
      const inscricao = inscricaoExistente || await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: converterBase64UrlParaUint8Array(chavePublica),
      });

      const resposta = await fetch(`${API_BASE}/api/Motorista/web-push-subscription`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...inscricao.toJSON(),
          userAgent: navegador.userAgent || '',
        }),
      });

      if (!resposta.ok) {
        setMensagem('A permissao foi concedida, mas o servidor nao salvou o aparelho.');
        return;
      }

      setPermissao('granted');
      Alert.alert('Tudo certo', 'Notificacoes ativadas neste iPhone.');
    } catch (erro) {
      setMensagem('Nao foi possivel ativar notificacoes agora.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.faixa, { borderLeftColor: corPrimaria }]}>
        <Text style={styles.titulo}>iPhone</Text>
        <Text style={styles.texto}>
          {instalado
            ? 'Ative notificacoes para receber chamadas fora do Safari.'
            : 'Instale na Tela de Inicio para abrir junto com os apps.'}
        </Text>
        {mensagem ? <Text style={styles.mensagem}>{mensagem}</Text> : null}
        <View style={styles.acoes}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.botaoPrimario, { backgroundColor: corPrimaria }]}
            onPress={instalado ? ativarNotificacoes : mostrarAjudaInstalacao}
            disabled={carregando}
          >
            <Text style={styles.textoBotaoPrimario}>
              {carregando ? 'ATIVANDO...' : instalado ? 'ATIVAR NOTIFICACOES' : 'INSTALAR'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 18,
  },
  faixa: {
    width: '100%',
    backgroundColor: '#f8fafc',
    borderLeftWidth: 5,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  titulo: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1f2937',
    textTransform: 'uppercase',
  },
  texto: {
    marginTop: 5,
    fontSize: 14,
    lineHeight: 19,
    color: '#374151',
    fontWeight: '600',
  },
  mensagem: {
    marginTop: 8,
    fontSize: 12,
    color: '#b45309',
    fontWeight: '700',
  },
  acoes: {
    marginTop: 12,
    flexDirection: 'row',
  },
  botaoPrimario: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoBotaoPrimario: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
});
