import { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage'; // <-- A nova memória do celular!
import { Ionicons } from '@expo/vector-icons'; // <-- Ícones para a caixinha
import { useRouter } from 'expo-router'; // <-- Ferramenta para trocar de tela

export default function App() {
  const navegar = useRouter();
  const [telefone, setTelefone] = useState('');
  const [placa, setPlaca] = useState('');
  const [senha, setSenha] = useState('');
  
  // NOVOS ESTADOS: Caixinha de manter logado e indicador de carregamento
  const [manterConectado, setManterConectado] = useState(false);
  const [carregando, setCarregando] = useState(false);

  // O RADAR AUTOMÁTICO: Roda toda vez que o app é aberto
  useEffect(() => {
    const verificarLoginSalvo = async () => {
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (token) {
        // Se achou o crachá na memória, pula direto para a página do radar!
        navegar.replace('/radar'); // Troque '/radar' pelo nome exato do seu arquivo da próxima tela se necessário
      }
    };
    verificarLoginSalvo();
  }, []);

  const handleLogin = async () => {
    // Validação básica para não mandar vazio
    if (!telefone || !placa || !senha) {
      Alert.alert("Aviso", "Preencha todos os campos!");
      return;
    }

    setCarregando(true);

    try {
      // 1. Chamando a sua API no C# usando o link do Azure
      const resposta = await fetch('https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net/api/Autenticacao/login-motorista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            telefone: telefone, 
            placaMoto: placa, 
            senha: senha,
            lembrarMe: manterConectado // <-- Avisa a API se é para durar 30 dias ou 8 horas
        })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        // 2. Deu certo! Salvamos o Token e os dados na memória do celular
        await AsyncStorage.setItem('tokenMotorista', dados.token);
        await AsyncStorage.setItem('nomeMotorista', dados.motorista.nome);
        await AsyncStorage.setItem('idMotorista', dados.motorista.id.toString());
        
        // 3. Pula a etapa do login e vai direto para o radar
        Alert.alert("Sucesso!", `Bem-vindo(a), ${dados.motorista.nome}!`);
        navegar.replace('/radar'); 
      } else {
        // Erro de senha ou usuário retornado pela sua API
        Alert.alert("Erro ao entrar", dados.mensagem);
      }
    } catch (erro) {
      console.error("Erro na comunicação:", erro);
      Alert.alert("Sem Conexão", "Não foi possível conectar ao servidor. A sua API em C# está ligada?");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        
        {/* CABEÇALHO */}
        <View style={styles.header}>
          <View style={styles.logoBox}>
            <Text style={styles.logoLetter}>T</Text>
          </View>
          <Text style={styles.agencyName}>MOTO-THALES</Text>
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
              placeholder="••••••••"
              value={senha}
              onChangeText={setSenha}
              secureTextEntry={true} 
            />
          </View>

          {/* NOVA CAIXINHA: MANTER-ME CONECTADO */}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#28a745', 
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: 350,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10, 
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBox: {
    backgroundColor: '#28a745',
    width: 70,
    height: 70,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoLetter: {
    color: '#ffffff',
    fontSize: 36,
    fontWeight: 'bold',
  },
  agencyName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  agencySubtitle: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  button: {
    backgroundColor: '#28a745',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  // ESTILOS ADICIONADOS PARA A CAIXINHA
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
  }
});