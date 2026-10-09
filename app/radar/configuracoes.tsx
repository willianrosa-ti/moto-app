import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { motoristaFetch } from '../../services/motoristaApi';
import { NIVEIS_BIPE, definirVolumeBipe, lerVolumeBipe } from '../../services/volumeBipe';
import { tocarBipeTeste } from '../../components/RadioProvider';

type Preferencias = {
  offlineRadio: boolean; radioDireto: boolean; offlineAlerta: boolean;
  ocupadoRadio: boolean; ocupadoAlerta: boolean; ocupadoCorrida: boolean;
};
const PADRAO: Preferencias = { offlineRadio: false, radioDireto: false, offlineAlerta: false, ocupadoRadio: false, ocupadoAlerta: false, ocupadoCorrida: true };

// Configurações do rádio: o que chega quando o motorista está ocupado ou offline (salvas no servidor)
// e o volume do bipe (neste aparelho). A chave Ocupado fica no menu Recursos.
export default function Configuracoes() {
  const navegar = useRouter();
  const [cor, setCor] = useState('#28a745');
  const [preferencias, setPreferencias] = useState<Preferencias | null>(null);
  const [comunicacao, setComunicacao] = useState(false);
  const [volume, setVolume] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState(''); const [erro, setErro] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('corAgenciaPrimaria').then(c => { if (c?.trim()) setCor(c.trim()); });
    lerVolumeBipe().then(setVolume);
    (async () => {
      try {
        const r = await motoristaFetch('/api/Radio/preferencias');
        if (!r.ok) throw new Error();
        const p = await r.json();
        setComunicacao(!!p.comunicacao);
        setPreferencias({
          offlineRadio: !!p.offlineRadio, radioDireto: !!p.radioDireto, offlineAlerta: !!p.offlineAlerta,
          ocupadoRadio: !!p.ocupadoRadio, ocupadoAlerta: !!p.ocupadoAlerta, ocupadoCorrida: p.ocupadoCorrida !== false,
        });
      } catch { setErro('Não foi possível carregar as configurações. Verifique a internet.'); setPreferencias(PADRAO); }
    })();
  }, []);
  useEffect(() => { if (!mensagem) return; const t = setTimeout(() => setMensagem(''), 2000); return () => clearTimeout(t); }, [mensagem]);

  async function alterar(campo: keyof Preferencias, valor: boolean) {
    if (!preferencias) return;
    const anteriores = preferencias;
    const novas = { ...preferencias, [campo]: valor };
    // Rádio direto só faz sentido com o rádio ligado.
    if (campo === 'offlineRadio' && !valor) novas.radioDireto = false;
    setPreferencias(novas); setSalvando(true); setErro('');
    try {
      const r = await motoristaFetch('/api/Radio/preferencias', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novas) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).mensagem || 'Não foi possível salvar.');
      setMensagem('Salvo');
    } catch (e) { setPreferencias(anteriores); setErro((e as Error).message || 'Não foi possível salvar. Tente novamente.'); }
    finally { setSalvando(false); }
  }

  async function escolherVolume(valor: number) {
    setVolume(valor);
    await definirVolumeBipe(valor);
    tocarBipeTeste();
  }

  const linha = (campo: keyof Preferencias, titulo: string, texto: string, icone: keyof typeof Ionicons.glyphMap, desativado = false) => (
    <View style={[s.linha, desativado && { opacity: 0.45 }]}>
      <Ionicons name={icone} size={22} color={preferencias?.[campo] ? cor : '#64748b'} />
      <View style={{ flex: 1 }}>
        <Text style={s.opcaoTitulo}>{titulo}</Text>
        <Text style={s.texto}>{texto}</Text>
      </View>
      <Switch value={!!preferencias?.[campo]} disabled={salvando || desativado} onValueChange={v => alterar(campo, v)}
        trackColor={{ true: cor }} accessibilityLabel={titulo} />
    </View>
  );

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
              <Text style={s.tituloCard}>Quando estiver ocupado, quero receber:</Text>
              {linha('ocupadoRadio', 'Rádio', 'A agência e os colegas podem falar com você.', 'radio-outline')}
              {linha('ocupadoAlerta', 'Alerta', 'Toca o BIP BIP ALERTA quando alguém chamar.', 'notifications-outline')}
              {!comunicacao && linha('ocupadoCorrida', 'Corrida', 'Continua recebendo as corridas oferecidas pela agência.', 'navigate-outline')}
              <Text style={s.nota}>O Ocupado liga e desliga no menu Recursos.</Text>
            </View>

            <View style={s.card}>
              <Text style={s.tituloCard}>Quando estiver offline, quero receber:</Text>
              {linha('offlineRadio', 'Rádio', 'A agência fala direto; os colegas mandam alerta e, no 3º, o rádio liga.', 'radio-outline')}
              {linha('radioDireto', 'Rádio direto', 'A voz sai na hora, sem precisar de alerta antes, também dos colegas.', 'radio', !preferencias.offlineRadio)}
              {linha('offlineAlerta', 'Alerta', 'Toca o BIP BIP ALERTA quando alguém chamar.', 'notifications-outline')}
              <Text style={s.nota}>Vale também com o app fechado, enquanto você continuar logado com “Manter conectado”.</Text>
            </View>

            <View style={s.card}>
              <Text style={s.tituloCard}>Volume do bipe do rádio</Text>
              <Text style={s.texto}>Só o PRI RADIO (ao apertar para falar e quando o outro começa). A voz de quem fala não muda.</Text>
              <View style={s.niveis} accessibilityRole="radiogroup">
                {NIVEIS_BIPE.map(n => {
                  const marcado = Math.abs(volume - n) < 0.01;
                  return (
                    <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: marcado }} accessibilityLabel={n === 0 ? 'Bipe mudo' : `Bipe ${n * 100}%`}
                      onPress={() => escolherVolume(n)} style={[s.nivel, marcado && { backgroundColor: cor, borderColor: cor }]}>
                      <Text style={[s.nivelTexto, marcado && { color: '#fff' }]}>{n === 0 ? 'Mudo' : `${n * 100}%`}</Text>
                    </Pressable>
                  );
                })}
              </View>
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
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12, elevation: 2 },
  tituloCard: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  opcaoTitulo: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  texto: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  nota: { fontSize: 12, color: '#94a3b8' },
  niveis: { flexDirection: 'row', gap: 8 },
  nivel: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#cbd5e1', alignItems: 'center' },
  nivelTexto: { fontWeight: '700', color: '#334155' },
  ok: { textAlign: 'center', fontWeight: '700' },
  erro: { color: '#b91c1c', textAlign: 'center' },
});
