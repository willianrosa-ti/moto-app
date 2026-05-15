import { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ActivityIndicator, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage'; 
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons'; 

// --- SÍMBOLO MIL-LIN (Re criado em CSS) ---
// --- SÍMBOLO MIL-LIN (Notebook CSS traduzido para React Native) ---
const SimboloMilLin = () => (
  <View style={milLinStyles.containerLogo}>
    {/* Parte de Cima do Notebook (Tela) */}
    <View style={milLinStyles.notebookTela} />
    
    {/* Parte de Baixo do Notebook (Teclado/Base) */}
    <View style={milLinStyles.notebookBase} />
  </View>
);

export default function App() {
  const router = useRouter();
  const [telefone, setTelefone] = useState('');
  const [placa, setPlaca] = useState('');
  const [senha, setSenha] = useState('');
  
  const [manterConectado, setManterConectado] = useState(false);
  const [carregando, setCarregando] = useState(false); // Rodinha no botão

  // NOVO ESTADO: Controla a tela de carregamento da sua empresa
  const [processandoAcesso, setProcessandoAcesso] = useState(false);

  // O RADAR AUTOMÁTICO: Roda toda vez que o app é aberto
  useEffect(() => {
    const verificarLoginSalvo = async () => {
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (token) {
        // Se já está logado, pulamos o login e vamos pro radar
        router.replace('/radar' as any); 
      }
    };
    verificarLoginSalvo();
  }, []);

  const handleLogin = async () => {
    if (!telefone || !placa || !senha) {
      Alert.alert("Aviso", "Preencha todos os campos!");
      return;
    }

    setCarregando(true); // Gira a rodinha do botão

    try {
      // 1. Chamando a sua API no C# usando o link do Azure
      const resposta = await fetch('https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net/api/Autenticacao/login-motorista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            telefone: telefone, 
            placaMoto: placa, 
            senha: senha,
            lembrarMe: manterConectado 
        })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        // 2. Deu certo! Salvamos o Token e os dados na memória do celular
        await AsyncStorage.setItem('tokenMotorista', dados.token);
        await AsyncStorage.setItem('nomeMotorista', dados.motorista.nome);
        await AsyncStorage.setItem('idMotorista', dados.motorista.id.toString());
        
        // --- 3. LÓGICA DO SÍMBOLO MIL-LIN ---
        setCarregando(false); // Para a rodinha do botão
        setProcessandoAcesso(true); // Mostra a tela de carregamento da MIL-LIN

        // Espera 2.5 segundos para o motorista ver o símbolo e depois muda de tela
        setTimeout(() => {
            setProcessandoAcesso(false); // Esconde a tela MIL-LIN
            router.replace('/radar' as any); // Pula pro radar
        }, 1500);

      } else {
        Alert.alert("Erro ao entrar", dados.mensagem);
      }
    } catch (erro) {
      console.error("Erro na comunicação:", erro);
      Alert.alert("Sem Conexão", "Não foi possível conectar ao servidor.");
    } finally {
      // Se deu erro, paramos o carregamento do botão aqui. 
      // Se deu sucesso, o finally roda antes do setTimeout, por isso setamos 'false' ali em cima também por garantia visual.
      if (!processandoAcesso) setCarregando(false); 
    }
  };

  // ==========================================
  // --- RENDERIZAÇÃO DA TELA DE CARREGAMENTO MIL-LIN ---
  // ==========================================
  if (processandoAcesso) {
    return (
      <View style={milLinStyles.telaCarregamento}>
        <StatusBar backgroundColor="#fff" barStyle="dark-content" />
        
        {/* Logo em branco "MIL-LIN" (como você pediu, em branco em cima do notebook) */}
        <Text style={milLinStyles.tituloMilLinBranco}>M I L - L I N</Text>
        
        {/* Recriação do Símbolo em CSS */}
        <SimboloMilLin />
        
        {/* Texto "CARREGANDO..." em baixo */}
        <Text style={milLinStyles.textoCarregando}>C  A  R  R  E  G  A  N  D  O...</Text>
      </View>
    );
  }

  // ==========================================
  // --- TELA DE LOGIN ORIGINAL (Minuciosamente Igual) ---
  // ==========================================
  return (
    <View style={styles.container}>
        <StatusBar backgroundColor="#28a745" barStyle="light-content" />
      <View style={styles.card}>
        
        {/* CABEÇALHO */}
        <View style={styles.header}>
          <View style={styles.logoBox}>
            <Text style={styles.logoLetter}>T</Text>
          </View>
          <Text style={styles.agencyName}>MOTO-TAXI THALES</Text>
          <Text style={styles.agencySubtitle}>Área do Mototaxista</Text>
        </View>

        {/* FORMULÁRIO */}
        <View style={styles.form}>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Seu Telefone</Text>
            <TextInput 
              style={styles.inputField}
              placeholder="(00) 00000-0000"
              value={telefone}
              onChangeText={setTelefone}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Placa da Moto</Text>
            <TextInput 
              style={styles.inputField}
              placeholder="ABC-1234"
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
              value={senha}
              onChangeText={setSenha}
              secureTextEntry={true} 
            />
          </View>

          <TouchableOpacity 
            style={styles.caixaLembrarMe} 
            activeOpacity={0.7}
            onPress={() => setManterConectado(!manterConectado)}
          >
            <Ionicons 
              name={manterConectado ? "checkbox" : "square-outline"} 
              size={24} 
              color="#28a745" 
            />
            <Text style={styles.textoLembrarMe}>Manter-me conectado</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={carregando}>
            {carregando ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>ENTRAR</Text>
            )}
          </TouchableOpacity>

        </View>
      </View>
    </View>
  );
}

// ==========================================
// --- ESTILOS ORIGINAIS (Minuciosamente Igual) ---
// ==========================================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#28a745', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#ffffff', width: '100%', maxWidth: 350, borderRadius: 24, padding: 32, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 10 },
  header: { alignItems: 'center', marginBottom: 32 },
  logoBox: { backgroundColor: '#28a745', width: 70, height: 70, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  logoLetter: { color: '#ffffff', fontSize: 36, fontWeight: 'bold' },
  agencyName: { fontSize: 24, fontWeight: 'bold', color: '#1f2937' },
  agencySubtitle: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 },
  form: { width: '100%' },
  inputGroup: { width: '100%', marginBottom: 20, position: 'relative' },
  inputLabel: { position: 'absolute', top: -10, left: 12, backgroundColor: '#ffffff', paddingHorizontal: 6, fontSize: 12, fontWeight: 'bold', color: '#4b5563', zIndex: 1 },
  inputField: { width: '100%', borderWidth: 2, borderColor: '#d1d5db', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, fontSize: 16, color: '#1f2937', backgroundColor: '#ffffff' },
  button: { backgroundColor: '#28a745', width: '100%', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  caixaLembrarMe: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, marginTop: -5 },
  textoLembrarMe: { marginLeft: 8, fontSize: 14, color: '#4b5563', fontWeight: 'bold' }
});

// ==========================================
// --- NOVOS ESTILOS DO SÍMBOLO MIL-LIN ---
// ==========================================
const milLinStyles = StyleSheet.create({
    telaCarregamento: {
        flex: 1,
        backgroundColor: '#1f2937', // Fundo azul para dar destaque ao notebook branco
        alignItems: 'center',
        justifyContent: 'center',
    },
    tituloMilLinBranco: {
        fontSize: 36,
        fontWeight: 'bold',
        color: '#ffffff', // Texto MIL-LIN em branco (em cima do notebook)
        letterSpacing: 2,
        marginBottom: 20, 
    },
    textoCarregando: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#e8f5e9', // Um branco/verde bem clarinho
        letterSpacing: 3, 
        marginTop: 280, // Espaço depois do notebook
    },
    containerLogo: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    // --- SEU CSS TRADUZIDO PARA O REACT NATIVE ---
    
    notebookTela: {
        width: 100,
        height: 50,
        backgroundColor: 'white',
        borderRadius: 8, // Equivalente aproximado aos 10%
        marginTop: 0,
        marginHorizontal: 0,
        // Sombras traduzidas
        shadowColor: 'rgba(214, 234, 248, 0.699)',
        shadowOffset: { width: 1, height: 1 },
        shadowOpacity: 1,
        shadowRadius: 13,
        elevation: 5, // Necessário para a sombra aparecer no Android
    },
    notebookBase: {
        width: 108,
        height: 15,
        backgroundColor: 'white',
        // border-radius: 0 100px 0 100px;
        borderTopLeftRadius: 0,
        borderTopRightRadius: 100,
        borderBottomRightRadius: 0,
        borderBottomLeftRadius: 100,
        marginLeft: 10,
        marginTop: 1,
        marginBottom: 15,
        // Sombras traduzidas
        shadowColor: '#1a1717',
        shadowOffset: { width: 3, height: 11 },
        shadowOpacity: 0.8,
        shadowRadius: 11,
        elevation: 10, // Necessário para a sombra aparecer no Android
    }
});