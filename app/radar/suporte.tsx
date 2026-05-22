import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking, ScrollView, TextInput, StatusBar, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';

const API_BASE = 'https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net';

const COR_PRIMARIA_PADRAO = '#28a745';
const COR_SECUNDARIA_PADRAO = '#00c853';
const TELEFONE_AGENCIA_PADRAO = '+5500000000000';

type TemaAgencia = {
  nome: string;
  corPrimaria: string;
  corSecundaria: string;
  telefone: string;
};

const TEMA_AGENCIA_PADRAO: TemaAgencia = {
  nome: 'Agência',
  corPrimaria: COR_PRIMARIA_PADRAO,
  corSecundaria: COR_SECUNDARIA_PADRAO,
  telefone: TELEFONE_AGENCIA_PADRAO,
};

const ERROS_COMUNS = [
  'GPS não atualiza a localização',
  'Não estou recebendo corridas',
  'Problema ao finalizar uma corrida',
  'O aplicativo está travando/fechando',
  'Problema financeiro / Pagamento',
  'Outra opção'
];

export default function SuporteTecnico() {
  const navegar = useRouter();

  const [erroSelecionado, setErroSelecionado] = useState<string>('');
  const [textoOutroErro, setTextoOutroErro] = useState<string>('');
  const [enviando, setEnviando] = useState(false);
  const [temaAgencia, setTemaAgencia] = useState<TemaAgencia>(TEMA_AGENCIA_PADRAO);


  const carregarTemaAgenciaSalvo = async () => {
    try {
      const [nome, corPrimaria, corSecundaria, telefone] = await Promise.all([
        AsyncStorage.getItem('nomeAgencia'),
        AsyncStorage.getItem('corAgenciaPrimaria'),
        AsyncStorage.getItem('corAgenciaSecundaria'),
        AsyncStorage.getItem('telefoneAgencia'),
      ]);

      setTemaAgencia({
        nome: nome?.trim() || TEMA_AGENCIA_PADRAO.nome,
        corPrimaria: corPrimaria?.trim() || TEMA_AGENCIA_PADRAO.corPrimaria,
        corSecundaria: corSecundaria?.trim() || TEMA_AGENCIA_PADRAO.corSecundaria,
        telefone: telefone?.trim() || TEMA_AGENCIA_PADRAO.telefone,
      });
    } catch (erro) {
      console.log('Erro ao carregar identidade visual da agência:', erro);
    }
  };

  useEffect(() => {
    carregarTemaAgenciaSalvo();
  }, []);

  const enviarProblemaParaAgencia = async () => {
    if (!erroSelecionado) {
      Alert.alert('Atenção', 'Por favor, selecione qual problema está enfrentando.');
      return;
    }

    if (erroSelecionado === 'Outra opção' && textoOutroErro.trim() === '') {
      Alert.alert('Atenção', 'Por favor, descreva rapidamente o seu problema.');
      return;
    }

    try {
      setEnviando(true);

      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) {
        Alert.alert('Acesso expirado', 'Faça login novamente para enviar uma mensagem à agência.');
        navegar.replace('/' as any);
        return;
      }

      const resposta = await fetch(`${API_BASE}/api/Suporte/enviar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          tipoProblema: erroSelecionado,
          descricao: erroSelecionado === 'Outra opção' ? textoOutroErro.trim() : textoOutroErro.trim()
        })
      });

      const textoResposta = await resposta.text();

      if (!resposta.ok) {
        let mensagemErro = textoResposta;

        try {
          const jsonErro = JSON.parse(textoResposta);
          mensagemErro = jsonErro.mensagem || textoResposta;
        } catch {
          // Mantém o texto puro caso a API não devolva JSON.
        }

        Alert.alert(`Erro ${resposta.status}`, mensagemErro || 'Não foi possível enviar sua mensagem.');
        return;
      }

      Alert.alert(
        'Enviado!',
        'Sua notificação foi enviada para a agência. Assim que houver uma resposta, ela aparecerá em Notificações da Agência.'
      );

      setErroSelecionado('');
      setTextoOutroErro('');
    } catch (erro) {
      console.log('Erro ao enviar suporte:', erro);
      Alert.alert('Sem conexão', 'Não foi possível conectar ao servidor da Azure.');
    } finally {
      setEnviando(false);
    }
  };

  const acionarContatoAgencia = (tipo: 'ligar' | 'whatsapp') => {
    const numeroAgencia = temaAgencia.telefone || TELEFONE_AGENCIA_PADRAO;

    if (tipo === 'ligar') {
      Linking.openURL(`tel:${numeroAgencia}`);
    } else {
      Linking.openURL(
        `whatsapp://send?phone=${numeroAgencia}&text=Olá, sou motorista e preciso de ajuda no app.`
      );
    }
  };

  const acionarSuporteMilLin = () => {
    Linking.openURL(
      'whatsapp://send?phone=+5544997740967&text=Olá suporte MIL-LIN. Preciso de ajuda técnica com o app do motorista.'
    );
  };

  return (
    <SafeAreaView style={styles.telaSuporte} edges={['top', 'left', 'right']}>
      <StatusBar backgroundColor={temaAgencia.corPrimaria} barStyle="light-content" />

      <View style={[styles.cabecalho, { backgroundColor: temaAgencia.corPrimaria }]}>
        <TouchableOpacity style={styles.botaoVoltar} onPress={() => navegar.back()}>
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.tituloCabecalho}>SUPORTE TÉCNICO</Text>

        <View style={styles.espacadorCabecalho} />
      </View>

      <ScrollView style={styles.conteudoSuporte} contentContainerStyle={styles.conteudoScroll}>
        <View style={styles.blocoSuporte}>
          <Text style={styles.tituloSecaoSuporte}>Qual problema você está enfrentando?</Text>

          {ERROS_COMUNS.map((erro, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.opcaoErro, erroSelecionado === erro && styles.opcaoErroSelecionada, erroSelecionado === erro && { backgroundColor: `${temaAgencia.corPrimaria}12` }]}
              onPress={() => setErroSelecionado(erro)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={erroSelecionado === erro ? 'radio-button-on' : 'radio-button-off'}
                size={24}
                color={erroSelecionado === erro ? temaAgencia.corPrimaria : '#888'}
              />

              <Text style={[styles.textoOpcaoErro, erroSelecionado === erro && styles.textoOpcaoErroAtivo, erroSelecionado === erro && { color: temaAgencia.corPrimaria }]}>
                {erro}
              </Text>
            </TouchableOpacity>
          ))}

          {erroSelecionado === 'Outra opção' && (
            <TextInput
              style={styles.inputOutroErro}
              placeholder="Descreva brevemente o problema..."
              placeholderTextColor="#999"
              value={textoOutroErro}
              onChangeText={setTextoOutroErro}
              multiline={true}
              maxLength={150}
            />
          )}

          <TouchableOpacity
            style={[styles.btnEnviarAgencia, { backgroundColor: temaAgencia.corPrimaria }, enviando && styles.btnDesabilitado]}
            onPress={enviarProblemaParaAgencia}
            activeOpacity={0.85}
            disabled={enviando}
          >
            {enviando ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="paper-plane-outline" size={20} color="#fff" />
                <Text style={styles.btnTextoBrancoModal}>Notificar Agência do Problema</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.divisorSuporte} />

        <View style={styles.blocoSuporte}>
          <Text style={styles.tituloSecaoSuporte}>Falar diretamente com a Agência</Text>

          <View style={styles.linhaBotoesContato}>
            <TouchableOpacity
              style={styles.btnContatoAgenciaLigar}
              onPress={() => acionarContatoAgencia('ligar')}
              activeOpacity={0.85}
            >
              <Ionicons name="call" size={20} color="#fff" />
              <Text style={styles.btnTextoBrancoModal}>Ligar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnContatoAgenciaWpp}
              onPress={() => acionarContatoAgencia('whatsapp')}
              activeOpacity={0.85}
            >
              <Ionicons name="logo-whatsapp" size={20} color="#fff" />
              <Text style={styles.btnTextoBrancoModal}>Mensagem</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.blocoSuporte}>
          <Text style={styles.tituloSecaoSuporte}>Suporte de TI / Sistema</Text>
          <Text style={styles.textoAjudaTi}>- Para problemas no sistema ou falhas técnicas estruturais.</Text>
          <Text style={styles.textoAjudaTi}>- Deseja adquirir algum de nossos produtos.</Text>

          <TouchableOpacity style={styles.btnContatoMilLin} onPress={acionarSuporteMilLin} activeOpacity={0.85}>
            <Ionicons name="logo-whatsapp" size={20} color="#fff" />
            <Text style={styles.btnTextoBrancoModal}>Falar com a MIL-LIN</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  telaSuporte: {
    flex: 1,
    backgroundColor: '#f9f9f9',
  },
  cabecalho: {
    backgroundColor: '#28a745',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 15,
    elevation: 4,
  },
  botaoVoltar: {
    padding: 5,
  },
  tituloCabecalho: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  espacadorCabecalho: {
    width: 38,
  },
  conteudoSuporte: {
    flex: 1,
    padding: 20,
  },
  conteudoScroll: {
    paddingBottom: 40,
  },
  blocoSuporte: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#eee',
  },
  tituloSecaoSuporte: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  opcaoErro: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f4f4f4',
  },
  opcaoErroSelecionada: {
    backgroundColor: '#f0fff4',
  },
  textoOpcaoErro: {
    fontSize: 15,
    color: '#555',
    marginLeft: 10,
    flex: 1,
  },
  textoOpcaoErroAtivo: {
    color: '#28a745',
    fontWeight: 'bold',
  },
  inputOutroErro: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#333',
    marginTop: 10,
    height: 80,
    textAlignVertical: 'top',
    backgroundColor: '#fdfdfd',
  },
  btnEnviarAgencia: {
    flexDirection: 'row',
    backgroundColor: '#28a745',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 10,
  },
  btnDesabilitado: {
    opacity: 0.7,
  },
  divisorSuporte: {
    height: 1,
    backgroundColor: '#ddd',
    marginVertical: 5,
  },
  linhaBotoesContato: {
    flexDirection: 'row',
    gap: 10,
  },
  btnContatoAgenciaLigar: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#007bff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnContatoAgenciaWpp: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#25D366',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  textoAjudaTi: {
    fontSize: 13,
    color: '#666',
    marginBottom: 15,
  },
  btnContatoMilLin: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  btnTextoBrancoModal: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
