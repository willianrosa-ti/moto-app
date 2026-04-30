import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mesesDoAno = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export default function FinanceiroMotorista() {
  const navegar = useRouter();
  const [filtro, setFiltro] = useState<'hoje' | 'semana' | 'mes'>('hoje');
  const [mesSelecionado, setMesSelecionado] = useState(new Date().getMonth()); // 0 a 11
  const [carregando, setCarregando] = useState(true);

  // Estado para armazenar os dados que virão da API
  const [dadosFinanceiros, setDadosFinanceiros] = useState({
    totalGanho: 0,
    totalCorridas: 0,
    melhoresHorarios: [] as { hora: string; valor: number; corridas: number }[]
  });

  // Função REAL para buscar os dados no C#
  const buscarDadosFinanceiros = async () => {
    setCarregando(true);
    
    try {
      // 1. Pega o token de segurança salvo no celular durante o Login
      const token = await AsyncStorage.getItem('tokenMotorista'); 
      
      if (!token) {
        console.log("Acesso negado: Token não encontrado.");
        setCarregando(false);
        // Opcional: navegar.replace('/Login') se quiser forçar a saída
        return;
      }

      // 2. Prepara a rota da API. 
      // ⚠️ ATENÇÃO: No Expo, 'localhost' não funciona. Troque "192.168.X.X" pelo IP IPv4 do seu computador na rede Wi-Fi!
      const ip ="192.168.15.6"; 
      
      // O mês no JavaScript vai de 0 a 11, mas para o C# mandamos de 1 a 12.
      const mesParaEnviar = mesSelecionado + 1; 
      const url = `http://${ip}:5022/api/Motorista/financeiro?filtro=${filtro}&mes=${mesParaEnviar}`;

      // 3. Faz a chamada passando o Token no cabeçalho
      const resposta = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (resposta.ok) {
        const dadosReais = await resposta.json();
        
        // 4. Injeta os dados do banco na tela!
        setDadosFinanceiros({
          totalGanho: dadosReais.totalGanho || 0,
          totalCorridas: dadosReais.totalCorridas || 0,
          melhoresHorarios: dadosReais.melhoresHorarios || []
        });
      } else {
        console.log("Erro na resposta da API. Status:", resposta.status);
      }

    } catch (erro) {
      console.error("Não foi possível conectar ao servidor:", erro);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    // Sempre que o filtro ('hoje', 'semana', 'mes') ou o mês mudar, busca no banco de novo
    buscarDadosFinanceiros();
  }, [filtro, mesSelecionado]);

  const mudarMes = (direcao: number) => {
    let novoMes = mesSelecionado + direcao;
    if (novoMes > 11) novoMes = 0;
    if (novoMes < 0) novoMes = 11;
    setMesSelecionado(novoMes);
  };

  // Encontra o maior valor para calcular a altura das barras do gráfico
  const maiorValorGrafico = dadosFinanceiros.melhoresHorarios.length > 0 
    ? Math.max(...dadosFinanceiros.melhoresHorarios.map(h => h.valor)) 
    : 1;

  return (
    <View style={styles.container}>
      {/* CABEÇALHO */}
      <View style={styles.cabecalho}>
        <TouchableOpacity style={styles.botaoVoltar} onPress={() => navegar.back()}>
          <Ionicons name="arrow-back" size={30} color="#fff"/>
        </TouchableOpacity>
        <Text style={styles.tituloCabecalho}>MEU FINANCEIRO</Text>
        <View style={{ width: 24 }}/>{/* Espaçador para centralizar o título */}</View>

      <ScrollView contentContainerStyle={styles.conteudo}>
        
        {/* ABAS DE FILTRO */}
        <View style={styles.containerAbas}>
          <TouchableOpacity style={[styles.aba, filtro === 'hoje' && styles.abaAtiva]} onPress={() => setFiltro('hoje')}>
            <Text style={[styles.textoAba, filtro === 'hoje' && styles.textoAbaAtivo]}>Hoje</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.aba, filtro === 'semana' && styles.abaAtiva]} onPress={() => setFiltro('semana')}>
            <Text style={[styles.textoAba, filtro === 'semana' && styles.textoAbaAtivo]}>Semana</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.aba, filtro === 'mes' && styles.abaAtiva]} onPress={() => setFiltro('mes')}>
            <Text style={[styles.textoAba, filtro === 'mes' && styles.textoAbaAtivo]}>Mês</Text>
          </TouchableOpacity>
        </View>

        {/* SELETOR DE MÊS (Aparece apenas se a aba Mês estiver selecionada) */}
        {filtro === 'mes' && (
          <View style={styles.seletorMes}>
            <TouchableOpacity onPress={() => mudarMes(-1)} style={styles.setaMes}>
              <Ionicons name="chevron-back" size={24} color="#28a745" />
            </TouchableOpacity>
            <Text style={styles.textoMesAtual}>{mesesDoAno[mesSelecionado]}</Text>
            <TouchableOpacity onPress={() => mudarMes(1)} style={styles.setaMes}>
              <Ionicons name="chevron-forward" size={24} color="#28a745" />
            </TouchableOpacity>
          </View>
        )}

        {carregando ? (
          <ActivityIndicator size="large" color="#28a745" style={{ marginTop: 50 }} />
        ) : (
          <>
            {/* CARDS DE RESUMO */}
            <View style={styles.containerResumo}>
              <View style={styles.cardResumoPrincipal}>
                <Text style={styles.tituloCard}>Total de Ganhos</Text>
                <Text style={styles.valorCardGanhos}>R$ {dadosFinanceiros.totalGanho.toFixed(2)}</Text>
              </View>

              <View style={styles.cardResumoSecundario}>
                <Ionicons name="stats-chart" size={24} color="#007bff" />
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.tituloCard}>Corridas</Text>
                  <Text style={styles.valorCardSecundario}>{dadosFinanceiros.totalCorridas} finalizadas</Text>
                </View>
              </View>
            </View>

            {/* GRÁFICO DE MELHORES HORÁRIOS */}
            <View style={styles.cardGrafico}>
              <View style={styles.cabecalhoGrafico}>
                <Ionicons name="time" size={22} color="#28a745" />
                <Text style={styles.tituloGrafico}>Picos de Faturamento</Text>
              </View>
              
              <Text style={styles.subtituloGrafico}>Seus melhores horários neste período</Text>

              {dadosFinanceiros.melhoresHorarios.length > 0 ? (
                <View style={styles.areaGrafico}>
                  {dadosFinanceiros.melhoresHorarios.map((item, index) => {
                    const alturaBarra = (item.valor / maiorValorGrafico) * 100; // Calcula a altura em %
                    return (
                      <View key={index} style={styles.colunaGrafico}>
                        <Text style={styles.valorBarra}>R$ {item.valor.toFixed(0)}</Text>
                        <View style={styles.barraFundo}>
                          <View style={[styles.barraPreenchida, { height: `${alturaBarra}%` }]} />
                        </View>
                        <Text style={styles.textoHoraBarra}>{item.hora}</Text>
                        <Text style={styles.textoCorridasBarra}>{item.corridas} c.</Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.textoGraficoVazio}>Nenhuma corrida registrada neste período.</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  cabecalho: { 
    backgroundColor: '#28a745', 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    padding: 20, 
    paddingTop: 15, // Ajuste para descer abaixo da barra de status do celular
    elevation: 4 
  },
  botaoVoltar: { padding: 5 },
  tituloCabecalho: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  conteudo: { padding: 15, paddingBottom: 40 },
  
  // Abas
  containerAbas: { 
    flexDirection: 'row', 
    backgroundColor: '#e9ecef', 
    borderRadius: 8, 
    padding: 4, 
    marginBottom: 20 
  },
  aba: { 
    flex: 1, 
    paddingVertical: 10, 
    alignItems: 'center', 
    borderRadius: 6 
  },
  abaAtiva: { backgroundColor: '#ffffff', elevation: 2 },
  textoAba: { fontSize: 14, fontWeight: 'bold', color: '#6c757d' },
  textoAbaAtivo: { color: '#28a745' },

  // Seletor de Mês
  seletorMes: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: '#fff', 
    borderRadius: 8, 
    padding: 10, 
    marginBottom: 20,
    elevation: 1
  },
  setaMes: { padding: 5 },
  textoMesAtual: { fontSize: 16, fontWeight: 'bold', color: '#333', width: 100, textAlign: 'center' },

  // Cards de Resumo
  containerResumo: { gap: 15, marginBottom: 25 },
  cardResumoPrincipal: { 
    backgroundColor: '#fff', 
    padding: 20, 
    borderRadius: 12, 
    alignItems: 'center',
    borderLeftWidth: 5,
    borderLeftColor: '#28a745',
    elevation: 2
  },
  cardResumoSecundario: { 
    backgroundColor: '#fff', 
    padding: 15, 
    borderRadius: 12, 
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2
  },
  tituloCard: { fontSize: 12, color: '#6c757d', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: 5 },
  valorCardGanhos: { fontSize: 32, fontWeight: '900', color: '#28a745' },
  valorCardSecundario: { fontSize: 16, fontWeight: 'bold', color: '#333' },

  // Gráfico
  cardGrafico: { backgroundColor: '#fff', padding: 20, borderRadius: 12, elevation: 2 },
  cabecalhoGrafico: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 5 },
  tituloGrafico: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  subtituloGrafico: { fontSize: 12, color: '#888', marginBottom: 20 },
  areaGrafico: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 200, marginTop: 10 },
  colunaGrafico: { alignItems: 'center', width: 50 },
  valorBarra: { fontSize: 10, color: '#666', fontWeight: 'bold', marginBottom: 5 },
  barraFundo: { width: 30, height: 120, backgroundColor: '#e9ecef', borderRadius: 5, justifyContent: 'flex-end', overflow: 'hidden' },
  barraPreenchida: { width: '100%', backgroundColor: '#28a745', borderRadius: 5 },
  textoHoraBarra: { fontSize: 12, fontWeight: 'bold', color: '#333', marginTop: 8 },
  textoCorridasBarra: { fontSize: 10, color: '#888' },
  textoGraficoVazio: { textAlign: 'center', color: '#888', fontStyle: 'italic', marginTop: 20 }
});