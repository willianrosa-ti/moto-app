import { motoristaFetch, obterTokenMotorista, obterRefreshToken, encerrarSessao } from '../../services/motoristaApi';
import WebPwaNotice from '../../components/WebPwaNotice';
import PlayerAudio from '../../components/PlayerAudio';
import AppOverlay from '../../native/AppOverlay';
import { Ionicons } from '@expo/vector-icons';
import * as signalR from '@microsoft/signalr';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import Constants from 'expo-constants';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AppStateStatus } from 'react-native';
import { Alert, Animated, AppState, DeviceEventEmitter, Easing, Linking, Modal, PermissionsAndroid, Platform, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const ficheiroBuzina = require('../../assets/sounds/buzina.mp3');

const API_BASE = 'https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net';
const VERSAO_APP_MOTORISTA = Constants.expoConfig?.version || '1.0.6';

const NOME_AGENCIA_PADRAO = 'RADAR DO MOTORISTA';
const COR_PRIMARIA_PADRAO = '#28a745';
const COR_SECUNDARIA_PADRAO = '#00c853';
const COR_FONTE_CABECALHO_PADRAO = '#ffffff';
const TELEFONE_AGENCIA_PADRAO = '+5500000000000';
const CHAVE_AVISO_GPS_BACKGROUND = 'avisoGpsBackgroundMotorista';

type TemaAgencia = {
  nome: string;
  corPrimaria: string;
  corSecundaria: string;
  corFonteCabecalho: string;
  telefone: string;
};

type AvisoCorridaDirecionada = {
  ativo: boolean;
  segundos: number;
  terminaEm: number;
};

const TEMA_AGENCIA_PADRAO: TemaAgencia = {
  nome: NOME_AGENCIA_PADRAO,
  corPrimaria: COR_PRIMARIA_PADRAO,
  corSecundaria: COR_SECUNDARIA_PADRAO,
  corFonteCabecalho: COR_FONTE_CABECALHO_PADRAO,
  telefone: TELEFONE_AGENCIA_PADRAO,
};

const solicitarPermissoesGpsMotorista = async (pedirSegundoPlano = false) => {
  const permissaoFrente = await Location.requestForegroundPermissionsAsync();

  if (permissaoFrente.status !== 'granted') {
    Alert.alert('Atencao', 'Precisamos do GPS para manter o monitoramento da agencia.');
    return false;
  }

  if (Platform.OS === 'android' && pedirSegundoPlano) {
    const permissaoAtual = await Location.getBackgroundPermissionsAsync();

    if (permissaoAtual.status !== 'granted') {
      const permissaoSegundoPlano = await Location.requestBackgroundPermissionsAsync();

      if (permissaoSegundoPlano.status !== 'granted') {
        const avisoJaMostrado = await AsyncStorage.getItem(CHAVE_AVISO_GPS_BACKGROUND);

        if (!avisoJaMostrado) {
          await AsyncStorage.setItem(CHAVE_AVISO_GPS_BACKGROUND, 'true');
          Alert.alert(
            'GPS em segundo plano',
            'Para o painel acompanhar sua moto com o app minimizado, permita a localizacao o tempo todo nas configuracoes do Android.'
          );
        }
      }
    }
  }

  return true;
};

const solicitarPermissaoNotificacaoAndroid = async () => {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;

  const permissao = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const jaPermitido = await PermissionsAndroid.check(permissao);
  if (jaPermitido) return true;

  const resultado = await PermissionsAndroid.request(permissao);
  return resultado === PermissionsAndroid.RESULTS.GRANTED;
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
  const [confirmarLogoutWeb, setConfirmarLogoutWeb] = useState(false);
  const [confirmarFinalizacaoWeb, setConfirmarFinalizacaoWeb] = useState(false);
  const [alterandoEtapa, setAlterandoEtapa] = useState(false);
  const [mensagemAvisoWeb, setMensagemAvisoWeb] = useState<string | null>(null);
  const [qtdNotificacoesSuporte, setQtdNotificacoesSuporte] = useState(0);
  const [temaAgencia, setTemaAgencia] = useState<TemaAgencia>(TEMA_AGENCIA_PADRAO);
  const [avisoCorridaDirecionada, setAvisoCorridaDirecionada] = useState<AvisoCorridaDirecionada>({ ativo: false, segundos: 5, terminaEm: 0 });
  const [temCorridaAoFinalizar, setTemCorridaAoFinalizar] = useState(false);
  const [atualizacaoDisponivel, setAtualizacaoDisponivel] = useState(false);
  const [verificandoAtualizacao, setVerificandoAtualizacao] = useState(false);
  
  // Agência "somente comunicação": sem corridas, só rádio, áudio e texto. Ocupado: ninguém chama no rádio.
  const [comunicacao, setComunicacao] = useState(false);
  const comunicacaoRef = useRef(false);
  const [ocupado, setOcupado] = useState(false);
  const [valorDiario, setValorDiario] = useState<number>(0); 
  const [mostrarValor, setMostrarValor] = useState(false); 


  // NOVO ESTADO: Controla a tela de carregamento/transição da MIL-LIN
  const [processandoAcesso, setProcessandoAcesso] = useState(false);


  const corridasIgnoradas = useRef<any[]>([]); 
  const corridaAceitaRef = useRef(false);
  const corridaRecebidaRef = useRef<any>(null);
  const statusOnlineRef = useRef(false);
  const estadoAppRef = useRef<AppStateStatus>(AppState.currentState);

  const animacaoRadar = useRef(new Animated.Value(0)).current;
  const [cicloAnimacao, setCicloAnimacao] = useState(0);
  const [radarVisivel, setRadarVisivel] = useState(true);
  const { width: larguraTela, height: alturaTela } = useWindowDimensions();
  const tamanhoRadar = Math.min(larguraTela - 40, 340);
  const navegar = useRouter();

  const exibirAvisoCorridaDirecionada = (segundos = 5) => {
    const segundosNormalizados = Math.max(1, segundos);
    setAvisoCorridaDirecionada({
      ativo: true,
      segundos: segundosNormalizados,
      terminaEm: Date.now() + segundosNormalizados * 1000
    });
  };

  const atualizarContadorCorridaDirecionada = () => {
    setAvisoCorridaDirecionada((estadoAtual) => {
      if (!estadoAtual.ativo) return estadoAtual;

      const segundosRestantes = Math.ceil((estadoAtual.terminaEm - Date.now()) / 1000);
      if (segundosRestantes <= 0) {
        return { ativo: false, segundos: 5, terminaEm: 0 };
      }

      if (segundosRestantes === estadoAtual.segundos) return estadoAtual;
      return { ...estadoAtual, segundos: segundosRestantes };
    });
  };

  const verificarAtualizacaoApp = async () => {
    if (Platform.OS === 'web' || verificandoAtualizacao) return false;

    try {
      setVerificandoAtualizacao(true);

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
      const existeAtualizacaoBackend = Boolean(dadosBackend?.atualizacaoDisponivel);

      setAtualizacaoDisponivel(existeAtualizacaoExpo || existeAtualizacaoBackend);
      return existeAtualizacaoExpo || existeAtualizacaoBackend;
    } catch {
      return false;
    } finally {
      setVerificandoAtualizacao(false);
    }
  };


  const carregarTemaAgenciaSalvo = async () => {
    try {
      const [nome, corPrimaria, corSecundaria, corFonteCabecalho, telefone] = await Promise.all([
        AsyncStorage.getItem('nomeAgencia'),
        AsyncStorage.getItem('corAgenciaPrimaria'),
        AsyncStorage.getItem('corAgenciaSecundaria'),
        AsyncStorage.getItem('corFonteCabecalhoAgencia'),
        AsyncStorage.getItem('telefoneAgencia'),
      ]);

      setTemaAgencia({
        nome: nome?.trim() || TEMA_AGENCIA_PADRAO.nome,
        corPrimaria: corPrimaria?.trim() || TEMA_AGENCIA_PADRAO.corPrimaria,
        corSecundaria: corSecundaria?.trim() || TEMA_AGENCIA_PADRAO.corSecundaria,
        corFonteCabecalho: corFonteCabecalho?.trim() || TEMA_AGENCIA_PADRAO.corFonteCabecalho,
        telefone: telefone?.trim() || TEMA_AGENCIA_PADRAO.telefone,
      });
    } catch (erro) {
      console.log('Erro ao carregar identidade visual da agência:', erro);
    }
  };

  // --- FUNÇÃO PARA GERENCIAR CLIQUES NO MENU COM TRANSIÇÃO ---
  const preferenciasCarregadas = useRef(false);
  const carregarPreferenciasRadio = useCallback(async () => {
    try {
      const resposta = await motoristaFetch('/api/Radio/preferencias');
      if (!resposta.ok) return;
      const p = await resposta.json();
      preferenciasCarregadas.current = true;
      comunicacaoRef.current = !!p.comunicacao; setComunicacao(!!p.comunicacao); setOcupado(!!p.ocupado);
      AsyncStorage.multiSet([['agenciaComunicacao', String(!!p.comunicacao)], ['radioOcupado', String(!!p.ocupado)]]).catch(() => {});
    } catch { /* Sem internet: mantém o que está guardado no aparelho. */ }
  }, []);
  useEffect(() => {
    AsyncStorage.multiGet(['agenciaComunicacao', 'radioOcupado']).then(([[, c], [, o]]) => {
      if (preferenciasCarregadas.current) return;
      comunicacaoRef.current = c === 'true'; setComunicacao(c === 'true'); setOcupado(o === 'true');
    }).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { carregarPreferenciasRadio(); }, [carregarPreferenciasRadio]));

  const executarAcaoMenu = (acao: 'financeiro' | 'notificacoes' | 'suporte' | 'configuracoes') => {
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
      } else if (acao === 'configuracoes') {
        navegar.push('/radar/configuracoes' as any);
      }
    }, 1000);
  };

  // --- NOVA FUNÇÃO DE SAIR (LOGOUT) ---
  const finalizarLogout = async () => {
    try {
      await AppOverlay.stopRideMonitor();
      const token = await AsyncStorage.getItem('tokenMotorista');

      if (token) {
        motoristaFetch(`${API_BASE}/api/Motorista/alterar-status-online`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(false)
        }).catch(() => {});
      }

      await encerrarSessao();
      await AsyncStorage.multiRemove([
        'tokenMotorista',
        'nomeMotorista',
        'idMotorista',
        'manterConectadoMotorista',
        'nomeAgencia',
        'corAgenciaPrimaria',
        'corAgenciaSecundaria',
        'corFonteCabecalhoAgencia',
        'logoAgencia',
        'telefoneAgencia',
      ]);

      setStatusOnline(false);
      statusOnlineRef.current = false;
      setCorridaRecebida(null);
      setCorridaAceita(false);
      setMenuAberto(false);

      if (Platform.OS === 'web') {
        const janela = (globalThis as any).window;
        janela?.location?.replace('/');
        return;
      }

      navegar.replace('/');
    } catch (erro) {
      if (Platform.OS === 'web') {
        setMensagemAvisoWeb("Nao foi possivel sair.");
      } else {
        Alert.alert("Erro", "Nao foi possivel sair.");
      }
    }
  };

  const fazerLogout = async () => {
    if (corridaAceita) {
      if (Platform.OS === 'web') {
        setMenuAberto(false);
        setMensagemAvisoWeb("Finalize a corrida antes de sair do app.");
        return;
      }

      Alert.alert(
        "Corrida em andamento",
        "Finalize a corrida antes de sair do app."
      );
      return;
    }

    if (Platform.OS === 'web') {
      setMenuAberto(false);
      setConfirmarLogoutWeb(true);
      return;
    }

    Alert.alert(
      "Sair do App",
      "Tem certeza que deseja desconectar sua conta?",
      [
        { text: "Cancelar", style: "cancel" },
        { 
          text: "Sair", 
          style: "destructive",
          onPress: finalizarLogout
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
      
      const resposta = await motoristaFetch(`${API_BASE}/api/Motorista/financeiro?filtro=hoje&mes=${mesAtual}`, {
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
  const verificarCorridaAtiva = async (
    opcoes: { mostrarAvisoDirecionada?: boolean; segundos?: number } = {}
  ) => {
    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) return false;

      const resposta = await motoristaFetch(`${API_BASE}/api/Corrida/ativa`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (resposta.status === 200) {
        const corrida = await resposta.json();
        if (corrida) {
          const corridaDirecionada = corrida?.direcionada === true || corrida?.motoristaExclusivoId;
          setCorridaRecebida(corrida); // Puxa os dados para a tela
          setCorridaAceita(true);      // Força o app a abrir a tela de "EM CORRIDA"
          setStatusOnline(true);       // Liga o radar para o GPS continuar rastreando
          statusOnlineRef.current = true;
          setTemCorridaAoFinalizar(corrida?.temCorridaAoFinalizar === true);

          if (opcoes.mostrarAvisoDirecionada && corridaDirecionada) {
            exibirAvisoCorridaDirecionada(opcoes.segundos || 5);
          }

          return true;
        }
      }
    } catch (erro) {
      console.log("Erro ao recuperar corrida ativa:", erro);
    }

    return false;
  };

  const filaConhecidaRef = useRef(new Set<number>());
  const sincronizandoRef = useRef(false);
  const consultarFila = async () => {
    const res = await motoristaFetch('/api/Corrida/fila');
    if (!res.ok) return;
    const fila: { id: number }[] = await res.json();
    const nova = fila.some(c => !filaConhecidaRef.current.has(c.id));
    filaConhecidaRef.current = new Set(fila.map(c => c.id));
    setTemCorridaAoFinalizar(fila.length > 0);
    if (nova && Platform.OS !== 'android') tocarBuzina();
  };
  const sincronizarJornada = async () => {
    if (sincronizandoRef.current || estadoAppRef.current !== 'active' || comunicacaoRef.current) return;
    sincronizandoRef.current = true;
    try {
      await consultarFila();
      const res = await motoristaFetch('/api/Motorista/jornada');
      if (!res.ok) return;
      const jornada = await res.json();
      if (!jornada.podeReceber && !jornada.podeContinuar && statusOnlineRef.current) {
        await motoristaFetch('/api/Motorista/alterar-status-online', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'false' });
        statusOnlineRef.current = false; setStatusOnline(false);
        setCorridaRecebida(null); setCorridaAceita(false);
        const mensagem = jornada.mensagem || 'Seu radar está indisponível. Fale com a agência.';
        if (Platform.OS === 'web') setMensagemAvisoWeb(mensagem); else Alert.alert('Horário de atuação', mensagem);
      } else if (jornada.podeContinuar) {
        await verificarCorridaAtiva();
      } else if (corridaAceitaRef.current) {
        setCorridaAceita(false); corridaAceitaRef.current = false; setCorridaRecebida(null);
      }
      if (jornada.podeReceber && !jornada.podeContinuar && statusOnlineRef.current && filaConhecidaRef.current.size) {
        await motoristaFetch('/api/Corrida/retomar-fila', { method: 'POST' });
        await verificarCorridaAtiva();
      }
    } catch { /* A consulta seguinte recupera após a conexão voltar. */ }
    finally { sincronizandoRef.current = false; }
  };

  useEffect(() => {
    sincronizarJornada();
    const timer = setInterval(sincronizarJornada, 15000);
    return () => clearInterval(timer);
  }, []);

  const buscarNotificacoesSuporteMotorista = async () => {
    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) return;

      const resposta = await motoristaFetch(`${API_BASE}/api/Suporte/minhas-respostas`, {
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
    const parametrosWeb = Platform.OS === 'web'
      ? new URLSearchParams((globalThis as any)?.window?.location?.search || '')
      : null;
    const veioDePushDirecionada = parametrosWeb?.get('direcionada') === '1';

    verificarCorridaAtiva({
      mostrarAvisoDirecionada: Platform.OS === 'android' || veioDePushDirecionada,
      segundos: 5
    });
    buscarNotificacoesSuporteMotorista();
    verificarAtualizacaoApp();
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});

    const intervaloNotificacoes = setInterval(buscarNotificacoesSuporteMotorista, 30000);
    return () => clearInterval(intervaloNotificacoes);
  }, []);
  // --- FIM DA INTEGRAÇÃO ---

  useEffect(() => {
    statusOnlineRef.current = statusOnline;
    AsyncStorage.setItem('radarAtivoMotorista', String(statusOnline));
  }, [statusOnline]);

  useEffect(() => {
    const inscricao = AppState.addEventListener('change', (estado) => {
      estadoAppRef.current = estado;
      AppOverlay.setRideMonitorForeground(estado === 'active').catch(() => {});

      if (estado === 'active') {
        atualizarContadorCorridaDirecionada();
        verificarAtualizacaoApp();
        sincronizarJornada();
      }

      if (estado === 'active') {
        verificarCorridaAtiva({
          mostrarAvisoDirecionada: !corridaRecebidaRef.current && Platform.OS === 'android',
          segundos: 5
        });
      }
    });

    AppOverlay.setRideMonitorForeground(AppState.currentState === 'active').catch(() => {});

    return () => inscricao.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let cancelado = false;

    const sincronizarMonitorNativo = async () => {
      try {

        const token = await AsyncStorage.getItem('tokenMotorista');
        if (cancelado) return;

        if (token) {
          await solicitarPermissaoNotificacaoAndroid();
          await AppOverlay.setRideMonitorForeground(estadoAppRef.current === 'active');
          await AppOverlay.startRideMonitor(token, API_BASE, (await obterRefreshToken()) || '', statusOnline && !comunicacao);
        } else {
          await AppOverlay.stopRideMonitor();
        }
      } catch (error) {
      }
    };

    sincronizarMonitorNativo();

    return () => {
      cancelado = true;
    };
  }, [statusOnline, comunicacao]);

  // Mantém o motorista realmente "online" no painel da agência.
  // Mesmo que o GPS demore a mandar uma posição nova, este pulso atualiza a última atividade no backend.
  const enviarSinalDeVida = async () => {
    try {
      // Em segundo plano no Android, quem envia a posição é o monitor nativo (sem envio em dobro).
      if (Platform.OS === 'android' && estadoAppRef.current !== 'active' && !comunicacaoRef.current) return;
      const token = await AsyncStorage.getItem('tokenMotorista');
      if (!token) return;

      // Conta só de comunicação: avisa que está online, sem enviar a localização.
      if (comunicacaoRef.current) {
        await motoristaFetch(`${API_BASE}/api/Motorista/alterar-status-online`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(true)
        });
        return;
      }

      try {
        const localizacaoAtual = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        setLocalizacaoMotorista(localizacaoAtual);

        await motoristaFetch(`${API_BASE}/api/Motorista/atualizar-localizacao`, {
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
        await motoristaFetch(`${API_BASE}/api/Motorista/alterar-status-online`, {
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
    // A cada 15 s; o painel recebe a posição na hora e o servidor só grava no banco de 30 em 30 s.
    const intervaloSinalDeVida = setInterval(enviarSinalDeVida, 15000);

    return () => clearInterval(intervaloSinalDeVida);
  }, [statusOnline]);

  useEffect(() => {
    let inscricaoLocalizacao: Location.LocationSubscription;

    (async () => {
      const permissaoGps = await solicitarPermissoesGpsMotorista(false);
      if (!permissaoGps) {
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
          
          const segundoPlanoAndroid = Platform.OS === 'android' && estadoAppRef.current !== 'active';
          if (statusOnlineRef.current && !comunicacaoRef.current && !segundoPlanoAndroid) {
            try {
              const token = await AsyncStorage.getItem('tokenMotorista');
              await motoristaFetch(`${API_BASE}/api/Motorista/atualizar-localizacao`, {
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

  const tocarBuzinaExpo = async () => {
    const { sound } = await Audio.Sound.createAsync(ficheiroBuzina);
    await sound.setVolumeAsync(1);
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
      }
    });
  };

  const tocarBuzina = async () => {
    if (Platform.OS === 'android' && estadoAppRef.current !== 'active') {
      try {
        await AppOverlay.playBuzina();
        return;
      } catch (error) {
      }
    }

    try {
      await tocarBuzinaExpo();
      return;
    } catch (error) {
    }

    if (Platform.OS === 'android') {
      try {
        await AppOverlay.playBuzina();
      } catch (error) {
      }
    }
  };

  const prepararCorridaAtribuida = async (segundos = 5) => {
    const encontrouCorrida = await verificarCorridaAtiva({
      mostrarAvisoDirecionada: true,
      segundos
    });

    if (encontrouCorrida) {
      await tocarBuzina();

      if (Platform.OS === 'android') {
        AppOverlay.showOverlay('Corrida').catch(() => {});
      }
    }
  };

  useEffect(() => {
    if (!avisoCorridaDirecionada.ativo) return undefined;

    atualizarContadorCorridaDirecionada();
    const temporizador = setInterval(atualizarContadorCorridaDirecionada, 500);

    return () => clearInterval(temporizador);
  }, [avisoCorridaDirecionada.ativo, avisoCorridaDirecionada.terminaEm]);

  // Som para o modo RADAR
  useEffect(() => {
    if (corridaRecebida && !corridaAceita && !avisoCorridaDirecionada.ativo) {
      setTempoRestante(15); 
      tocarBuzina();
    }
  }, [corridaRecebida, avisoCorridaDirecionada.ativo]);

  useEffect(() => {
    corridaAceitaRef.current = corridaAceita;
  }, [corridaAceita]);


  useEffect(() => {
    corridaRecebidaRef.current = corridaRecebida;
  }, [corridaRecebida]);

  // Ao voltar de Financeiro, Notificações, Suporte etc. ou do segundo plano, a animação é recriada do zero
  // (inclusive a View animada, pela key), para nunca ficar congelada.
  useFocusEffect(useCallback(() => {
    setRadarVisivel(true);
    setCicloAnimacao(ciclo => ciclo + 1);
    return () => setRadarVisivel(false);
  }, []));

  useEffect(() => {
    const inscricao = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') setCicloAnimacao(ciclo => ciclo + 1);
    });
    return () => inscricao.remove();
  }, []);

  useEffect(() => {
    animacaoRadar.stopAnimation();
    animacaoRadar.setValue(0);
    if (!radarVisivel || !statusOnline || corridaRecebida) return;
    const ciclo = Animated.loop(Animated.timing(animacaoRadar, {
      toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true,
    }));
    ciclo.start();
    return () => { ciclo.stop(); animacaoRadar.stopAnimation(); };
  }, [animacaoRadar, radarVisivel, cicloAnimacao, statusOnline, corridaRecebida]);

  useEffect(() => {
    const conexao = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE}/hub-corridas`, { accessTokenFactory: async () => (await obterTokenMotorista()) || '' })
      .withAutomaticReconnect()
      .build();

    conexao.onreconnected(() => { verificarCorridaAtiva(); buscarNotificacoesSuporteMotorista(); setSinalNovaCorrida(gatilho => gatilho + 1); });
    conexao.on('EtapaCorridaAtualizada', () => { verificarCorridaAtiva(); });
    let encerrada = false;
    let tentativa: ReturnType<typeof setTimeout> | undefined;
    const conectar = async () => {
      try { await conexao.start(); if (!encerrada) sincronizarJornada(); }
      catch { if (!encerrada) tentativa = setTimeout(conectar, 5000); }
    };
    conexao.onclose(() => { if (!encerrada) tentativa = setTimeout(conectar, 5000); });
    conectar();

    conexao.on("NovaCorridaDisponivel", () => {
      setSinalNovaCorrida(gatilho => gatilho + 1);
    });

    // NOVO: Gatilho para limpar a tela na mesma hora que alguém aceitar
    conexao.on("CorridaAtribuida", (payload: any) => {
      const segundos = Number(payload?.iniciarEmSegundos || 5);
      prepararCorridaAtribuida(Number.isFinite(segundos) ? segundos : 5);
    });

    conexao.on("CorridaDirecionadaAguardando", () => {
      consultarFila().catch(() => {});
      setTemCorridaAoFinalizar(true);
      buscarNotificacoesSuporteMotorista();
    });

    conexao.on("AtualizarCorridas", () => {
      setSinalNovaCorrida(gatilho => gatilho + 1);
    });

    conexao.on("RespostaSuporteRecebida", (payload: any) => {
      buscarNotificacoesSuporteMotorista();
      AppOverlay.notifyMessage("suporte-" + payload.id, "Resposta de suporte", payload.respostaAgencia || "Sua agência respondeu.").catch(() => {});
    });


    conexao.on("CorridaCancelada", (payload: any) => {
      const corridaIdCancelada = payload?.corridaId;

      setSinalNovaCorrida(gatilho => gatilho + 1);

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
      encerrada = true; clearTimeout(tentativa); conexao.stop();
    }; 
  }, []);

  useEffect(() => {
    let intervaloVida: ReturnType<typeof setInterval>;

    const buscarCorridasReais = async () => {
      if (!statusOnline || comunicacaoRef.current) return;

      try {
        const token = await AsyncStorage.getItem('tokenMotorista'); 
        const resposta = await motoristaFetch(`${API_BASE}/api/Corrida/pendentes`, {
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
      // O servidor avisa na hora quando uma corrida surge, é aceita ou cancelada ("AtualizarCorridas");
      // esta consulta a cada 30 s só cobre um aviso perdido numa queda de internet.
      intervaloVida = setInterval(buscarCorridasReais, 30000); 
    }

    return () => clearInterval(intervaloVida);
  }, [statusOnline, sinalNovaCorrida]);

  // Cronômetro para aceitar a chamada
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (corridaRecebida && !corridaAceita && tempoRestante > 0) {
      timer = setInterval(() => {
        setTempoRestante(prev => prev - 1);
      }, 1000);
    } else if (corridaRecebida && !corridaAceita && tempoRestante === 0) {
      recusarCorrida();
    }
    return () => clearInterval(timer);
  }, [corridaRecebida, corridaAceita, tempoRestante]);

  const alternarStatus = async () => {
    const novoStatus = !statusOnline;
    const token = await AsyncStorage.getItem('tokenMotorista');

    if (!novoStatus && corridaAceita) {
      Alert.alert(
        "Corrida em andamento",
        "Finalize a corrida antes de desligar o radar."
      );
      return;
    }

    if (novoStatus) {
      const permissaoGps = await solicitarPermissoesGpsMotorista(true);
      if (!permissaoGps) return;
    }

    try {
      const resposta = await motoristaFetch(`${API_BASE}/api/Motorista/alterar-status-online`, {
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
        setCorridaAceita(false);
        corridasIgnoradas.current = []; 
        setTempoRestante(15);

        if (novoStatus) {
          await enviarSinalDeVida();
          await motoristaFetch('/api/Corrida/retomar-fila', { method: 'POST' });
          await verificarCorridaAtiva();
        }
      } else {
        const textoErro = await resposta.text();
        let mensagemErro = "Erro ao sincronizar status.";
        try {
          mensagemErro = JSON.parse(textoErro).mensagem || mensagemErro;
        } catch {
          if (textoErro) mensagemErro = textoErro;
        }
        if (Platform.OS === 'web') setMensagemAvisoWeb(mensagemErro); else Alert.alert("Erro", mensagemErro);
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
      
      const resposta = await motoristaFetch(`${API_BASE}/api/Corrida/aceitar/${corridaAlvo.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (resposta.ok) {
        setCorridaRecebida({ ...corridaAlvo, etapa: 'Busca' }); // Fixa a corrida para o app saber qual está ativa
        setCorridaAceita(true); 
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

  const confirmarEtapa = async () => {
    if (!corridaRecebida || alterandoEtapa) return;
    if (corridaRecebida.etapa === 'Destino') { await finalizarCorridaReal(); return; }
    setAlterandoEtapa(true);
    try {
      const resposta = await motoristaFetch('/api/Corrida/embarcar/' + corridaRecebida.id, { method: 'POST' });
      if (!resposta.ok) {
        const dados = await resposta.json().catch(() => ({}));
        throw new Error(dados.mensagem || 'Não foi possível confirmar o embarque.');
      }
      const dados = await resposta.json();
      setCorridaRecebida((atual: any) => atual?.id === corridaRecebida.id ? { ...atual, ...dados } : atual);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'Sem conexão. Tente novamente.';
      if (Platform.OS === 'web') setMensagemAvisoWeb(mensagem); else Alert.alert('Embarque', mensagem);
    } finally { setAlterandoEtapa(false); }
  };

  const pedirConfirmacaoFinalizacao = () => {
    if (!corridaRecebida) return;

    if (Platform.OS === 'web') {
      setConfirmarFinalizacaoWeb(true);
      return;
    }

    Alert.alert(
      corridaRecebida.etapa === 'Destino' ? 'Finalizar corrida' : 'Confirmar embarque',
      corridaRecebida.etapa === 'Destino' ? 'O passageiro chegou ao destino?' : 'O passageiro já está na moto? Isso conclui a etapa de busca.',
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: 'Confirmar',
          onPress: confirmarEtapa
        }
      ]
    );
  };

  const finalizarCorridaReal = async () => {
    if (alterandoEtapa) return;
    setAlterandoEtapa(true);
    try {
      const token = await AsyncStorage.getItem('tokenMotorista');
      
      const resposta = await motoristaFetch(`${API_BASE}/api/Corrida/finalizar/${corridaRecebida.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (resposta.ok) {
        const dadosResposta = await resposta.json().catch(() => ({}));
        setValorDiario(prev => prev + corridaRecebida.valor);
        setTemCorridaAoFinalizar(false);
        if (dadosResposta.foraDoHorario) {
          setStatusOnline(false); statusOnlineRef.current = false;
        }
        setTempoRestante(15);
        setSinalNovaCorrida(gatilho => gatilho + 1);

        if (dadosResposta?.proximaCorridaAtivada) {
          await verificarCorridaAtiva({
            mostrarAvisoDirecionada: true,
            segundos: 5
          });
        } else {
          setCorridaAceita(false);
          setCorridaRecebida(null);
        }

        buscarGanhosDoDia();
      } else {
        Alert.alert("Erro", "Erro ao finalizar.");
      }
    } catch (erro) {
      Alert.alert("Erro", "Sem conexão.");
    } finally { setAlterandoEtapa(false); }
  };

  const abrirGPS = (app: string, enderecoParaIr: string) => {
    const destinoEncoded = encodeURIComponent(enderecoParaIr);
    if (app === 'waze') {
      Linking.openURL(`https://waze.com/ul?q=${destinoEncoded}&navigate=yes`);
    } else {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destinoEncoded}`);
    }
  };


  // Três ondas defasadas em 1/3 do ciclo, todas dirigidas pelo mesmo valor animado.
  const interpolarOnda = (fase: number, inicio: number, fim: number) => {
    if (fase === 0) return animacaoRadar.interpolate({ inputRange: [0, 1], outputRange: [inicio, fim] });
    const corte = 1 - fase;
    const pontoInicial = inicio + (fim - inicio) * fase;
    return animacaoRadar.interpolate({ inputRange: [0, corte, corte + 0.0001, 1], outputRange: [pontoInicial, fim, inicio, pontoInicial] });
  };
  const ondasRadar = [0, 1 / 3, 2 / 3].map(fase => ({
    escala: interpolarOnda(fase, 0.18, 1),
    opacidade: interpolarOnda(fase, 0.55, 0),
  }));

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
        <Text style={[styles.tituloApp, { color: temaAgencia.corFonteCabecalho }]} numberOfLines={1}>{temaAgencia.nome.toUpperCase()}</Text>
        
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
            {ocupado && <Text accessibilityLabel="Você está ocupado no rádio" style={{ color: '#fff', backgroundColor: '#b45309', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: 6 }}>OCUPADO</Text>}
          </View>

          <TouchableOpacity style={styles.botaoMenu} onPress={() => setMenuAberto(true)}>
            <Text style={[styles.iconeMenu, { color: temaAgencia.corFonteCabecalho }]}>≡</Text>
            {(qtdNotificacoesSuporte > 0 || atualizacaoDisponivel) && <View style={styles.badgeMenuRecursos} />}
          </TouchableOpacity>
        </View>
      </View>

      {!comunicacao && <View style={styles.containerFlutuante}>
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
      </View>}

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
                {!comunicacao && <TouchableOpacity style={styles.itemMenu} onPress={() => executarAcaoMenu('financeiro')}>
                  <Ionicons name="cash-outline" size={20} color={temaAgencia.corPrimaria} />
                  <Text style={styles.textoItemMenu}>FINANCEIRO</Text>
                </TouchableOpacity>}

                <TouchableOpacity style={styles.itemMenu} onPress={() => executarAcaoMenu('configuracoes')}>
                  <Ionicons name="settings-outline" size={20} color={temaAgencia.corPrimaria} />
                  <Text style={styles.textoItemMenu}>CONFIGURAÇÕES</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.itemMenu} onPress={() => executarAcaoMenu('notificacoes')}>
                  <Ionicons name="notifications-outline" size={20} color={temaAgencia.corPrimaria} />
                  <View style={styles.notificacaoMenuLinha}>
                    <Text style={styles.textoItemMenu}>NOTIFICAÇÕES</Text>
                    {(qtdNotificacoesSuporte > 0 || atualizacaoDisponivel) && (
                      <View style={styles.badgeNotificacaoMenu}>
                        <Text style={styles.textoBadgeNotificacaoMenu}>{qtdNotificacoesSuporte + (atualizacaoDisponivel ? 1 : 0)}</Text>
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

      {Platform.OS === 'web' && (
        <Modal
          visible={confirmarLogoutWeb}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setConfirmarLogoutWeb(false)}
        >
          <View style={styles.fundoConfirmacaoWeb}>
            <View style={styles.caixaConfirmacaoWeb}>
              <Text style={styles.tituloConfirmacaoWeb}>Sair do App</Text>
              <Text style={styles.textoConfirmacaoWeb}>
                Tem certeza que deseja desconectar sua conta?
              </Text>

              <View style={styles.botoesConfirmacaoWeb}>
                <TouchableOpacity
                  style={styles.botaoCancelarConfirmacaoWeb}
                  onPress={() => setConfirmarLogoutWeb(false)}
                >
                  <Text style={styles.textoCancelarConfirmacaoWeb}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.botaoSairConfirmacaoWeb}
                  onPress={async () => {
                    setConfirmarLogoutWeb(false);
                    await finalizarLogout();
                  }}
                >
                  <Text style={styles.textoSairConfirmacaoWeb}>Sair</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {Platform.OS === 'web' && (
        <Modal
          visible={confirmarFinalizacaoWeb}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setConfirmarFinalizacaoWeb(false)}
        >
          <View style={styles.fundoConfirmacaoWeb}>
            <View style={styles.caixaConfirmacaoWeb}>
              <Text style={styles.tituloConfirmacaoWeb}>{corridaRecebida?.etapa === 'Destino' ? 'Finalizar corrida' : 'Confirmar embarque'}</Text>
              <Text style={styles.textoConfirmacaoWeb}>
                {corridaRecebida?.etapa === 'Destino' ? 'O passageiro chegou ao destino?' : 'O passageiro já está na moto?'}
              </Text>

              <View style={styles.botoesConfirmacaoWeb}>
                <TouchableOpacity
                  style={styles.botaoCancelarConfirmacaoWeb}
                  onPress={() => setConfirmarFinalizacaoWeb(false)}
                >
                  <Text style={styles.textoCancelarConfirmacaoWeb}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.botaoSairConfirmacaoWeb}
                  onPress={async () => {
                    setConfirmarFinalizacaoWeb(false);
                    await confirmarEtapa();
                  }}
                >
                  <Text style={styles.textoSairConfirmacaoWeb}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {Platform.OS === 'web' && (
        <Modal
          visible={!!mensagemAvisoWeb}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setMensagemAvisoWeb(null)}
        >
          <View style={styles.fundoConfirmacaoWeb}>
            <View style={styles.caixaConfirmacaoWeb}>
              <Text style={styles.tituloConfirmacaoWeb}>Aviso</Text>
              <Text style={styles.textoConfirmacaoWeb}>{mensagemAvisoWeb}</Text>

              <TouchableOpacity
                style={styles.botaoOkConfirmacaoWeb}
                onPress={() => setMensagemAvisoWeb(null)}
              >
                <Text style={styles.textoSairConfirmacaoWeb}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <ScrollView contentContainerStyle={styles.conteudoRadar}>
        <WebPwaNotice corPrimaria={temaAgencia.corPrimaria} />

        {comunicacao && (
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 22, gap: 12, alignItems: 'center', marginTop: 12, elevation: 2 }}>
            <Ionicons name="radio-outline" size={44} color={temaAgencia.corPrimaria} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a', textAlign: 'center' }}>Rádio, áudio e mensagens</Text>
            <Text style={{ fontSize: 14, color: '#64748b', textAlign: 'center' }}>
              {!statusOnline ? 'Você está offline. Em Configurações você escolhe se recebe rádio ou alerta assim.' : ocupado ? 'Você está ocupado: ninguém chama você no rádio.' : 'Você está disponível no rádio.'}
            </Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => DeviceEventEmitter.emit('abrirConversa', {})}
              style={{ backgroundColor: temaAgencia.corPrimaria, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 22, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Ionicons name="chatbubbles-outline" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700' }}>Abrir conversas</Text>
            </TouchableOpacity>
          </View>
        )}

        {!statusOnline && (
          <View style={styles.areaBotaoStatus}>
            <Text style={styles.statusTexto}>Você está offline</Text>
          </View>
        )}

        {/* === CORRIDA DIRECIONADA === */}
        {statusOnline && avisoCorridaDirecionada.ativo && corridaRecebida ? (
          <View style={styles.cartaoCorridaDirecionada}>
            <View style={[styles.iconeDirecionada, { borderColor: temaAgencia.corPrimaria }]}>
              <Ionicons name="navigate" size={34} color={temaAgencia.corPrimaria} />
            </View>

            <Text style={[styles.tituloCorridaDirecionada, { color: temaAgencia.corPrimaria }]}>
              Corrida direcionada para voce
            </Text>

            <Text style={styles.textoCorridaDirecionada}>
              A corrida ira iniciar em
            </Text>

            <View style={[styles.contadorDirecionada, { backgroundColor: temaAgencia.corPrimaria }]}>
              <Text style={styles.numeroContadorDirecionada}>{avisoCorridaDirecionada.segundos}</Text>
            </View>

            <Text style={styles.textoCorridaDirecionadaSecundario}>
              Prepare-se para buscar o passageiro. A buzina continua ativa.
            </Text>
          </View>
        ) : (
          <>
            {statusOnline && corridaRecebida && !corridaAceita && !avisoCorridaDirecionada.ativo && (
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

            {statusOnline && !comunicacao && !corridaRecebida && !avisoCorridaDirecionada.ativo && (
              <View style={[styles.radarBuscando, { minHeight: alturaTela * 0.55 }]}>
                <View key={cicloAnimacao} style={[styles.radarArea, { width: tamanhoRadar, height: tamanhoRadar }]}>
                  <View style={[styles.radarAnel, { width: tamanhoRadar, height: tamanhoRadar, borderRadius: tamanhoRadar / 2 }]} />
                  <View style={[styles.radarAnel, { width: tamanhoRadar * 0.62, height: tamanhoRadar * 0.62, borderRadius: tamanhoRadar * 0.31 }]} />
                  {ondasRadar.map((onda, indice) => (
                    <Animated.View
                      key={indice}
                      style={[styles.sonarWave, { width: tamanhoRadar, height: tamanhoRadar, borderRadius: tamanhoRadar / 2, transform: [{ scale: onda.escala }], opacity: onda.opacidade }]}
                    />
                  ))}
                  <View style={styles.radarCentro}>
                    <Ionicons name="navigate" size={36} color="#fff" />
                  </View>
                </View>
                <Text style={styles.textoBuscando}>Procurando passageiros...</Text>
              </View>
            )}
          </>
        )}

        {/* === TELA: EM CORRIDA === */}
        {statusOnline && corridaRecebida && corridaAceita && !avisoCorridaDirecionada.ativo && (
          <View style={styles.cartaoEmCorrida}>
            <View style={styles.cabecalhoEmCorrida}>
              <Text style={[styles.tituloEmCorrida, { color: temaAgencia.corPrimaria }]}>{corridaRecebida.etapa === 'Destino' ? '🏁 LEVANDO PASSAGEIRO' : '📍 BUSCANDO PASSAGEIRO'}</Text>
              <Text style={[styles.valorDestaque, { color: temaAgencia.corPrimaria }]}>R$ {corridaRecebida.valor.toFixed(2)}</Text>
            </View>

            <View style={styles.infoPassageiroMini}>
              <Text>Passageiro: <Text style={{ fontWeight: 'bold' }}>{corridaRecebida.passageiro}</Text></Text>
            </View>

            {/* Corrida por áudio: o endereço está na gravação da agência e pode ser ouvido quantas vezes precisar. */}
            {corridaRecebida.audioId ? (
              <View style={styles.blocoEndereco}>
                <Text style={styles.tituloBloco}>{corridaRecebida.etapa === 'Destino' ? '✓ BUSCA CONCLUÍDA · ENDEREÇO NO ÁUDIO' : '🎤 ENDEREÇO NO ÁUDIO DA AGÊNCIA'}</Text>
                <PlayerAudio audioId={corridaRecebida.audioId} duracaoMs={corridaRecebida.duracaoAudioMs} grande cor={temaAgencia.corPrimaria} />
                <Text style={styles.textoAudioCorrida}>Ouça quantas vezes precisar até finalizar a corrida.</Text>
              </View>
            ) : (
              <>
              <View style={styles.blocoEndereco}>
                <Text style={styles.tituloBloco}>{corridaRecebida.etapa === 'Destino' ? '✓ BUSCA CONCLUÍDA' : '1 · BUSCAR EM:'}</Text>
                <Text style={styles.enderecoTexto}>{corridaRecebida.busca}</Text>
                <Text style={styles.distanciaTextoCompacta}>{formatarQuilometragem(corridaRecebida.distanciaBusca)}</Text>
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
                <Text style={styles.tituloBloco}>2 · LEVAR PARA:</Text>
                <Text style={styles.enderecoTexto}>{corridaRecebida.destino}</Text>
                <Text style={styles.distanciaTextoCompacta}>{formatarQuilometragem(corridaRecebida.distanciaDestino)}</Text>
                <View style={styles.botoesGpsLinha}>
                  <TouchableOpacity style={[styles.btnGps, styles.waze]} onPress={() => abrirGPS('waze', corridaRecebida.destino)}>
                    <Text style={styles.btnTextoBranco}>Waze</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btnGps, styles.maps]} onPress={() => abrirGPS('maps', corridaRecebida.destino)}>
                    <Text style={styles.btnTextoBranco}>Maps</Text>
                  </TouchableOpacity>
                </View>
              </View>
              </>
            )}

            <TouchableOpacity style={[styles.btnFinalizarTotal, { backgroundColor: temaAgencia.corPrimaria }]} disabled={alterandoEtapa} onPress={pedirConfirmacaoFinalizacao}>
              <Text style={styles.btnTextoBranco}>{alterandoEtapa ? 'SALVANDO...' : corridaRecebida.etapa === 'Destino' ? 'FINALIZAR CORRIDA' : 'PASSAGEIRO EMBARCADO'}</Text>
            </TouchableOpacity>

            {temCorridaAoFinalizar && (
              <View style={[styles.caixaProximaCorrida, { borderColor: temaAgencia.corPrimaria }]}>
                <Ionicons name="notifications" size={20} color={temaAgencia.corPrimaria} />
                <Text style={styles.textoProximaCorrida}>Voce tem uma nova corrida ao finalizar essa.</Text>
              </View>
            )}
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
  botaoMenu: { padding: 5, position: 'relative' },
  iconeMenu: { fontSize: 30, color: '#fff', fontWeight: 'bold' },
  badgeMenuRecursos: {
    position: 'absolute',
    top: 4,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#dc3545',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
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
  fundoConfirmacaoWeb: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  caixaConfirmacaoWeb: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },
  tituloConfirmacaoWeb: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1f2937',
    marginBottom: 10,
  },
  textoConfirmacaoWeb: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
    marginBottom: 18,
  },
  botoesConfirmacaoWeb: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  botaoCancelarConfirmacaoWeb: {
    minWidth: 96,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  botaoSairConfirmacaoWeb: {
    minWidth: 96,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#dc3545',
    alignItems: 'center',
  },
  botaoOkConfirmacaoWeb: {
    alignSelf: 'flex-end',
    minWidth: 96,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#dc3545',
    alignItems: 'center',
  },
  textoCancelarConfirmacaoWeb: {
    fontSize: 15,
    fontWeight: '800',
    color: '#374151',
  },
  textoSairConfirmacaoWeb: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ffffff',
  },
  // --- FIM DOS ESTILOS DO MENU ---

  textoFecharBranco: { fontSize: 16, color: '#fff', fontWeight: 'bold' },
  telaCorridasDisponiveis: { flex: 1, backgroundColor: '#fff' },
  cabecalhoModal: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, backgroundColor: '#28a745', alignItems: 'center' },
  tituloModal: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  textoVazio: { textAlign: 'center', marginTop: 50, fontSize: 16, color: '#666' },
  conteudoRadar: { flexGrow: 1, padding: 20, paddingTop: 45, alignItems: 'center', paddingBottom: 110 },
  areaBotaoStatus: { width: '100%', alignItems: 'center', marginBottom: 20 },
  statusTexto: { fontSize: 14, fontWeight: 'bold', color: '#888' },
  cartaoCorrida: { backgroundColor: '#fff', width: '100%', borderRadius: 15, padding: 20, elevation: 8, marginBottom: 20 },
  cartaoCorridaDirecionada: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 24,
    alignItems: 'center',
    elevation: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 20,
  },
  iconeDirecionada: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    marginBottom: 16,
  },
  tituloCorridaDirecionada: {
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  textoCorridaDirecionada: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '700',
    textAlign: 'center',
  },
  contadorDirecionada: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
  },
  numeroContadorDirecionada: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '900',
  },
  textoCorridaDirecionadaSecundario: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6b7280',
    textAlign: 'center',
    fontWeight: '700',
  },
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
  distanciaTextoCompacta: { fontSize: 13, color: '#007bff', fontWeight: '800', marginTop: -5, marginBottom: 8 },
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
  textoAudioCorrida: { fontSize: 12, color: '#6b7280', marginTop: 8, textAlign: 'center' },
  divisor: { borderTopWidth: 1, borderTopColor: '#ccc', borderStyle: 'dashed', marginVertical: 20 },
  btnFinalizarTotal: { backgroundColor: '#28a745', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  caixaProximaCorrida: {
    marginTop: 12,
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textoProximaCorrida: {
    flex: 1,
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  radarBuscando: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 28, paddingVertical: 10 },
  radarArea: { alignItems: 'center', justifyContent: 'center' },
  radarAnel: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(0, 200, 83, 0.28)' },
  sonarWave: { position: 'absolute', backgroundColor: '#00c853' },
  radarCentro: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#00c853', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#00c853', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  textoBuscando: { color: '#00a344', fontWeight: 'bold', fontSize: 18 },
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
