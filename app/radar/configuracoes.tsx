import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { motoristaFetch } from '../../services/motoristaApi';

type Offline = 'RadioDireto' | 'Radio' | 'Alerta' | 'Nenhum';
type Preferencias = { offline: Offline; ocupado: boolean };
const OPCOES: { valor: Offline; titulo: string; texto: string; icone: keyof typeof Ionicons.glyphMap }[] = [
  { valor: 'RadioDireto', titulo: 'Receber rádio direto', texto: 'A voz sai na hora, sem precisar de alerta antes, da agência e dos colegas.', icone: 'radio' },
  { valor: 'Radio', titulo: 'Receber rádio', texto: 'A agência fala direto; os colegas mandam alerta e, no 3º, o rádio liga.', icone: 'radio-outline' },
  { valor: 'Alerta', titulo: 'Receber só o alerta', texto: 'Toca o BIP BIP ALERTA, mas o rádio não abre. Você decide se responde.', icone: 'notifications-outline' },
  { valor: 'Nenhum', titulo: 'Não receber nada', texto: 'Offline, ninguém chama você no rádio nem manda alerta.', icone: 'remove-circle-outline' },
];

// Configurações do rádio: o que acontece quando o motorista está offline (salvas no servidor). O Ocupado fica no menu Recursos.
export default function Configuracoes() {
  const navegar = useRouter();
  const [cor, setCor] = useState('#28a745');
  const [preferencias, setPreferencias] = useState<Preferencias | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState(''); const [erro, setErro] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('corAgenciaPrimaria').then(c => { if (c?.trim()) setCor(c.trim()); });
    (async () => {
      try {
        const r = await motoristaFetch('/api/Radio/preferencias');
        if (!r.ok) throw new Error();
        const p = await r.json(); setPreferencias({ offline: p.offline || 'Nenhum', ocupado: !!p.ocupado });
      } catch { setErro('Não foi possível carregar as configurações. Verifique a internet.'); setPreferencias({ offline: 'Nenhum', ocupado: false }); }
    })();
  }, []);
  useEffect(() => { if (!mensagem) return; const t = setTimeout(() => setMensagem(''), 2000); return () => clearTimeout(t); }, [mensagem]);

  async function salvar(novas: Preferencias) {
    const anteriores = preferencias;
    setPreferencias(novas); setSalvando(true); setErro('');
    try {
      const r = await motoristaFetch('/api/Radio/preferencias', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novas) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).mensagem || 'Não foi possível salvar.');
      const p = await r.json(); setPreferencias({ offline: p.offline, ocupado: !!p.ocupado });
      await AsyncStorage.setItem('radioOcupado', String(!!p.ocupado));
      setMensagem('Salvo');
    } catch (e) { setPreferencias(anteriores); setErro((e as Error).message || 'Não foi possível salvar. Tente novamente.'); }
    finally { setSalvando(false); }
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: cor }]} edges={['top', 'left', 'right']}>
      <StatusBar backgroundColor={cor} barStyle="light-content" />
      <View style={s.container}>
        <View style={[s.cabecalho, { backgroundColor: cor }]}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" style={s.voltar} onPress={() => navegar.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={s.titulo}>CONFIGURAÇÕES</Text>
          <View style={{ width: 40 }}>{salvando && <ActivityIndicator color="#fff" />}</View>
        </View>
        {!preferencias ? <ActivityIndicator style={{ marginTop: 40 }} size="large" color={cor} /> : (
          <ScrollView contentContainerStyle={s.conteudo}>
            <View style={s.card}>
              <Text style={s.tituloCard}>Rádio quando estiver offline</Text>
              {OPCOES.map(o => {
                const marcado = preferencias.offline === o.valor;
                return (
                  <Pressable key={o.valor} accessibilityRole="radio" accessibilityState={{ checked: marcado, disabled: salvando }} disabled={salvando}
                    onPress={() => !marcado && salvar({ ...preferencias, offline: o.valor })} style={[s.opcao, marcado && { borderColor: cor, backgroundColor: '#f0fdf4' }]}>
                    <Ionicons name={o.icone} size={22} color={marcado ? cor : '#64748b'} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.opcaoTitulo, marcado && { color: cor }]}>{o.titulo}</Text>
                      <Text style={s.texto}>{o.texto}</Text>
                    </View>
                    <Ionicons name={marcado ? 'radio-button-on' : 'radio-button-off'} size={22} color={marcado ? cor : '#94a3b8'} />
                  </Pressable>
                );
              })}
              <Text style={s.nota}>Vale também com o app fechado, enquanto você continuar logado com “Manter conectado”. O Ocupado fica no menu Recursos.</Text>
            </View>
            {!!mensagem && <Text accessibilityLiveRegion="polite" style={[s.ok, { color: cor }]}>{mensagem}</Text>}
            {!!erro && <Text accessibilityRole="alert" style={s.erro}>{erro}</Text>}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  cabecalho: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16 },
  voltar: { width: 40, height: 40, justifyContent: 'center' },
  titulo: { color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 1 },
  conteudo: { padding: 16, gap: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10, elevation: 2 },
  linhaTitulo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tituloCard: { flex: 1, fontSize: 16, fontWeight: '700', color: '#0f172a' },
  texto: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: '#e2e8f0' },
  opcaoTitulo: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  nota: { fontSize: 12, color: '#94a3b8' },
  ok: { textAlign: 'center', fontWeight: '700' },
  erro: { color: '#b91c1c', textAlign: 'center' },
});
