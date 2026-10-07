import { motoristaFetch } from '../../services/motoristaApi';
import { buscarAvisos, observarAvisos, type AvisoMotorista } from '../../services/avisos';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, StatusBar, Alert, Platform, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

const API_BASE = 'https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net';
const VERSAO_APP_MOTORISTA = Constants.expoConfig?.version || '1.0.6';

const COR_PRIMARIA_PADRAO = '#28a745';
const COR_SECUNDARIA_PADRAO = '#00c853';

type TemaAgencia = {
  nome: string;
  corPrimaria: string;
  corSecundaria: string;
  corFonteCabecalho: string;
};

const TEMA_AGENCIA_PADRAO: TemaAgencia = {
  nome: 'Agência',
  corPrimaria: COR_PRIMARIA_PADRAO,
  corSecundaria: COR_SECUNDARIA_PADRAO,
  corFonteCabecalho: '#ffffff',
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

type AtualizacaoBackend = {
  versao?: string;
  changelog?: string | null;
  obrigatoria?: boolean;
  link?: string | null;
  linkDownload?: string | null;
};

export default function NotificacoesAgencia() {
  const navegar = useRouter();

  const [carregando, setCarregando] = useState(true);
  const [notificacoes, setNotificacoes] = useState<NotificacaoAgencia[]>([]);
  const [avisos, setAvisos] = useState<AvisoMotorista[]>([]);
  const [temaAgencia, setTemaAgencia] = useState<TemaAgencia>(TEMA_AGENCIA_PADRAO);
  const [atualizacaoDisponivel, setAtualizacaoDisponivel] = useState(false);
  const [atualizandoApp, setAtualizandoApp] = useState(false);
  const [atualizacaoBackend, setAtualizacaoBackend] = useState<AtualizacaoBackend | null>(null);


  const carregarTemaAgenciaSalvo = async () => {
    try {
      const [nome, corPrimaria, corSecundaria, corFonteCabecalho] = await Promise.all([
        AsyncStorage.getItem('nomeAgencia'),
        AsyncStorage.getItem('corAgenciaPrimaria'),
        AsyncStorage.getItem('corAgenciaSecundaria'),
        AsyncStorage.getItem('corFonteCabecalhoAgencia'),
      ]);

      setTemaAgencia({
        nome: nome?.trim() || TEMA_AGENCIA_PADRAO.nome,
        corPrimaria: corPrimaria?.trim() || TEMA_AGENCIA_PADRAO.corPrimaria,
        corSecundaria: corSecundaria?.trim() || TEMA_AGENCIA_PADRAO.corSecundaria,
        corFonteCabecalho: corFonteCabecalho?.trim() || TEMA_AGENCIA_PADRAO.corFonteCabecalho,
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
      await motoristaFetch(`${API_BASE}/api/Suporte/marcar-lidas-motorista`, {
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

      const resposta = await motoristaFetch(`${API_BASE}/api/Suporte/minhas-respostas`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      buscarAvisos().then(dados => setAvisos(dados.avisos)).catch(() => {});

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

  const verificarAtualizacaoApp = async () => {
    if (Platform.OS === 'web') return;

    try {
      let existeAtualizacaoExpo = false;

      if (Updates.isEnabled) {
        const resultado = await Updates.checkForUpdateAsync();
        existeAtualizacaoExpo = resultado.isAvailable;
      }

      const params = new URLSearchParams({
        produto: 'app-motorista',
        versaoAtual: VERSAO_APP_MOTORISTA,
        canal: 'main'
      });
      const respostaBackend = await motoristaFetch(`${API_BASE}/api/Atualizacoes/mais-recente?${params.toString()}`);
      const dadosBackend = respostaBackend.ok ? await respostaBackend.json() : null;
      const novaAtualizacaoBackend = dadosBackend?.atualizacaoDisponivel ? dadosBackend.atualizacao : null;

      setAtualizacaoBackend(novaAtualizacaoBackend);
      setAtualizacaoDisponivel(existeAtualizacaoExpo || Boolean(novaAtualizacaoBackend));
    } catch {
      setAtualizacaoDisponivel(false);
    }
  };

  const atualizarApp = async () => {
    try {
      setAtualizandoApp(true);

      if (Updates.isEnabled) {
        const resultado = await Updates.fetchUpdateAsync();

        if (resultado.isNew) {
          await Updates.reloadAsync();
          return;
        }
      }

      const link = atualizacaoBackend?.linkDownload || atualizacaoBackend?.link;

      if (link) {
        await Linking.openURL(link);
        return;
      }

      setAtualizacaoDisponivel(false);
      Alert.alert('Tudo certo', 'Seu app ja esta atualizado.');
    } catch {
      Alert.alert('Atualizacao', 'Nao foi possivel atualizar o app agora.');
    } finally {
      setAtualizandoApp(false);
    }
  };

  useEffect(() => {
    carregarTemaAgenciaSalvo();
    buscarNotificacoes();
    verificarAtualizacaoApp();
  }, []);

  useEffect(() => observarAvisos(aviso => setAvisos(lista => [aviso, ...lista.filter(a => a.id !== aviso.id)])), []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar backgroundColor={temaAgencia.corPrimaria} barStyle="light-content" />

      <View style={[styles.cabecalho, { backgroundColor: temaAgencia.corPrimaria }]}>
        <TouchableOpacity style={styles.botaoVoltar} onPress={() => navegar.back()}>
          <Ionicons name="arrow-back" size={28} color={temaAgencia.corFonteCabecalho} />
        </TouchableOpacity>

        <Text style={[styles.tituloCabecalho, { color: temaAgencia.corFonteCabecalho }]}>NOTIFICAÇÕES</Text>

        <TouchableOpacity style={styles.botaoAtualizar} onPress={buscarNotificacoes}>
          <Ionicons name="refresh" size={24} color={temaAgencia.corFonteCabecalho} />
        </TouchableOpacity>
      </View>

      {carregando ? (
        <View style={styles.areaCarregando}>
          <ActivityIndicator size="large" color={temaAgencia.corPrimaria} />
          <Text style={styles.textoCarregando}>Buscando respostas da agência...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.conteudo}>
          {atualizacaoDisponivel && (
            <View style={[styles.cardAtualizacao, { borderColor: temaAgencia.corPrimaria }]}>
              <View style={styles.linhaAtualizacao}>
                <Ionicons name="cloud-download-outline" size={26} color={temaAgencia.corPrimaria} />
                <View style={styles.textosAtualizacao}>
                  <Text style={styles.tituloAtualizacao}>Nova atualizacao disponivel</Text>
                  <Text style={styles.textoAtualizacao}>
                    {atualizacaoBackend?.versao
                      ? `Versao ${atualizacaoBackend.versao}. ${atualizacaoBackend.changelog || 'Toque para baixar.'}`
                      : 'Toque para baixar e reiniciar o app.'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.botaoAtualizarApp, { backgroundColor: temaAgencia.corPrimaria }]}
                onPress={atualizarApp}
                disabled={atualizandoApp}
              >
                <Text style={styles.textoBotaoAtualizarApp}>
                  {atualizandoApp ? 'Atualizando...' : 'Atualizar APP'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {avisos.length > 0 && <Text style={styles.tituloSecao}>Avisos da agência</Text>}
          {avisos.map((aviso) => (
            <View key={`aviso-${aviso.id}`} style={[styles.cardNotificacao, !aviso.vistoEm && styles.cardNaoLido, !aviso.vistoEm && { borderColor: temaAgencia.corPrimaria }]}>
              <View style={styles.linhaTopoCard}>
                <View style={[styles.tagProblema, { backgroundColor: '#fef3c7' }]}>
                  <Text style={[styles.textoTagProblema, { color: '#b45309' }]}>Aviso</Text>
                </View>
                {!aviso.vistoEm && (
                  <View style={styles.badgeNova}>
                    <Text style={styles.textoBadgeNova}>NOVO</Text>
                  </View>
                )}
              </View>
              <Text style={styles.textoResposta} selectable>{aviso.texto}</Text>
              <Text style={[styles.dataResposta, { marginTop: 10 }]}>Enviado em {formatarData(aviso.criadoEm)}</Text>
            </View>
          ))}

          {notificacoes.length > 0 && avisos.length > 0 && <Text style={styles.tituloSecao}>Respostas de suporte</Text>}
          {notificacoes.length === 0 ? (
            avisos.length === 0 && (
              <View style={styles.cardVazio}>
                <Ionicons name="notifications-off-outline" size={42} color="#999" />
                <Text style={styles.tituloVazio}>Nenhuma notificação</Text>
                <Text style={styles.textoVazio}>Avisos da agência e respostas de suporte aparecerão aqui.</Text>
              </View>
            )
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
  cardAtualizacao: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: '#28a745',
    elevation: 2,
  },
  linhaAtualizacao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  textosAtualizacao: {
    flex: 1,
  },
  tituloAtualizacao: {
    fontSize: 16,
    fontWeight: '900',
    color: '#1f2937',
  },
  textoAtualizacao: {
    marginTop: 3,
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '700',
  },
  botaoAtualizarApp: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  textoBotaoAtualizarApp: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 14,
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
  tituloSecao: {
    fontSize: 13,
    fontWeight: '900',
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
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
