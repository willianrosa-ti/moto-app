import { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

const API_BASE = 'https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net';

// ==========================================
// LOGO MIL-LIN USADA NO LOGIN E CARREGAMENTO
// ==========================================
const SimboloMilLin = ({ escuro = false }: { escuro?: boolean }) => (
  <View style={milLinStyles.containerLogo}>
    <View
      style={[
        milLinStyles.notebookTela,
        escuro ? milLinStyles.logoEscura : milLinStyles.logoClara,
      ]}
    />

    <View
      style={[
        milLinStyles.notebookBase,
        escuro ? milLinStyles.logoEscura : milLinStyles.logoClara,
      ]}
    />
  </View>
);

export default function LoginMotorista() {
  const router = useRouter();

  const [telefone, setTelefone] = useState('');
  const [placa, setPlaca] = useState('');
  const [senha, setSenha] = useState('');

  const [manterConectado, setManterConectado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [processandoAcesso, setProcessandoAcesso] = useState(false);

  useEffect(() => {
    const verificarLoginSalvo = async () => {
      try {
        const token = await AsyncStorage.getItem('tokenMotorista');
        const manter = await AsyncStorage.getItem('manterConectadoMotorista');

        if (token && manter === 'true') {
          router.replace('/radar' as any);
        }
      } catch (erro) {
        console.error('Erro ao verificar login salvo:', erro);
      }
    };

    verificarLoginSalvo();
  }, [router]);

  const salvarDadosDaAgencia = async (dados: any) => {
    const agencia = dados?.agencia;

    await AsyncStorage.setItem('nomeAgencia', agencia?.nome || 'Agência');
    await AsyncStorage.setItem('corAgenciaPrimaria', agencia?.corPrimaria || '#1f2937');
    await AsyncStorage.setItem('corAgenciaSecundaria', agencia?.corSecundaria || '#38bdf8');
    await AsyncStorage.setItem('logoAgencia', agencia?.logoUrl || '');
    await AsyncStorage.setItem('telefoneAgencia', agencia?.telefoneWhatsApp || '');
  };

  const handleLogin = async () => {
    if (!telefone.trim() || !placa.trim() || !senha.trim()) {
      Alert.alert('Aviso', 'Preencha telefone, placa e senha.');
      return;
    }

    setCarregando(true);

    try {
      const resposta = await fetch(`${API_BASE}/api/Autenticacao/LoginMotorista`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone: telefone.trim(),
          placaMoto: placa.trim().toUpperCase(),
          senha: senha,
        }),
      });

      const textoPuro = await resposta.text();

      let dados: any = null;

      try {
        dados = textoPuro ? JSON.parse(textoPuro) : null;
      } catch {
        dados = null;
      }

      if (!resposta.ok) {
        const mensagemErro =
          dados?.mensagem ||
          textoPuro ||
          'Não foi possível realizar o login. Tente novamente.';

        Alert.alert(`Erro ${resposta.status}`, mensagemErro);
        setCarregando(false);
        return;
      }

      if (!dados?.token || !dados?.motorista) {
        Alert.alert(
          'Erro no login',
          'A resposta do servidor veio incompleta. Verifique a API.'
        );
        setCarregando(false);
        return;
      }

      await AsyncStorage.setItem('tokenMotorista', dados.token);
      await AsyncStorage.setItem('nomeMotorista', dados.motorista.nome || '');
      await AsyncStorage.setItem('idMotorista', String(dados.motorista.id));
      await AsyncStorage.setItem(
        'manterConectadoMotorista',
        manterConectado ? 'true' : 'false'
      );

      await salvarDadosDaAgencia(dados);

      setCarregando(false);
      setProcessandoAcesso(true);

      setTimeout(() => {
        setProcessandoAcesso(false);
        router.replace('/radar' as any);
      }, 1500);
    } catch (erro) {
      console.error('Erro na comunicação:', erro);
      Alert.alert(
        'Sem conexão',
        'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.'
      );
      setCarregando(false);
    }
  };

  // ==========================================
  // TELA DE CARREGAMENTO MIL-LIN
  // ==========================================
  if (processandoAcesso) {
    return (
      <SafeAreaView
        style={milLinStyles.telaCarregamento}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <StatusBar backgroundColor="#1f2937" barStyle="light-content" />

        <Text style={milLinStyles.tituloMilLinBranco}>M I L - L I N</Text>

        <SimboloMilLin />

        <Text style={milLinStyles.textoCarregando}>C A R R E G A N D O...</Text>
      </SafeAreaView>
    );
  }

  // ==========================================
  // LOGIN NEUTRO DA MIL-LIN
  // ==========================================
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar backgroundColor="#1f2937" barStyle="light-content" />

      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.logoArea}>
            <SimboloMilLin escuro />
          </View>

          <Text style={styles.milLinName}>M I L - L I N</Text>
          <Text style={styles.agencySubtitle}>Área do Mototaxista</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Seu telefone</Text>
            <TextInput
              style={styles.inputField}
              placeholder="(00) 00000-0000"
              placeholderTextColor="#9ca3af"
              value={telefone}
              onChangeText={setTelefone}
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Placa da moto</Text>
            <TextInput
              style={styles.inputField}
              placeholder="ABC-1234"
              placeholderTextColor="#9ca3af"
              value={placa}
              onChangeText={(texto) => setPlaca(texto.toUpperCase())}
              autoCapitalize="characters"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Senha</Text>
            <TextInput
              style={styles.inputField}
              placeholder="Digite sua senha"
              placeholderTextColor="#9ca3af"
              value={senha}
              onChangeText={setSenha}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={styles.caixaLembrarMe}
            activeOpacity={0.7}
            onPress={() => setManterConectado(!manterConectado)}
          >
            <Ionicons
              name={manterConectado ? 'checkbox' : 'square-outline'}
              size={24}
              color="#38bdf8"
            />
            <Text style={styles.textoLembrarMe}>Manter-me conectado</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, carregando && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={carregando}
          >
            {carregando ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>ENTRAR</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.rodape}>Sistema conectado à sua agência</Text>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ==========================================
// ESTILOS DA TELA DE LOGIN
// ==========================================
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fcfcfc',
  },

  container: {
    flex: 1,
    backgroundColor: '#fcfcfc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },

  card: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },

  header: {
    alignItems: 'center',
    marginBottom: 30,
  },

  logoArea: {
    width: 104,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  milLinName: {
    fontSize: 28,
    fontWeight: '900',
    color: '#1f2937',
    letterSpacing: 2,
    marginTop: 4,
  },

  agencySubtitle: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 4,
    fontWeight: '700',
  },

  form: {
    width: '100%',
  },

  inputGroup: {
    width: '100%',
    marginBottom: 20,
    position: 'relative',
  },

  inputLabel: {
    position: 'absolute',
    top: -10,
    left: 12,
    backgroundColor: '#ffffff',
    paddingHorizontal: 6,
    fontSize: 12,
    fontWeight: 'bold',
    color: '#4b5563',
    zIndex: 1,
  },

  inputField: {
    width: '100%',
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1f2937',
    backgroundColor: '#ffffff',
  },

  caixaLembrarMe: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: -5,
  },

  textoLembrarMe: {
    marginLeft: 8,
    fontSize: 14,
    color: '#4b5563',
    fontWeight: 'bold',
  },

  button: {
    backgroundColor: '#1f2937',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },

  buttonDisabled: {
    opacity: 0.75,
  },

  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  rodape: {
    marginTop: 22,
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
});

// ==========================================
// ESTILOS DA LOGO E CARREGAMENTO MIL-LIN
// ==========================================
const milLinStyles = StyleSheet.create({
  telaCarregamento: {
    flex: 1,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },

  tituloMilLinBranco: {
    fontSize: 36,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
    marginBottom: 28,
  },

  textoCarregando: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#e5e7eb',
    letterSpacing: 3,
    marginTop: 34,
  },

  containerLogo: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  notebookTela: {
    width: 100,
    height: 50,
    borderRadius: 8,
    marginTop: 0,
    marginHorizontal: 0,
    shadowOffset: { width: 1, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 13,
    elevation: 5,
  },

  notebookBase: {
    width: 108,
    height: 15,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 100,
    borderBottomRightRadius: 0,
    borderBottomLeftRadius: 100,
    marginLeft: 10,
    marginTop: 1,
    marginBottom: 15,
    shadowOffset: { width: 3, height: 11 },
    shadowOpacity: 0.8,
    shadowRadius: 11,
    elevation: 10,
  },

  logoClara: {
    backgroundColor: '#ffffff',
    shadowColor: '#dbeafe',
  },

  logoEscura: {
    backgroundColor: '#1f2937',
    shadowColor: '#93c5fd',
  },
});
