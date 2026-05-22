import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, StatusBar, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';

const API_BASE = 'https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net';

const COR_PRIMARIA_PADRAO = '#28a745';
const COR_SECUNDARIA_PADRAO = '#00c853';

type TemaAgencia = {
  nome: string;
  corPrimaria: string;
  corSecundaria: string;
};

const TEMA_AGENCIA_PADRAO: TemaAgencia = {
  nome: 'Agência',
  corPrimaria: COR_PRIMARIA_PADRAO,
  corSecundaria: COR_SECUNDARIA_PADRAO,
};

type NotificacaoAgencia = {
  id: number;
  tipoProblema: string;
  descricao?: string | null;
  status: string;
  dataEnvio: string;
  respostaAgencia?: string | null;
  dataResposta?: string | null;
  lidaPeloMotorista: boolean;
};

export default function NotificacoesAgencia() {
  const navegar = useRouter();

  const [carregando, setCarregando] = useState(true);
  const [notificacoes, setNotificacoes] = useState<NotificacaoAgencia[]>([]);
  const [temaAgencia, setTemaAgencia] = useState<TemaAgencia>(TEMA_AGENCIA_PADRAO);


  const carregarTemaAgenciaSalvo = async () => {
    try {
      const [nome, corPrimaria, corSecundaria] = await Promise.all([
        AsyncStorage.getItem('nomeAgencia'),
        AsyncStorage.getItem('corAgenciaPrimaria'),
        AsyncStorage.getItem('corAgenciaSecundaria'),
      ]);

      setTemaAgencia({
        nome: nome?.trim() || TEMA_AGENCIA_PADRAO.nome,
        corPrimaria: corPrimaria?.trim() || TEMA_AGENCIA_PADRAO.corPrimaria,
        corSecundaria: corSecundaria?.trim() || TEMA_AGENCIA_PADRAO.corSecundaria,
      });
    } catch (erro) {
      console.log('Erro ao carregar identidade visual da agência:', erro);
    }
  };

  const formatarData = (valor?: string | null) => {
    if (!valor) return '';

    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return '';

    return data.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const marcarComoLidas = async (token: string) => {
    try {
      await fetch(`${API_BASE}/api/Suporte/marcar-lidas-motorista`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (erro) {
      console.log('Erro ao marcar notificações como lidas:', erro);
    }
  };

  const buscarNotificacoes = async () => {
    try {
      setCarregando(true);

      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) {
        Alert.alert('Acesso expirado', 'Faça login novamente para ver suas notificações.');
        navegar.replace('/' as any);
        return;
      }

      const resposta = await fetch(`${API_BASE}/api/Suporte/minhas-respostas`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (resposta.ok) {
        const dados = await resposta.json();
        const lista = Array.isArray(dados) ? dados : [];
        setNotificacoes(lista);

        if (lista.some((item: NotificacaoAgencia) => item.lidaPeloMotorista === false)) {
          await marcarComoLidas(token);
        }
      } else {
        const texto = await resposta.text();
        Alert.alert(`Erro ${resposta.status}`, texto || 'Não foi possível buscar as notificações.');
      }
    } catch (erro) {
      console.log('Erro ao buscar notificações:', erro);
      Alert.alert('Sem conexão', 'Não foi possível conectar ao servidor da Azure.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarTemaAgenciaSalvo();
    buscarNotificacoes();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar backgroundColor={temaAgencia.corPrimaria} barStyle="light-content" />

      <View style={[styles.cabecalho, { backgroundColor: temaAgencia.corPrimaria }]}>
        <TouchableOpacity style={styles.botaoVoltar} onPress={() => navegar.back()}>
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.tituloCabecalho}>NOTIFICAÇÕES</Text>

        <TouchableOpacity style={styles.botaoAtualizar} onPress={buscarNotificacoes}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {carregando ? (
        <View style={styles.areaCarregando}>
          <ActivityIndicator size="large" color={temaAgencia.corPrimaria} />
          <Text style={styles.textoCarregando}>Buscando respostas da agência...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.conteudo}>
          {notificacoes.length === 0 ? (
            <View style={styles.cardVazio}>
              <Ionicons name="notifications-off-outline" size={42} color="#999" />
              <Text style={styles.tituloVazio}>Nenhuma resposta da agência</Text>
              <Text style={styles.textoVazio}>Quando a agência responder uma solicitação de suporte, ela aparecerá aqui.</Text>
            </View>
          ) : (
            notificacoes.map((item) => (
              <View key={item.id} style={[styles.cardNotificacao, item.lidaPeloMotorista === false && styles.cardNaoLido, item.lidaPeloMotorista === false && { borderColor: temaAgencia.corPrimaria }]}>
                <View style={styles.linhaTopoCard}>
                  <View style={[styles.tagProblema, { backgroundColor: `${temaAgencia.corPrimaria}18` }]}>
                    <Text style={[styles.textoTagProblema, { color: temaAgencia.corPrimaria }]}>{item.tipoProblema}</Text>
                  </View>

                  {item.lidaPeloMotorista === false && (
                    <View style={styles.badgeNova}>
                      <Text style={styles.textoBadgeNova}>NOVA</Text>
                    </View>
                  )}
                </View>

                {!!item.descricao && (
                  <View style={styles.blocoDescricao}>
                    <Text style={styles.label}>Sua mensagem:</Text>
                    <Text style={styles.textoDescricao}>{item.descricao}</Text>
                  </View>
                )}

                <View style={[styles.blocoResposta, { borderLeftColor: temaAgencia.corPrimaria }]}>
                  <Text style={styles.label}>Resposta da agência:</Text>
                  <Text style={styles.textoResposta}>{item.respostaAgencia}</Text>
                </View>

                <Text style={styles.dataResposta}>Respondido em {formatarData(item.dataResposta)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f6fa',
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
  botaoAtualizar: {
    padding: 5,
  },
  tituloCabecalho: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  areaCarregando: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  textoCarregando: {
    color: '#666',
    fontWeight: 'bold',
  },
  conteudo: {
    padding: 16,
    paddingBottom: 40,
  },
  cardVazio: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 2,
    marginTop: 30,
  },
  tituloVazio: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  textoVazio: {
    marginTop: 8,
    textAlign: 'center',
    color: '#777',
    lineHeight: 20,
  },
  cardNotificacao: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    elevation: 2,
  },
  cardNaoLido: {
    borderColor: '#28a745',
    borderWidth: 2,
  },
  linhaTopoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  tagProblema: {
    backgroundColor: '#e8f5e9',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    flex: 1,
  },
  textoTagProblema: {
    color: '#28a745',
    fontWeight: 'bold',
    fontSize: 12,
  },
  badgeNova: {
    backgroundColor: '#dc3545',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  textoBadgeNova: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  blocoDescricao: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  blocoResposta: {
    backgroundColor: '#fff',
    borderLeftWidth: 4,
    borderLeftColor: '#28a745',
    paddingLeft: 10,
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    color: '#666',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  textoDescricao: {
    color: '#444',
    fontSize: 14,
    lineHeight: 20,
  },
  textoResposta: {
    color: '#222',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  dataResposta: {
    color: '#888',
    fontSize: 12,
    textAlign: 'right',
  },
});
