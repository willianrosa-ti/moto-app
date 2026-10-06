import { Redirect } from 'expo-router';

// Links antigos passam a usar o mesmo fluxo de radar, sessão e etapas da corrida.
export default function InicioLegado() {
  return <Redirect href="/radar" />;
}
