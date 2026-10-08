import { Ionicons } from '@expo/vector-icons';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatarDuracao, obterUriAudio } from '../services/audioMotorista';

// Áudios que já tocaram sozinhos nesta sessão (a corrida toca uma vez ao chegar; depois só quando o motorista quiser).
const reproduzidosAutomaticamente = new Set<string>();

type Props = { audioId: string; duracaoMs?: number | null; grande?: boolean; cor?: string; reproduzirAoAbrir?: boolean };

export default function PlayerAudio({ audioId, duracaoMs, grande = false, cor = '#047857', reproduzirAoAbrir = false }: Props) {
  const [estado, setEstado] = useState<'parado' | 'carregando' | 'tocando' | 'erro'>('parado');
  const [posicao, setPosicao] = useState(0);
  const [duracao, setDuracao] = useState(duracaoMs || 0);
  const somRef = useRef<Audio.Sound | null>(null);
  const montadoRef = useRef(true);

  // Guarda o áudio no celular assim que ele aparece, mesmo antes de ser ouvido.
  useEffect(() => { obterUriAudio(audioId).catch(() => {}); }, [audioId]);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      somRef.current?.unloadAsync().catch(() => {});
      somRef.current = null;
    };
  }, [audioId]);

  const aoAtualizar = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded || !montadoRef.current) return;
    setPosicao(status.positionMillis);
    if (status.durationMillis) setDuracao(status.durationMillis);
    if (status.didJustFinish) {
      setEstado('parado');
      setPosicao(0);
      somRef.current?.setPositionAsync(0).catch(() => {});
    }
  }, []);

  const alternar = useCallback(async () => {
    try {
      if (estado === 'tocando') {
        await somRef.current?.pauseAsync();
        setEstado('parado');
        return;
      }
      if (!somRef.current) {
        setEstado('carregando');
        const uri = await obterUriAudio(audioId);
        const { sound } = await Audio.Sound.createAsync({ uri }, { progressUpdateIntervalMillis: 250 }, aoAtualizar);
        if (!montadoRef.current) { await sound.unloadAsync(); return; }
        somRef.current = sound;
      }
      await somRef.current.playAsync();
      setEstado('tocando');
    } catch {
      if (montadoRef.current) setEstado('erro');
    }
  }, [audioId, estado, aoAtualizar]);

  useEffect(() => {
    // No navegador o som só pode começar com um toque do usuário.
    if (!reproduzirAoAbrir || Platform.OS === 'web' || reproduzidosAutomaticamente.has(audioId)) return;
    reproduzidosAutomaticamente.add(audioId);
    const espera = setTimeout(() => { alternar(); }, 800);
    return () => clearTimeout(espera);
    // Toca só uma vez por áudio, ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioId, reproduzirAoAbrir]);

  const tempo = estado === 'tocando' || posicao > 0 ? `${formatarDuracao(posicao)} / ${formatarDuracao(duracao)}` : formatarDuracao(duracao);
  const icone = estado === 'tocando' ? 'pause' : estado === 'erro' ? 'refresh' : 'play';

  if (grande) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={estado === 'tocando' ? 'Pausar áudio da corrida' : 'Ouvir áudio da corrida'} onPress={alternar}
        style={[styles.grande, { backgroundColor: cor }]}>
        {estado === 'carregando' ? <ActivityIndicator color="#fff" /> : <Ionicons name={icone} size={30} color="#fff" />}
        <View style={{ flex: 1 }}>
          <Text style={styles.textoGrande}>{estado === 'tocando' ? 'PAUSAR ÁUDIO' : estado === 'erro' ? 'TENTAR DE NOVO' : 'OUVIR ENDEREÇO'}</Text>
          <Text style={styles.tempoGrande}>{estado === 'erro' ? 'Áudio indisponível. Toque para tentar de novo.' : tempo}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.pequeno}>
      <Pressable accessibilityRole="button" accessibilityLabel={estado === 'tocando' ? 'Pausar áudio' : 'Ouvir áudio'} onPress={alternar} hitSlop={8}
        style={[styles.botaoPequeno, { backgroundColor: cor }]}>
        {estado === 'carregando' ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name={icone} size={20} color="#fff" />}
      </Pressable>
      <View style={styles.trilha}><View style={[styles.progresso, { backgroundColor: cor, width: `${duracao ? Math.min(100, (posicao / duracao) * 100) : 0}%` }]} /></View>
      <Text style={styles.tempoPequeno}>{estado === 'erro' ? 'Indisponível' : tempo}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grande: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18, marginTop: 8 },
  textoGrande: { color: '#fff', fontSize: 17, fontWeight: '900' },
  tempoGrande: { color: '#fff', opacity: 0.9, fontSize: 13, marginTop: 2, fontWeight: '600' },
  pequeno: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200 },
  botaoPequeno: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  trilha: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#cbd5e1', overflow: 'hidden' },
  progresso: { height: 4 },
  tempoPequeno: { fontSize: 12, color: '#475569', minWidth: 34, textAlign: 'right' },
});
