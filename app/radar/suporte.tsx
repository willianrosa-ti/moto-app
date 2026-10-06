import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Suporte() {
  const router = useRouter();
  const [telefone, setTelefone] = useState('');
  useEffect(() => { AsyncStorage.getItem('telefoneAgencia').then(t => setTelefone(t || '')); }, []);
  return <SafeAreaView style={styles.page}>
    <View style={styles.header}><Pressable accessibilityLabel="Voltar" onPress={() => router.canGoBack() ? router.back() : router.replace('/radar')}><Ionicons name="arrow-back" size={26} color="#0f172a" /></Pressable><Text style={styles.title}>Suporte da agência</Text></View>
    <View style={styles.card}>
      <Ionicons name="chatbubbles-outline" size={46} color="#047857" />
      <Text style={styles.title}>Converse com sua agência</Text>
      <Text style={styles.description}>Envie mensagens pelo botão de conversa no canto da tela. O histórico fica salvo e você acompanha as respostas por aqui.</Text>
      {!!telefone && <Pressable style={styles.button} onPress={() => Linking.openURL('tel:' + telefone)}><Ionicons name="call-outline" size={20} color="#047857" /><Text style={styles.link}>Ligar para a agência</Text></Pressable>}
      <Pressable style={styles.button} onPress={() => router.push('/radar/notificacoes')}><Ionicons name="time-outline" size={20} color="#047857" /><Text style={styles.link}>Respostas de chamados anteriores</Text></Pressable>
      <Pressable style={styles.button} onPress={() => Linking.openURL('whatsapp://send?phone=+5544997740967&text=Olá suporte MIL-LIN. Preciso de ajuda técnica com o app do motorista.')}><Ionicons name="construct-outline" size={20} color="#047857" /><Text style={styles.link}>Suporte técnico MIL-LIN</Text></Pressable>
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' }, header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 22, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' }, card: { margin: 22, padding: 24, gap: 20, borderRadius: 24, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  description: { color: '#64748b', fontSize: 15, lineHeight: 24 }, button: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10 }, link: { color: '#047857', fontSize: 14, fontWeight: '600', flexShrink: 1 },
});
