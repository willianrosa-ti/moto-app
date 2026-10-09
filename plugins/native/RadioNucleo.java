package com.millin.motorista.overlay;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Objects;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

// Rádio nativo: uma única conexão com o /hub-radio que vive no processo do app (mantido pelo serviço do monitor),
// funcionando com o app aberto, em segundo plano ou fechado. Ele toca a voz, os bipes e os alertas e, fora do
// app, conecta sozinho (agência, "rádio direto" ou 3º alerta). Com o app aberto, a tela (JS) usa esta mesma
// conexão para chamar, aceitar e falar.
public final class RadioNucleo {
    // Ponte com a tela do app (RadioVozModule → JS).
    interface OuvinteTela {
        void conectado(String connectionId);
        void evento(String alvo, String argumentosJson);
        void desconectado();
    }

    private static RadioNucleo instancia;

    public static synchronized RadioNucleo obter(Context contexto) {
        if (instancia == null) instancia = new RadioNucleo(contexto.getApplicationContext());
        return instancia;
    }

    private final Context contexto;
    private final ScheduledExecutorService exec = Executors.newSingleThreadScheduledExecutor(r -> new Thread(r, "RadioNucleo"));
    private final OkHttpClient http = new OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build();
    private final RadioHubCliente hub;
    private volatile String apiBase;
    private volatile String token;
    private volatile OuvinteTela tela;
    private boolean ligado;
    private String euChave;
    private JSONObject chamada;
    private boolean aceitando;
    private RadioVozPlayer player;
    private boolean rotaAtiva;
    private int modoAnterior;
    private boolean altoFalanteAnterior;
    private AudioFocusRequest foco;
    private ScheduledFuture<?> batimento;
    private final AudioManager.OnAudioFocusChangeListener ouvinteFoco = mudanca -> exec.execute(() -> perdeuFoco(mudanca));

    private RadioNucleo(Context contexto) {
        this.contexto = contexto;
        hub = new RadioHubCliente(exec, new RadioHubCliente.Credenciais() {
            @Override public String apiBase() { return apiBase; }
            @Override public String token() { return token; }
        }, new RadioHubCliente.Ouvinte() {
            @Override public void conectado(String connectionId) { aoConectar(connectionId); }
            @Override public void evento(String alvo, JSONArray argumentos) { aoEvento(alvo, argumentos); }
            @Override public void desconectado() { aoDesconectar(); }
        });
    }

    // Liga (ou atualiza o token). Chamado pelo serviço do monitor e pela tela.
    public void iniciar(String apiBase, String token) {
        if (apiBase != null && !apiBase.trim().isEmpty()) this.apiBase = apiBase.trim().replaceAll("/+$", "");
        if (token != null && !token.trim().isEmpty()) this.token = token.trim();
        exec.execute(() -> {
            if (this.token == null || this.apiBase == null) return;
            ligado = true;
            hub.ativar();
            hub.religarAgora();
        });
    }

    public void atualizarToken(String token) {
        if (token != null && !token.trim().isEmpty()) this.token = token.trim();
    }

    // Logout: desliga de vez.
    public void parar() {
        exec.execute(() -> {
            ligado = false;
            if (batimento != null) { batimento.cancel(false); batimento = null; }
            hub.parar();
            limparChamada();
            euChave = null;
        });
    }

    public void definirTela(OuvinteTela ouvinte) {
        tela = ouvinte;
        if (ouvinte != null) exec.execute(() -> { String id = hub.connectionId(); if (id != null) ouvinte.conectado(id); });
    }

    public String connectionId() {
        return hub.connectionId();
    }

    public void invocar(String alvo, String argumentosJson, RadioHubCliente.Resposta resposta) {
        exec.execute(() -> {
            try { hub.invocar(alvo, new JSONArray(argumentosJson), resposta); }
            catch (Exception erro) { resposta.pronta(null, "Pedido inválido para o rádio."); }
        });
    }

    public void enviar(String alvo, String argumentosJson) {
        exec.execute(() -> {
            try { hub.enviar(alvo, new JSONArray(argumentosJson)); } catch (Exception ignorado) { }
        });
    }

    private static boolean appNaFrente() {
        return RideMonitorService.isAppInForeground();
    }

    private void aoConectar(String connectionId) {
        if (batimento != null) batimento.cancel(false);
        batimento = exec.scheduleWithFixedDelay(() -> hub.invocar("Batimento", new JSONArray(), (r, e) -> { }), 15, 15, TimeUnit.SECONDS);
        // Quem sou eu (chave "Motorista:id") e a conversa em andamento, se houver.
        try {
            Request pedido = new Request.Builder().url(apiBase + "/api/Radio/config").header("Authorization", "Bearer " + token).build();
            try (Response r = http.newCall(pedido).execute()) {
                if (r.isSuccessful() && r.body() != null) euChave = new JSONObject(r.body().string()).getJSONObject("eu").optString("chave", null);
            }
        } catch (Exception ignorado) { }
        OuvinteTela t = tela;
        if (t != null) t.conectado(connectionId);
        hub.invocar("Atual", new JSONArray(), (resultado, erro) -> { if (resultado instanceof JSONObject) processarEstado((JSONObject) resultado); });
    }

    private void aoDesconectar() {
        if (batimento != null) { batimento.cancel(false); batimento = null; }
        // O servidor encerra a conversa da conexão que caiu.
        limparChamada();
        OuvinteTela t = tela;
        if (t != null) t.desconectado();
    }

    private void aoEvento(String alvo, JSONArray argumentos) {
        JSONObject dado = argumentos.optJSONObject(0);
        if (dado != null) {
            if ("RadioEstado".equals(alvo)) processarEstado(dado);
            else if ("RadioVoz".equals(alvo)) processarVoz(dado);
            else if ("RadioAlertaAvulso".equals(alvo)) alertaAvulso(dado);
        }
        OuvinteTela t = tela;
        if (t != null) t.evento(alvo, argumentos.toString());
    }

    private static String texto(JSONObject o, String campo) {
        return o == null || o.isNull(campo) ? null : o.optString(campo, null);
    }

    private void processarEstado(JSONObject e) {
        if (euChave == null) return;
        String id = texto(e, "id");
        JSONObject origem = e.optJSONObject("origem"), destino = e.optJSONObject("destino");
        if (id == null || origem == null || destino == null) return;
        boolean souOrigem = euChave.equals(texto(origem, "chave")), souDestino = euChave.equals(texto(destino, "chave"));
        if (!souOrigem && !souDestino) return;
        boolean mesma = chamada != null && id.equals(texto(chamada, "id"));
        if (mesma && e.optLong("versao") <= chamada.optLong("versao")) return;
        if (chamada != null && !mesma && !"Encerrada".equals(texto(e, "status"))) limparChamada();

        String status = texto(e, "status");
        String meuAparelho = texto(e, souOrigem ? "origemAparelho" : "destinoAparelho");
        boolean minha = meuAparelho != null && meuAparelho.equals(hub.connectionId());
        if ("Encerrada".equals(status) || (meuAparelho != null && !minha)) {
            if (mesma) limparChamada();
            return;
        }
        JSONObject anterior = mesma ? chamada : null;
        chamada = e;

        if ("Tocando".equals(status) && souDestino) {
            String nome = texto(origem, "nome");
            boolean agencia = "Agencia".equals(texto(origem, "perfil"));
            int alertas = e.optInt("alertas"), alertasAntes = anterior == null ? 0 : anterior.optInt("alertas");
            if (alertas > alertasAntes) RadioAlertas.tocar(contexto, id + ":" + alertas);
            if (!appNaFrente()) {
                DriverNotifications.show(contexto, "radio-" + id, "Rádio · " + (nome == null ? "Rádio" : nome),
                    agencia ? "Rádio da agência ligado." : "Rádio chamando. Toque para abrir.");
                // Fora do app, o rádio liga sozinho: agência, quem escolheu "rádio direto" ou no 3º alerta.
                boolean conectar = agencia || e.optBoolean("direto") || alertas >= 3;
                if (conectar && e.optBoolean("servidor") && !aceitando) {
                    aceitando = true;
                    hub.invocar("Acao", new JSONArray().put(id).put("Atender"), (resultado, erro) -> {
                        aceitando = false;
                        if (resultado instanceof JSONObject) processarEstado((JSONObject) resultado);
                    });
                }
            }
        }

        if ("Ativa".equals(status) && minha) {
            iniciarAudio();
            String falante = texto(e, "falante"), antes = anterior == null ? null : texto(anterior, "falante");
            if (falante != null && !falante.equals(euChave) && !falante.equals(antes)) RadioAlertas.bipe(contexto);
            if (antes != null && !antes.equals(euChave) && !Objects.equals(falante, antes) && player != null) player.fimFala();
        }
    }

    private void processarVoz(JSONObject v) {
        if (chamada == null || !"Ativa".equals(texto(chamada, "status")) || !Objects.equals(texto(v, "id"), texto(chamada, "id"))) return;
        if (euChave != null && euChave.equals(texto(chamada, "falante"))) return;
        try {
            byte[] dados = Base64.decode(v.optString("dados"), Base64.DEFAULT);
            iniciarAudio();
            player.tocar(v.optInt("fala"), v.optString("codec"), dados);
        } catch (Exception ignorado) { }
    }

    private void alertaAvulso(JSONObject alerta) {
        String id = texto(alerta, "id");
        JSONObject de = alerta.optJSONObject("de");
        if (id == null) return;
        if (RadioAlertas.tocar(contexto, "avulso:" + id) && !appNaFrente()) {
            DriverNotifications.show(contexto, "radio-avulso-" + id, "Alerta · " + (de == null ? "Agência" : de.optString("nome", "Agência")), "Toque para abrir a conversa.");
        }
    }

    private void limparChamada() {
        chamada = null;
        aceitando = false;
        encerrarAudio();
    }

    // Alto-falante (ou fone/Bluetooth), modo de comunicação e foco de áudio enquanto a conversa estiver ativa.
    private void iniciarAudio() {
        if (player == null || !player.isAlive()) { player = new RadioVozPlayer(); player.start(); }
        if (rotaAtiva) return;
        AudioManager audio = (AudioManager) contexto.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                foco = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setOnAudioFocusChangeListener(ouvinteFoco).build();
                audio.requestAudioFocus(foco);
            } else {
                audio.requestAudioFocus(ouvinteFoco, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            }
            modoAnterior = audio.getMode();
            altoFalanteAnterior = audio.isSpeakerphoneOn();
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            if (Build.VERSION.SDK_INT >= 31) {
                AudioDeviceInfo escolha = null;
                for (AudioDeviceInfo aparelho : audio.getAvailableCommunicationDevices()) {
                    int tipo = aparelho.getType();
                    if (tipo == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || tipo == AudioDeviceInfo.TYPE_BLE_HEADSET || tipo == AudioDeviceInfo.TYPE_WIRED_HEADSET || tipo == AudioDeviceInfo.TYPE_USB_HEADSET) { escolha = aparelho; break; }
                    if (tipo == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) escolha = aparelho;
                }
                if (escolha != null) audio.setCommunicationDevice(escolha);
            } else {
                audio.setSpeakerphoneOn(!audio.isWiredHeadsetOn() && !audio.isBluetoothScoOn());
            }
            rotaAtiva = true;
        } catch (Exception ignorado) { }
    }

    private void encerrarAudio() {
        if (player != null) { player.encerrar(); player = null; }
        if (!rotaAtiva) return;
        rotaAtiva = false;
        AudioManager audio = (AudioManager) contexto.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice();
            else audio.setSpeakerphoneOn(altoFalanteAnterior);
            audio.setMode(modoAnterior);
            if (Build.VERSION.SDK_INT >= 26 && foco != null) { audio.abandonAudioFocusRequest(foco); foco = null; }
            else audio.abandonAudioFocus(ouvinteFoco);
        } catch (Exception ignorado) { }
    }

    // Ligação ou outro app de chamada toma o áudio: encerra a conversa. Aviso de navegação (só abaixa o som) não derruba.
    private void perdeuFoco(int mudanca) {
        if (!rotaAtiva || chamada == null) return;
        if (mudanca != AudioManager.AUDIOFOCUS_LOSS && mudanca != AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) return;
        String id = texto(chamada, "id");
        hub.invocar("Acao", new JSONArray().put(id).put("Encerrar"), (r, e) -> { });
        limparChamada();
    }
}
