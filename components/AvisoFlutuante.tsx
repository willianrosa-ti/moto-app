import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import { buscarAvisos, marcarAvisoVisto, observarAvisos, type AvisoMotorista } from '../services/avisos';

const dataHora = (valor: string) => new Date(/Z|[+-]\d\d:\d\d$/.test(valor) ? valor : `${valor}Z`)
  .toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Avisos da agência aparecem no meio da tela, por cima de qualquer página (radar, financeiro, notificações, corrida...).
// Só o X vermelho fecha o aviso; depois ele continua disponível em Notificações.
export default function AvisoFlutuante() {
  const pathname = usePathname();
  const ativo = pathname.startsWith('/radar');
  const [fila, setFila] = useState<AvisoMotorista[]>([]);
  const [nomeAgencia, setNomeAgencia] = useState('');
  const fechadosRef = useRef(new Set<number>());
  const pendentesRef = useRef(new Set<number>());
  const consultandoRef = useRef(false);

  const adicionar = useCallback((avisos: AvisoMotorista[]) => {
    setFila(atual => {
      const ids = new Set(atual.map(a => a.id));
      const novos = avisos.filter(a => !a.vistoEm && !fechadosRef.current.has(a.id) && !ids.has(a.id));
      return novos.length ? [...atual, ...novos].sort((a, b) => a.id - b.id) : atual;
    });
  }, []);

  const confirmarLeitura = useCallback((id: number) => {
    pendentesRef.current.add(id);
    marcarAvisoVisto(id).then(() => { pendentesRef.current.delete(id); }).catch(() => {});
  }, []);

  const sincronizar = useCallback(async () => {
    if (consultandoRef.current) return;
    consultandoRef.current = true;
    pendentesRef.current.forEach(confirmarLeitura);
    try {
      const dados = await buscarAvisos();
      setNomeAgencia(dados.nomeAgencia);
      adicionar(dados.avisos);
    } catch { /* Sem conexão: tenta de novo no próximo ciclo. */ }
    finally { consultandoRef.current = false; }
  }, [adicionar, confirmarLeitura]);

  useEffect(() => {
    if (!ativo) { setFila([]); return; }
    sincronizar();
    const parar = observarAvisos(aviso => {
      if (aviso.nomeAgencia) setNomeAgencia(aviso.nomeAgencia);
      adicionar([aviso]);
      Vibration.vibrate(400);
    });
    const intervalo = setInterval(() => { if (AppState.currentState === 'active') sincronizar(); }, 20000);
    const estado = AppState.addEventListener('change', s => { if (s === 'active') sincronizar(); });
    return () => { parar(); clearInterval(intervalo); estado.remove(); };
  }, [ativo, sincronizar, adicionar]);

  const atual = fila[0];
  const fechar = () => {
    if (!atual) return;
    fechadosRef.current.add(atual.id);
    setFila(lista => lista.filter(a => a.id !== atual.id));
    confirmarLeitura(atual.id);
  };

  if (!ativo || !atual) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => {}}>
      <View style={styles.fundo}>
        <View style={styles.cartao} accessibilityRole="alert">
          <Pressable onPress={fechar} style={styles.fechar} accessibilityRole="button" accessibilityLabel="Fechar aviso" hitSlop={14}>
            <Ionicons name="close" size={32} color="#fff" />
          </Pressable>
          <View style={styles.icone}><Ionicons name="megaphone" size={30} color="#b45309" /></View>
          <Text style={styles.titulo}>Aviso - {nomeAgencia || 'Agência'}</Text>
          <ScrollView style={styles.rolagem} contentContainerStyle={styles.rolagemConteudo}>
            <Text style={styles.texto} selectable>{atual.texto}</Text>
          </ScrollView>
          <Text style={styles.data}>{dataHora(atual.criadoEm)}{fila.length > 1 ? ` · mais ${fila.length - 1} aviso${fila.length > 2 ? 's' : ''}` : ''}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(15,23,42,0.62)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  cartao: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 20, alignItems: 'center', gap: 12, elevation: 14, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  fechar: { position: 'absolute', top: 12, right: 12, width: 50, height: 50, borderRadius: 25, backgroundColor: '#dc2626', borderWidth: 3, borderColor: '#fecaca', alignItems: 'center', justifyContent: 'center', elevation: 8, zIndex: 2 },
  icone: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 18, fontWeight: '800', color: '#0f172a', textAlign: 'center', marginHorizontal: 48 },
  rolagem: { maxHeight: 340, alignSelf: 'stretch' },
  rolagemConteudo: { paddingVertical: 4 },
  texto: { fontSize: 17, lineHeight: 25, color: '#1e293b', textAlign: 'center' },
  data: { fontSize: 12, color: '#64748b' },
});
