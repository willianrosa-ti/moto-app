import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const API_BASE = 'https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net';
const REFRESH_KEY = 'refreshTokenMotorista';
let renovacao: Promise<string | null> | null = null;
let sessaoEncerrada: (() => void) | null = null;
let versaoSessao = 0;
let escrita: Promise<unknown> = Promise.resolve();
function serializarEscrita<T>(acao: () => Promise<T>): Promise<T> {
  const resultado = escrita.then(acao);
  escrita = resultado.catch(() => {});
  return resultado;
}

export function observarSessaoEncerrada(callback: () => void) {
  sessaoEncerrada = callback;
  return () => { if (sessaoEncerrada === callback) sessaoEncerrada = null; };
}

export async function obterRefreshToken() {
  return Platform.OS === 'web' ? AsyncStorage.getItem(REFRESH_KEY) : SecureStore.getItemAsync(REFRESH_KEY);
}

export async function salvarSessao(dados: { token: string; tokenExpiraEm?: string; refreshToken?: string | null }) {
  return persistirSessao(dados, ++versaoSessao);
}

function persistirSessao(dados: { token: string; tokenExpiraEm?: string; refreshToken?: string | null }, versao: number) {
  return serializarEscrita(async () => {
  if (versao !== versaoSessao) return false;
  await AsyncStorage.multiSet([
    ['tokenMotorista', dados.token],
    ['tokenExpiraEmMotorista', dados.tokenExpiraEm || new Date(Date.now() + 12 * 3600000).toISOString()],
  ]);
  if (dados.refreshToken) {
    if (Platform.OS === 'web') await AsyncStorage.setItem(REFRESH_KEY, dados.refreshToken);
    else await SecureStore.setItemAsync(REFRESH_KEY, dados.refreshToken);
  } else {
    if (Platform.OS === 'web') await AsyncStorage.removeItem(REFRESH_KEY);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
  return true;
  });
}

export async function limparSessao() {
  ++versaoSessao;
  return serializarEscrita(async () => {
  await AsyncStorage.multiRemove(['tokenMotorista', 'tokenExpiraEmMotorista', 'manterConectadoMotorista']);
  if (Platform.OS === 'web') await AsyncStorage.removeItem(REFRESH_KEY);
  else await SecureStore.deleteItemAsync(REFRESH_KEY);
  });
}

export async function renovarSessao(): Promise<string | null> {
  if (renovacao) return renovacao;
  const versao = versaoSessao;
  renovacao = (async () => {
    const refreshToken = await obterRefreshToken();
    if (!refreshToken) {
      if (versao === versaoSessao) { await limparSessao(); sessaoEncerrada?.(); } return null;
    }
    const resposta = await fetch(`${API_BASE}/api/Autenticacao/renovar-motorista`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
    });
    if (resposta.status === 401 || resposta.status === 403) {
      if (versao === versaoSessao) { await limparSessao(); sessaoEncerrada?.(); } return null;
    }
    if (!resposta.ok) throw new Error('Não foi possível renovar a sessão. Tente novamente quando houver conexão.');
    const dados = await resposta.json();
    return await persistirSessao(dados, versao) ? dados.token as string : null;
  })().finally(() => { renovacao = null; });
  return renovacao;
}

export async function obterTokenMotorista(): Promise<string | null> {
  const token = await AsyncStorage.getItem('tokenMotorista');
  if (!token) return null;
  const expira = await AsyncStorage.getItem('tokenExpiraEmMotorista');
  if (expira && Date.parse(expira) <= Date.now() + 60000) return renovarSessao();
  return token;
}

export async function motoristaFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token = await obterTokenMotorista();
  const url = input.startsWith('/') ? `${API_BASE}${input}` : input;
  const enviar = () => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  let resposta = await enviar();
  if (resposta.status === 401 && token) {
    token = await renovarSessao();
    if (token) resposta = await enviar();
  }
  return resposta;
}

export async function encerrarSessao() {
  const refreshToken = await obterRefreshToken();
  if (refreshToken) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(`${API_BASE}/api/Autenticacao/encerrar-sessao-motorista`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }), signal: controller.signal,
      });
    } catch { /* A saída local continua disponível sem internet. */ }
    finally { clearTimeout(timeout); }
  }
  await limparSessao();
}
