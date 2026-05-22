import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking, Animated, Easing, ScrollView, Modal, TouchableWithoutFeedback, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import * as signalR from '@microsoft/signalr';
import { Audio } from 'expo-av'; 
import * as Location from 'expo-location'; 
import { Ionicons } from '@expo/vector-icons'; 

const ficheiroBuzina = require('../../assets/sounds/buzina.mp3');

const API_BASE = 'https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net';

const NOME_AGENCIA_PADRAO = 'RADAR DO MOTORISTA';
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
  nome: NOME_AGENCIA_PADRAO,
  corPrimaria: COR_PRIMARIA_PADRAO,
  corSecundaria: COR_SECUNDARIA_PADRAO,
  telefone: TELEFONE_AGENCIA_PADRAO,
};

const formatarQuilometragem = (valor: any) => {
  const numero = Number(valor || 0);
  return `${numero.toFixed(1).replace('.', ',')} km de distância`;
};


// --- SÍMBOLO MIL-LIN (Notebook CSS traduzido para React Native) ---
const SimboloMilLin = () => (
  <View style={milLinStyles.containerLogo}>
    {/* Parte de Cima do Notebook (Tela) */}
    <View style={milLinStyles.notebookTela} />
    
    {/* Parte de Baixo do Notebook (Teclado/Base) */}
    <View style={milLinStyles.notebookBase} />
  </View>
);

export default function Radar() {
  useKeepAwake();

  const [statusOnline, setStatusOnline] = useState(false);
  const [corridaRecebida, setCorridaRecebida] = useState<any>(null);
  const [corridaAceita, setCorridaAceita] = useState(false);
  const [sinalNovaCorrida, setSinalNovaCorrida] = useState(0);
  const [tempoRestante, setTempoRestante] = useState(15);
  const [localizacaoMotorista, setLocalizacaoMotorista] = useState<Location.LocationObject | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [qtdNotificacoesSuporte, setQtdNotificacoesSuporte] = useState(0);
  const [temaAgencia, setTemaAgencia] = useState<TemaAgencia>(TEMA_AGENCIA_PADRAO);
  
  const [valorDiario, setValorDiario] = useState<number>(0); 
  const [mostrarValor, setMostrarValor] = useState(false); 

  // --- NOVOS ESTADOS PARA O MODO LISTA ---
  const [modoVisualizacao, setModoVisualizacao] = useState<'radar' | 'lista'>('radar');
  const [corridasDisponiveis, setCorridasDisponiveis] = useState<any[]>([]);

  // NOVO ESTADO: Controla a tela de carregamento/transição da MIL-LIN
  const [processandoAcesso, setProcessandoAcesso] = useState(false);


  const corridasIgnoradas = useRef<any[]>([]); 
  const corridaAceitaRef = useRef(false);
  const corridaRecebidaRef = useRef<any>(null);
  const statusOnlineRef = useRef(false);
  const qtdCorridasRef = useRef(0); // Referência para controlar o toque da buzina na lista

  const animacaoRadar = useRef(new Animated.Value(0)).current;
  const navegar = useRouter();


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

  // --- FUNÇÃO PARA GERENCIAR CLIQUES NO MENU COM TRANSIÇÃO ---
  const executarAcaoMenu = (acao: 'financeiro' | 'notificacoes' | 'suporte') => {
    setMenuAberto(false); // Fecha o menu lateral
    setProcessandoAcesso(true); // Abre a tela de carregamento da MIL-LIN

    setTimeout(() => {
      setProcessandoAcesso(false); // Esconde o carregamento
      if (acao === 'financeiro') {
        navegar.push('/radar/financeiro' as any);
      } else if (acao === 'notificacoes') {
        navegar.push('/radar/notificacoes' as any);
      } else if (acao === 'suporte') {
        navegar.push('/radar/suporte' as any);
      }
    }, 1000);
  };

  // --- NOVA FUNÇÃO DE SAIR (LOGOUT) ---
  const fazerLogout = async () => {
    Alert.alert(
      "Sair do App",
      "Tem certeza que deseja desconectar sua conta?",
      [
        { text: "Cancelar", style: "cancel" },
        { 
          text: "Sair", 
          style: "destructive",
          onPress: async () => {
            try {
              // Limpa a memória do celular
              await AsyncStorage.removeItem('tokenMotorista');
              await AsyncStorage.removeItem('nomeMotorista');
              await AsyncStorage.removeItem('idMotorista');
              await AsyncStorage.removeItem('nomeAgencia');
              await AsyncStorage.removeItem('corAgenciaPrimaria');
              await AsyncStorage.removeItem('corAgenciaSecundaria');
              await AsyncStorage.removeItem('logoAgencia');
              await AsyncStorage.removeItem('telefoneAgencia');
              
              setStatusOnline(false); // Desliga o radar por segurança
              setMenuAberto(false);
              
              // Substitua '/' pela rota do seu arquivo de Login, caso seja diferente
              navegar.replace('/'); 
            } catch (erro) {
              Alert.alert("Erro", "Não foi possível sair.");
            }
          }
        }
      ]
    );
  };

  // --- INÍCIO DA INTEGRAÇÃO COM O BANCO PARA OS GANHOS ---
  const buscarGanhosDoDia = async () => {
    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) return;

      const mesAtual = new Date().getMonth() + 1; 
      
      const resposta = await fetch(`${API_BASE}/api/Motorista/financeiro?filtro=hoje&mes=${mesAtual}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (resposta.ok) {
        const dadosBanco = await resposta.json();
        setValorDiario(dadosBanco.totalGanho || 0);
      }
    } catch (erro) {
      console.log("Erro ao sincronizar ganhos diários:", erro);
    }
  };

  // --- NOVA FUNÇÃO: VERIFICAR E RECUPERAR CORRIDA ATIVA ---
  const verificarCorridaAtiva = async () => {
    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) return;

      const resposta = await fetch(`${API_BASE}/api/Corrida/ativa`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (resposta.status === 200) {
        const corrida = await resposta.json();
        if (corrida) {
          setCorridaRecebida(corrida); // Puxa os dados para a tela
          setCorridaAceita(true);      // Força o app a abrir a tela de "EM CORRIDA"
          setStatusOnline(true);       // Liga o radar para o GPS continuar rastreando
        }
      }
    } catch (erro) {
      console.log("Erro ao recuperar corrida ativa:", erro);
    }
  };

  const buscarNotificacoesSuporteMotorista = async () => {
    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) return;

      const resposta = await fetch(`${API_BASE}/api/Suporte/minhas-respostas`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (resposta.ok) {
        const lista = await resposta.json();
        const naoLidas = Array.isArray(lista)
          ? lista.filter((item: any) => item.respostaAgencia && item.lidaPeloMotorista === false).length
          : 0;

        setQtdNotificacoesSuporte(naoLidas);
      }
    } catch (erro) {
      console.log('Erro ao buscar notificações de suporte:', erro);
    }
  };

  useEffect(() => {
    carregarTemaAgenciaSalvo();
    buscarGanhosDoDia();
    verificarCorridaAtiva(); // <-- Adicionamos a checagem logo ao abrir o App
    buscarNotificacoesSuporteMotorista();

    const intervaloNotificacoes = setInterval(buscarNotificacoesSuporteMotorista, 30000);
    return () => clearInterval(intervaloNotificacoes);
  }, []);
  // --- FIM DA INTEGRAÇÃO ---

  useEffect(() => {
    statusOnlineRef.current = statusOnline;
  }, [statusOnline]);

  // Mantém o motorista realmente "online" no painel da agência.
  // Mesmo que o GPS demore a mandar uma posição nova, este pulso atualiza a última atividade no backend.
  const enviarSinalDeVida = async () => {
    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) return;

      try {
        const localizacaoAtual = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        setLocalizacaoMotorista(localizacaoAtual);

        await fetch(`${API_BASE}/api/Motorista/atualizar-localizacao`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            latitude: localizacaoAtual.coords.latitude,
            longitude: localizacaoAtual.coords.longitude
          })
        });
      } catch (erroLocalizacao) {
        // Fallback: mantém o sinal de vida pelo status online, mesmo se o GPS falhar por alguns segundos.
        await fetch(`${API_BASE}/api/Motorista/alterar-status-online`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(true)
        });
      }
    } catch (erro) {
      console.log('Erro ao enviar sinal de vida:', erro);
    }
  };

  useEffect(() => {
    if (!statusOnline) return;

    enviarSinalDeVida();
    const intervaloSinalDeVida = setInterval(enviarSinalDeVida, 5000);

    return () => clearInterval(intervaloSinalDeVida);
  }, [statusOnline]);

  useEffect(() => {
    let inscricaoLocalizacao: Location.LocationSubscription;

    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Atenção', 'Precisamos do GPS!');
        return;
      }

      inscricaoLocalizacao = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 10,
        },
        async (localizacao) => {
          setLocalizacaoMotorista(localizacao);
          
          if (statusOnlineRef.current) {
            try {
              const token = await AsyncStorage.getItem('tokenMotorista');
              await fetch(`${API_BASE}/api/Motorista/atualizar-localizacao`, {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ 
                  latitude: localizacao.coords.latitude, 
                  longitude: localizacao.coords.longitude 
                })
              });
            } catch (erro) {
            }
          }
        }
      );
    })();

    return () => {
      if (inscricaoLocalizacao) {
        inscricaoLocalizacao.remove();
      }
    };
  }, []);

  const tocarBuzina = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(ficheiroBuzina);
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (error) {
    }
  };

  // Som para o modo RADAR
  useEffect(() => {
    if (corridaRecebida && !corridaAceita && modoVisualizacao === 'radar') {
      setTempoRestante(15); 
      tocarBuzina();
    }
  }, [corridaRecebida, modoVisualizacao]);

  useEffect(() => {
    corridaAceitaRef.current = corridaAceita;
  }, [corridaAceita]);


  useEffect(() => {
    corridaRecebidaRef.current = corridaRecebida;
  }, [corridaRecebida]);

  useEffect(() => {
    if (statusOnline && !corridaRecebida) {
      Animated.loop(
        Animated.timing(animacaoRadar, {
          toValue: 1,
          duration: 1500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        })
      ).start();
    } else {
      animacaoRadar.setValue(0);
    }
  }, [statusOnline, corridaRecebida]);

  useEffect(() => {
    const conexao = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE}/hub-corridas`)
      .withAutomaticReconnect()
      .build();

    conexao.start()
      .then(async () => {
        const idMotorista = await AsyncStorage.getItem('idMotorista');
        if (idMotorista) {
          await conexao.invoke('EntrarNoGrupoMotorista', idMotorista);
        }
      })
      .catch(() => {});

    conexao.on("NovaCorridaDisponivel", () => {
      setSinalNovaCorrida(gatilho => gatilho + 1);
    });

    // NOVO: Gatilho para limpar a tela na mesma hora que alguém aceitar
    conexao.on("AtualizarCorridas", () => {
      setSinalNovaCorrida(gatilho => gatilho + 1);
    });

    conexao.on("RespostaSuporteRecebida", () => {
      buscarNotificacoesSuporteMotorista();
    });


    conexao.on("CorridaCancelada", (payload: any) => {
      const corridaIdCancelada = payload?.corridaId;

      setSinalNovaCorrida(gatilho => gatilho + 1);
      setCorridasDisponiveis((listaAtual) =>
        listaAtual.filter((corrida) => corrida.id !== corridaIdCancelada)
      );

      const corridaAtual = corridaRecebidaRef.current;
      if (corridaAtual && corridaAtual.id === corridaIdCancelada) {
        setCorridaRecebida(null);
        setCorridaAceita(false);
        corridaAceitaRef.current = false;
        setTempoRestante(15);

        Alert.alert(
          "Corrida cancelada",
          payload?.mensagem || "Esta corrida foi cancelada pela agência."
        );
      }
    });

    conexao.on("ContaMotoristaAtualizada", (payload: any) => {
      buscarNotificacoesSuporteMotorista();

      if (payload?.suspenso === true) {
        setStatusOnline(false);
        statusOnlineRef.current = false;
        setCorridaRecebida(null);
        setCorridaAceita(false);
        setCorridasDisponiveis([]);
        Alert.alert(
          "Conta suspensa",
          payload?.respostaAgencia || "Sua conta foi suspensa! Caso você não concorde, favor entrar em contato."
        );
      } else if (payload?.tipoProblema === "Conta editada") {
        Alert.alert(
          "Conta editada",
          payload?.respostaAgencia || "Sua conta foi editada! Caso não concorde, favor entrar em contato."
        );
      }
    });

    return () => { 
        conexao.stop(); 
    }; 
  }, []);

  useEffect(() => {
    let intervaloVida: ReturnType<typeof setInterval>;

    const buscarCorridasReais = async () => {
      if (!statusOnline) return;

      try {
        const token = await AsyncStorage.getItem('tokenMotorista'); 
        const resposta = await fetch(`${API_BASE}/api/Corrida/pendentes`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}` 
          }
        });

        if (resposta.ok) {
          const listaCorridas = await resposta.json();
          const agora = Date.now();
          
          corridasIgnoradas.current = corridasIgnoradas.current.filter((item: any) => (agora - item.instante) < 5000);
          const idsIgnorados = corridasIgnoradas.current.map((i: any) => i.id);

          const corridasValidas = listaCorridas
            .filter((c: any) => !idsIgnorados.includes(c.id))
            .map((c: any) => ({
              id: c.id,
              passageiro: c.passageiro,
              busca: c.busca,
              destino: c.destino,
              valor: c.valor,
              distanciaBusca: c.distanciaBusca || 0,
              distanciaDestino: c.distanciaDestino || 0
            }));

          // Atualiza o modo Lista
          setCorridasDisponiveis(corridasValidas);

          // Toca buzina sempre que o número de corridas novas for maior que o anterior (CORREÇÃO DA BUZINA)
          if (modoVisualizacao === 'lista' && corridasValidas.length > qtdCorridasRef.current) {
            tocarBuzina();
          }
          qtdCorridasRef.current = corridasValidas.length;

          // Atualiza o modo Radar (Sempre mantendo atualizado nos bastidores)
          setCorridaRecebida((atual: any) => {
            if (corridaAceitaRef.current) return atual;

            const novaCorrida = corridasValidas[0]; // Pega a primeira da lista validada

            if (novaCorrida) {
              if (atual && atual.id === novaCorrida.id) return atual;
              return novaCorrida;
            } else {
              return null; 
            }
          });
        }
      } catch (erro) {
      }
    };

    if (statusOnline) {
      buscarCorridasReais(); 
      // CORREÇÃO DO TEMPO DE BUSCA (de 25000 para 5000 - 5 segundos)
      intervaloVida = setInterval(buscarCorridasReais, 1500); 
    }

    return () => clearInterval(intervaloVida);
  }, [statusOnline, sinalNovaCorrida, modoVisualizacao]);

  // Cronômetro apenas funciona no modo Radar
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (corridaRecebida && !corridaAceita && tempoRestante > 0 && modoVisualizacao === 'radar') {
      timer = setInterval(() => {
        setTempoRestante(prev => prev - 1);
      }, 1000);
    } else if (corridaRecebida && !corridaAceita && tempoRestante === 0 && modoVisualizacao === 'radar') {
      recusarCorrida();
    }
    return () => clearInterval(timer);
  }, [corridaRecebida, corridaAceita, tempoRestante, modoVisualizacao]);

  const alternarStatus = async () => {
    const novoStatus = !statusOnline;
    const token = await AsyncStorage.getItem('tokenMotorista');

    try {
      const resposta = await fetch(`${API_BASE}/api/Motorista/alterar-status-online`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(novoStatus)
      });

      if (resposta.ok) {
        setStatusOnline(novoStatus);
        statusOnlineRef.current = novoStatus;
        setCorridaRecebida(null);
        setCorridasDisponiveis([]); // Limpa a lista ao deslogar
        setCorridaAceita(false);
        corridasIgnoradas.current = []; 
        setTempoRestante(15);

        if (novoStatus) {
          await enviarSinalDeVida();
        }
      } else {
        const textoErro = await resposta.text();
        let mensagemErro = "Erro ao sincronizar status.";
        try {
          mensagemErro = JSON.parse(textoErro).mensagem || mensagemErro;
        } catch {
          if (textoErro) mensagemErro = textoErro;
        }
        Alert.alert("Erro", mensagemErro);
      }
    } catch (erro) {
      Alert.alert("Erro", "Sem conexão.");
    }
  };

  const recusarCorrida = () => {
    if (corridaRecebida) {
      corridasIgnoradas.current.push({ id: corridaRecebida.id, instante: Date.now() });
    }
    setCorridaRecebida(null); 
    setTempoRestante(15);
    setSinalNovaCorrida(gatilho => gatilho + 1); 
  };

  // Adaptei para receber ou o do radar ou o da lista
  const aceitarCorridaReal = async (corridaParam?: any) => {
    const corridaAlvo = corridaParam || corridaRecebida;
    if (!corridaAlvo) return;

    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      
      const resposta = await fetch(`${API_BASE}/api/Corrida/aceitar/${corridaAlvo.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (resposta.ok) {
        setCorridaRecebida(corridaAlvo); // Fixa a corrida para o app saber qual está ativa
        setCorridaAceita(true); 
        setCorridasDisponiveis([]); // Limpa a lista
      } else {
        const erro = await resposta.text();
        Alert.alert("Ops!", erro); 
        setCorridaRecebida(null); 
        setSinalNovaCorrida(gatilho => gatilho + 1); 
      }
    } catch (erro) {
      Alert.alert("Erro", "Falha de conexão.");
    }
  };

  const finalizarCorridaReal = async () => {
    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      
      const resposta = await fetch(`${API_BASE}/api/Corrida/finalizar/${corridaRecebida.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (resposta.ok) {
        setValorDiario(prev => prev + corridaRecebida.valor);

        setCorridaAceita(false);
        setCorridaRecebida(null);
        setTempoRestante(15);
        setSinalNovaCorrida(gatilho => gatilho + 1); 

        buscarGanhosDoDia(); 
      } else {
        Alert.alert("Erro", "Erro ao finalizar.");
      }
    } catch (erro) {
      Alert.alert("Erro", "Sem conexão.");
    }
  };

  const abrirGPS = (app: string, enderecoParaIr: string) => {
    const destinoEncoded = encodeURIComponent(enderecoParaIr);
    if (app === 'waze') {
      Linking.openURL(`https://waze.com/ul?q=${destinoEncoded}&navigate=yes`);
    } else {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destinoEncoded}`);
    }
  };


  const sonarScale = animacaoRadar.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.5] });
  const sonarOpacity = animacaoRadar.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] });

  // ==========================================
  // --- RENDERIZAÇÃO DA TELA DE CARREGAMENTO MIL-LIN ---
  // ==========================================
  if (processandoAcesso) {
    return (
      <SafeAreaView style={milLinStyles.telaCarregamento} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar backgroundColor="#1f2937" barStyle="light-content" />
        
        {/* Logo em branco "MIL-LIN" (como você pediu, em branco em cima do notebook) */}
        <Text style={milLinStyles.tituloMilLinBranco}>M I L - L I N</Text>
        
        {/* Recriação do Símbolo em CSS */}
        <SimboloMilLin />
        
        {/* Texto "CARREGANDO..." em baixo */}
        <Text style={milLinStyles.textoCarregando}>C  A  R  R  E  G  A  N  D  O...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.areaSeguraApp, { backgroundColor: temaAgencia.corPrimaria }]} edges={['top', 'left', 'right']}>
      <View style={styles.telaRadar}>
        <StatusBar backgroundColor={temaAgencia.corPrimaria} barStyle="light-content" />
      <View style={[styles.cabecalhoRadar, { backgroundColor: temaAgencia.corPrimaria }]}>
        <Text style={styles.tituloApp} numberOfLines={1}>{temaAgencia.nome.toUpperCase()}</Text>
        
        <View style={styles.botoesCabecalho}>
          <View style={styles.statusTopoContainer}>
            <TouchableOpacity 
              activeOpacity={0.8}
              style={[styles.alavancaInterruptor, statusOnline && styles.alavancaAtiva]}
              onPress={alternarStatus}
            >
              <View style={[
                styles.indicadorStatus, 
                statusOnline ? styles.bolinhaVerde : styles.bolinhaVermelha
              ]} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.botaoMenu} onPress={() => setMenuAberto(true)}>
            <Text style={styles.iconeMenu}>≡</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.containerFlutuante}>
        <View style={styles.blocoGanhos}>
            <View style={styles.linhaValorVisibilidade}>
            <Text style={[styles.valorGanhos, { color: temaAgencia.corPrimaria }]}>
              {mostrarValor ? `R$ ${valorDiario.toFixed(2)}` : 'R$ ----'}
            </Text>
            <TouchableOpacity onPress={() => setMostrarValor(!mostrarValor)} style={styles.botaoOlho}>
              <Ionicons name={mostrarValor ? "eye" : "eye-off"} size={24} color="#666" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* --- MENU MODERNO COM CLIQUE FORA E BOTÃO SAIR --- */}
      <Modal 
        visible={menuAberto} 
        transparent={true} 
        animationType="fade"
        onRequestClose={() => setMenuAberto(false)} // Fecha ao apertar botão voltar do Android
      >
        <TouchableWithoutFeedback onPress={() => setMenuAberto(false)}>
          <View style={styles.fundoModal}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.caixaMenu}>
                
                <Text style={styles.tituloMenu}>RECURSOS</Text>
                <View style={styles.linhaSeparadoraMenu} />
                
                {/* Alterado para chamar a função com a transição MIL-LIN */}
                <TouchableOpacity style={styles.itemMenu} onPress={() => executarAcaoMenu('financeiro')}>
                  <Ionicons name="cash-outline" size={20} color={temaAgencia.corPrimaria} />
                  <Text style={styles.textoItemMenu}>FINANCEIRO</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.itemMenu} onPress={() => executarAcaoMenu('notificacoes')}>
                  <Ionicons name="notifications-outline" size={20} color={temaAgencia.corPrimaria} />
                  <View style={styles.notificacaoMenuLinha}>
                    <Text style={styles.textoItemMenu}>NOTIFICAÇÕES</Text>
                    {qtdNotificacoesSuporte > 0 && (
                      <View style={styles.badgeNotificacaoMenu}>
                        <Text style={styles.textoBadgeNotificacaoMenu}>{qtdNotificacoesSuporte}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
                
                {/* Alterado o ícone e chamando a transição MIL-LIN */}
                <TouchableOpacity style={styles.itemMenu} onPress={() => executarAcaoMenu('suporte')}>
                  <Ionicons name="headset-outline" size={20} color={temaAgencia.corPrimaria} />
                  <Text style={styles.textoItemMenu}>SUPORTE TECNICO</Text>
                </TouchableOpacity>

                {/* BOTÃO DE SAIR ADICIONADO AQUI */}
                <TouchableOpacity style={styles.itemMenuSair} onPress={fazerLogout}>
                  <Ionicons name="log-out-outline" size={20} color="#dc3545" />
                  <Text style={styles.textoItemMenuSair}>Sair</Text>
                </TouchableOpacity>

              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <ScrollView contentContainerStyle={styles.conteudoRadar}>
        
        {/* === BOTÕES DE CONTROLE RADAR / LISTA === */}
        {statusOnline && !corridaAceita && (
          <View style={styles.botoesModoContainer}>
            <TouchableOpacity
              style={[styles.botaoModo, modoVisualizacao === 'lista' && styles.botaoModoAtivo, modoVisualizacao === 'lista' && { backgroundColor: temaAgencia.corPrimaria }]}
              onPress={() => setModoVisualizacao('lista')}
            >
              <Text style={[styles.textoBotaoModo, modoVisualizacao === 'lista' && styles.textoBotaoModoAtivo]}>Lista de Corridas</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.botaoModo, modoVisualizacao === 'radar' && styles.botaoModoAtivo, modoVisualizacao === 'radar' && { backgroundColor: temaAgencia.corPrimaria }]}
              onPress={() => setModoVisualizacao('radar')}
            >
              <Text style={[styles.textoBotaoModo, modoVisualizacao === 'radar' && styles.textoBotaoModoAtivo]}>Radar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* STATUS DA PROCURA (Exibe apenas no modo radar ou se estiver offline) */}
        {(!corridaAceita && (modoVisualizacao === 'radar' || !statusOnline)) && (
          <View style={styles.areaBotaoStatus}>
            <Text style={styles.statusTexto}>
              {statusOnline ? 'Procurando corridas no Radar...' : 'Você está offline'}
            </Text>
          </View>
        )}

        {/* === MODO LISTA === */}
        {statusOnline && !corridaAceita && modoVisualizacao === 'lista' ? (
          <View style={styles.listaContainer}>
            {corridasDisponiveis.length === 0 ? (
              <Text style={styles.textoVazioLista}>Buscando por novas chamadas...</Text>
            ) : (
              corridasDisponiveis.map((corrida) => (
                <View key={corrida.id} style={styles.cardCorridaLista}>
                  <View style={styles.cabecalhoLista}>
                    <Text style={styles.nomePassageiroLista}>{corrida.passageiro}</Text>
                    <Text style={styles.valorCorridaLista}>R$ {corrida.valor.toFixed(2)}</Text>
                  </View>
                  <View style={styles.enderecosLista}>
                    <Text style={styles.enderecoTextoLista} numberOfLines={2}>🚗 Buscar em: {corrida.busca}</Text>
                    <Text style={styles.quilometragemTextoLista}>{formatarQuilometragem(corrida.distanciaBusca)}</Text>

                    <Text style={styles.enderecoTextoLista} numberOfLines={2}>📍 Levar para: {corrida.destino}</Text>
                    <Text style={styles.quilometragemTextoLista}>{formatarQuilometragem(corrida.distanciaDestino)}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.botaoAceitarLista, { backgroundColor: temaAgencia.corPrimaria }]}
                    onPress={() => aceitarCorridaReal(corrida)}
                  >
                    <Text style={styles.textoBotaoAceitarLista}>ACEITAR CORRIDA</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

        // === MODO RADAR ===
        ) : (
          <>
            {statusOnline && corridaRecebida && !corridaAceita && (
              <View style={styles.cartaoCorrida}>
                <View style={styles.cabecalhoCartao}>
                  <Text style={styles.novaCorridaTag}>NOVA CHAMADA</Text>
                  <Text style={styles.valorCorrida}>R$ {corridaRecebida.valor.toFixed(2)}</Text>
                </View>

                <View style={styles.cronometroBarra}>
                  <View style={[styles.progresso, { width: `${(tempoRestante / 15) * 100}%`, backgroundColor: temaAgencia.corPrimaria }]} />
                </View>
                <Text style={styles.textoTempo}>{tempoRestante}s para aceitar</Text>

                <View style={styles.blocoInfoChamada}>
                  <Text style={styles.labelChamada}>Passageiro:</Text>
                  <Text style={styles.nomePassageiroChamada}>{corridaRecebida.passageiro}</Text>
                  
                  <Text style={[styles.labelChamada, { marginTop: 10 }]}>Local do passageiro:</Text>
                  <Text style={styles.enderecoChamada}>{corridaRecebida.busca}</Text>
                  <Text style={styles.distanciaTexto}>{corridaRecebida.distanciaBusca}km de distância</Text>
                  
                  <Text style={[styles.labelChamada, { marginTop: 10 }]}>Destino:</Text>
                  <Text style={styles.enderecoChamada}>{corridaRecebida.destino}</Text>
                  <Text style={styles.distanciaTexto}>{corridaRecebida.distanciaDestino}km de distância</Text>
                </View>

                <View style={styles.acoesCorrida}>
                  <TouchableOpacity style={styles.btnRecusar} onPress={recusarCorrida}>
                    <Text style={styles.btnTextoVermelho}>RECUSAR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btnAceitar, { backgroundColor: temaAgencia.corPrimaria }]} onPress={() => aceitarCorridaReal()}>
                    <Text style={styles.btnTextoBranco}>ACEITAR</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {statusOnline && !corridaRecebida && (
              <View style={styles.radarBuscando}>
                <Animated.View style={[
                  styles.sonarWave, 
                  { transform: [{ scale: sonarScale }], opacity: sonarOpacity }
                ]} />
                <Text style={[styles.textoBuscando, { color: "#46f371" }]}>Procurando passageiros...</Text>
              </View>
            )}
          </>
        )}

        {/* === TELA: EM CORRIDA (Independente se veio do Radar ou Lista) === */}
        {statusOnline && corridaRecebida && corridaAceita && (
          <View style={styles.cartaoEmCorrida}>
            <View style={styles.cabecalhoEmCorrida}>
              <Text style={[styles.tituloEmCorrida, { color: temaAgencia.corPrimaria }]}>🚀 EM CORRIDA</Text>
              <Text style={[styles.valorDestaque, { color: temaAgencia.corPrimaria }]}>R$ {corridaRecebida.valor.toFixed(2)}</Text>
            </View>

            <View style={styles.infoPassageiroMini}>
              <Text>Passageiro: <Text style={{ fontWeight: 'bold' }}>{corridaRecebida.passageiro}</Text></Text>
            </View>

            <View style={styles.blocoEndereco}>
              <Text style={styles.tituloBloco}>📍 BUSCAR EM:</Text>
              <Text style={styles.enderecoTexto}>{corridaRecebida.busca}</Text>
              <View style={styles.botoesGpsLinha}>
                <TouchableOpacity style={[styles.btnGps, styles.waze]} onPress={() => abrirGPS('waze', corridaRecebida.busca)}>
                  <Text style={styles.btnTextoBranco}>Waze</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnGps, styles.maps]} onPress={() => abrirGPS('maps', corridaRecebida.busca)}>
                  <Text style={styles.btnTextoBranco}>Maps</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.divisor} />

            <View style={styles.blocoEndereco}>
              <Text style={styles.tituloBloco}>🏁 LEVAR PARA:</Text>
              <Text style={styles.enderecoTexto}>{corridaRecebida.destino}</Text>
              <View style={styles.botoesGpsLinha}>
                <TouchableOpacity style={[styles.btnGps, styles.waze]} onPress={() => abrirGPS('waze', corridaRecebida.destino)}>
                  <Text style={styles.btnTextoBranco}>Waze</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnGps, styles.maps]} onPress={() => abrirGPS('maps', corridaRecebida.destino)}>
                  <Text style={styles.btnTextoBranco}>Maps</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={[styles.btnFinalizarTotal, { backgroundColor: temaAgencia.corPrimaria }]} onPress={finalizarCorridaReal}>
              <Text style={styles.btnTextoBranco}>FINALIZAR CORRIDA</Text>
            </TouchableOpacity>
          </View>
        )}

        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  areaSeguraApp: { flex: 1 },
  telaRadar: { flex: 1, backgroundColor: '#ffffff' },
  cabecalhoRadar: { padding: 15, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#28a745', elevation: 0 },
  tituloApp: { flex: 1, fontWeight: '900', fontStyle: 'italic', fontSize: 20, color: '#fff', marginRight: 10 },
  botoesCabecalho: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  statusTopoContainer: { alignItems: 'center', justifyContent: 'center' },
  alavancaInterruptor: { width: 60, height: 30, borderRadius: 30, backgroundColor: '#ffffff', justifyContent: 'center', padding: 4, elevation: 2 },
  alavancaAtiva: { backgroundColor: '#f0f0f0' },
  indicadorStatus: { width: 22, height: 22, borderRadius: 11, position: 'absolute' },
  bolinhaVerde: { backgroundColor: '#00e676', right: 4, elevation: 5 },
  bolinhaVermelha: { backgroundColor: '#ff3d00', left: 4, elevation: 5 },
  botaoMenu: { padding: 5 },
  iconeMenu: { fontSize: 30, color: '#fff', fontWeight: 'bold' },
  containerFlutuante: {
    width: '100%',
    alignItems: 'center',
    position: 'absolute',
    top: 63,
    zIndex: 10, 
  },
  blocoGanhos: { 
    width: '50%', 
    backgroundColor: '#ffffff',
    padding: 2, 
    borderRadius: 12, 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#e0e0e0',
    elevation: 5, 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  linhaValorVisibilidade: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 },
  valorGanhos: { fontSize: 20, fontWeight: '900', color: '#28a745' },
  botaoOlho: { padding: 0 },
  
  // --- NOVOS ESTILOS DO MENU ---
  fundoModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end' },
  caixaMenu: { 
    backgroundColor: '#ffffff', 
    width: 230, 
    marginTop: 101, 
    marginRight: 15, 
    borderRadius: 15, 
    paddingVertical: 20, 
    paddingHorizontal: 15,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5
  },
  tituloMenu: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '900',
    color: '#a0a0a0',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  linhaSeparadoraMenu: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginBottom: 10,
  },
  itemMenu: { 
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14, 
    borderBottomWidth: 1, 
    borderBottomColor: '#f9f9f9' 
  },
  textoItemMenu: { 
    fontSize: 16, 
    color: '#333', 
    fontWeight: '700',
    marginLeft: 12
  },
  notificacaoMenuLinha: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeNotificacaoMenu: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#dc3545',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  textoBadgeNotificacaoMenu: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  itemMenuSair: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14, 
    marginTop: 5,
  },
  textoItemMenuSair: {
    fontSize: 16, 
    color: '#dc3545', 
    fontWeight: 'bold',
    marginLeft: 12
  },
  // --- FIM DOS ESTILOS DO MENU ---

  textoFecharBranco: { fontSize: 16, color: '#fff', fontWeight: 'bold' },
  telaCorridasDisponiveis: { flex: 1, backgroundColor: '#fff' },
  cabecalhoModal: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, backgroundColor: '#28a745', alignItems: 'center' },
  tituloModal: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  textoVazio: { textAlign: 'center', marginTop: 50, fontSize: 16, color: '#666' },
  conteudoRadar: { padding: 20, paddingTop: 45, alignItems: 'center', paddingBottom: 40 },
  areaBotaoStatus: { width: '100%', alignItems: 'center', marginBottom: 20 },
  statusTexto: { fontSize: 14, fontWeight: 'bold', color: '#888' },
  cartaoCorrida: { backgroundColor: '#fff', width: '100%', borderRadius: 15, padding: 20, elevation: 8, marginBottom: 20 },
  cabecalhoCartao: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 10, marginBottom: 15 },
  novaCorridaTag: { fontWeight: 'bold', color: '#ff9800', fontSize: 14 },
  valorCorrida: { fontSize: 22, fontWeight: '900', color: '#00c853' },
  cronometroBarra: { width: '100%', height: 5, backgroundColor: '#eee', borderRadius: 5, overflow: 'hidden', marginTop: 10 },
  progresso: { height: '100%', backgroundColor: '#28a745' },
  textoTempo: { textAlign: 'center', fontSize: 12, color: '#dc3545', fontWeight: 'bold', marginVertical: 10 },
  blocoInfoChamada: { marginBottom: 20 },
  labelChamada: { fontSize: 12, color: '#666', textTransform: 'uppercase', fontWeight: 'bold' },
  nomePassageiroChamada: { fontSize: 20, color: '#333', fontWeight: 'bold' },
  enderecoChamada: { fontSize: 16, color: '#222', fontWeight: '600' },
  distanciaTexto: { fontSize: 14, color: '#007bff', fontWeight: '700', marginBottom: 10 },
  acoesCorrida: { flexDirection: 'row', gap: 10 },
  btnRecusar: { flex: 1, backgroundColor: '#ffebee', padding: 15, borderRadius: 8, alignItems: 'center' },
  btnAceitar: { flex: 2, backgroundColor: '#00c853', padding: 15, borderRadius: 8, alignItems: 'center' },
  btnTextoVermelho: { color: '#d32f2f', fontWeight: 'bold', fontSize: 14 },
  btnTextoBranco: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  cartaoEmCorrida: { backgroundColor: '#fff', width: '100%', borderRadius: 15, padding: 20, elevation: 8 },
  cabecalhoEmCorrida: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: '#f0f0f0', paddingBottom: 10, marginBottom: 10 },
  tituloEmCorrida: { color: '#28a745', fontStyle: 'italic', fontSize: 18, fontWeight: 'bold' },
  valorDestaque: { fontSize: 18, fontWeight: '900', backgroundColor: '#e8f5e9', color: '#28a745', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  infoPassageiroMini: { backgroundColor: '#f9f9f9', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#eee', marginBottom: 20 },
  blocoEndereco: { marginBottom: 15 },
  tituloBloco: { fontSize: 12, fontWeight: 'bold', color: '#666', marginBottom: 5 },
  enderecoTexto: { fontSize: 16, fontWeight: '600', marginBottom: 10, color: '#333' },
  botoesGpsLinha: { flexDirection: 'row', gap: 10 },
  btnGps: { flex: 1, padding: 10, borderRadius: 6, alignItems: 'center' },
  waze: { backgroundColor: '#33ccff' },
  maps: { backgroundColor: '#4285f4' },
  divisor: { borderTopWidth: 1, borderTopColor: '#ccc', borderStyle: 'dashed', marginVertical: 20 },
  btnFinalizarTotal: { backgroundColor: '#28a745', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  radarBuscando: { marginTop: 50, alignItems: 'center' },
  sonarWave: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#00e676', marginBottom: 20 },
  textoBuscando: { color: '#00e676', fontWeight: 'bold', fontSize: 16 },

  // --- NOVOS ESTILOS PARA OS BOTÕES (LISTA/RADAR) ---
  botoesModoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 25,
    backgroundColor: '#f5f5f5',
    borderRadius: 30,
    padding: 5,
  },
  botaoModo: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 25,
    alignItems: 'center',
  },
  botaoModoAtivo: {
    backgroundColor: '#28a745',
    elevation: 3,
  },
  textoBotaoModo: {
    color: '#888',
    fontWeight: 'bold',
    fontSize: 14,
  },
  textoBotaoModoAtivo: {
    color: '#fff',
  },

  // --- NOVOS ESTILOS PARA OS CARDS DA LISTA ---
  listaContainer: {
    width: '100%',
    paddingBottom: 10,
  },
  textoVazioLista: {
    textAlign: 'center',
    color: '#888',
    marginTop: 20,
    fontSize: 16,
    fontWeight: 'bold',
  },
  cardCorridaLista: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cabecalhoLista: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    paddingBottom: 10,
    marginBottom: 10,
  },
  nomePassageiroLista: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  valorCorridaLista: {
    fontSize: 20,
    fontWeight: '900',
    color: '#00c853',
  },
  enderecosLista: {
    marginBottom: 15,
    gap: 6,
  },
  enderecoTextoLista: {
    fontSize: 14,
    color: '#555',
    fontWeight: '600',
  },
  quilometragemTextoLista: {
    fontSize: 13,
    color: '#007bff',
    fontWeight: '700',
    marginBottom: 6,
    marginLeft: 18,
  },
  botaoAceitarLista: {
    backgroundColor: '#00c853',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  textoBotaoAceitarLista: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});

// ==========================================
// --- NOVOS ESTILOS DO SÍMBOLO MIL-LIN ---
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
    fontWeight: 'bold',
    color: '#ffffff', 
    letterSpacing: 2,
    marginBottom: 20, 
  },
  textoCarregando: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#e8f5e9', 
    letterSpacing: 3, 
    marginTop: 280, 
  },
  containerLogo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  notebookTela: {
    width: 100,
    height: 50,
    backgroundColor: 'white',
    borderRadius: 8, 
    marginTop: 0,
    marginHorizontal: 0,
    shadowColor: 'rgba(214, 234, 248, 0.699)',
    shadowOffset: { width: 1, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 13,
    elevation: 5, 
  },
  notebookBase: {
    width: 108,
    height: 15,
    backgroundColor: 'white',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 100,
    borderBottomRightRadius: 0,
    borderBottomLeftRadius: 100,
    marginLeft: 10,
    marginTop: 1,
    marginBottom: 15,
    shadowColor: '#1a1717',
    shadowOffset: { width: 3, height: 11 },
    shadowOpacity: 0.8,
    shadowRadius: 11,
    elevation: 10, 
  }
});