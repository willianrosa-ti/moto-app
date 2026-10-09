package com.millin.motorista.overlay;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

// Cliente SignalR (protocolo JSON) do /hub-radio sobre WebSocket, para o rádio nativo funcionar com o app
// em segundo plano ou fechado. Tudo roda na thread do núcleo (exec); os retornos do OkHttp são repassados a ela.
final class RadioHubCliente {
    interface Ouvinte {
        void conectado(String connectionId);
        void evento(String alvo, JSONArray argumentos);
        void desconectado();
    }

    interface Resposta {
        void pronta(Object resultado, String erro);
    }

    interface Credenciais {
        String apiBase();
        String token();
    }

    private static final String SEP = "\u001e";
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).pingInterval(0, TimeUnit.SECONDS).build();
    private final ScheduledExecutorService exec;
    private final Ouvinte ouvinte;
    private final Credenciais credenciais;
    private final Map<String, Resposta> pendentes = new HashMap<>();
    private WebSocket ws;
    private String connectionId;
    private String connectionIdNegociado;
    private boolean pronto;
    private boolean ativo;
    private long ultimaMensagem;
    private int proximoId = 1;
    private int tentativas;
    private ScheduledFuture<?> ping;
    private ScheduledFuture<?> religar;

    RadioHubCliente(ScheduledExecutorService exec, Credenciais credenciais, Ouvinte ouvinte) {
        this.exec = exec;
        this.credenciais = credenciais;
        this.ouvinte = ouvinte;
    }

    boolean conectado() {
        return pronto && ws != null;
    }

    String connectionId() {
        return pronto ? connectionId : null;
    }

    // Mantém a conexão ligada (religa sozinha) até parar().
    void ativar() {
        if (ativo) return;
        ativo = true;
        tentativas = 0;
        conectar();
    }

    void parar() {
        ativo = false;
        if (religar != null) religar.cancel(false);
        fechar("Rádio desligado.");
    }

    void religarAgora() {
        if (!ativo || conectado()) return;
        if (religar != null) religar.cancel(false);
        tentativas = 0;
        conectar();
    }

    private void conectar() {
        if (!ativo || ws != null) return;
        String base = credenciais.apiBase(), token = credenciais.token();
        if (base == null || token == null || token.isEmpty()) { agendarReligar(); return; }
        try {
            Request negociar = new Request.Builder()
                .url(base + "/hub-radio/negotiate?negotiateVersion=1")
                .post(RequestBody.create(new byte[0], null))
                .header("Authorization", "Bearer " + token)
                .build();
            String connectionToken;
            try (Response r = http.newCall(negociar).execute()) {
                if (!r.isSuccessful() || r.body() == null) throw new IllegalStateException("negotiate " + r.code());
                JSONObject n = new JSONObject(r.body().string());
                connectionIdNegociado = n.getString("connectionId");
                connectionToken = n.optString("connectionToken", connectionIdNegociado);
            }
            String url = base.replaceFirst("^http", "ws") + "/hub-radio?id=" + URLEncoder.encode(connectionToken, "UTF-8")
                + "&access_token=" + URLEncoder.encode(token, "UTF-8");
            pronto = false;
            ultimaMensagem = System.currentTimeMillis();
            ws = http.newWebSocket(new Request.Builder().url(url).build(), new WebSocketListener() {
                @Override public void onOpen(WebSocket socket, Response response) {
                    exec.execute(() -> { if (socket == ws) socket.send("{\"protocol\":\"json\",\"version\":1}" + SEP); });
                }
                @Override public void onMessage(WebSocket socket, String texto) {
                    exec.execute(() -> { if (socket == ws) receber(texto); });
                }
                @Override public void onClosed(WebSocket socket, int codigo, String motivo) {
                    exec.execute(() -> { if (socket == ws) caiu(); });
                }
                @Override public void onFailure(WebSocket socket, Throwable erro, Response response) {
                    exec.execute(() -> { if (socket == ws) caiu(); });
                }
            });
        } catch (Exception erro) {
            ws = null;
            agendarReligar();
        }
    }

    private void receber(String texto) {
        ultimaMensagem = System.currentTimeMillis();
        for (String quadro : texto.split(SEP)) {
            if (quadro.isEmpty()) continue;
            try {
                JSONObject m = new JSONObject(quadro);
                if (!pronto) {
                    // Resposta do handshake: {} (ou {"error": ...}).
                    if (m.has("error")) { caiu(); return; }
                    pronto = true;
                    tentativas = 0;
                    connectionId = connectionIdNegociado;
                    if (ping != null) ping.cancel(false);
                    ping = exec.scheduleWithFixedDelay(this::pingar, 15, 15, TimeUnit.SECONDS);
                    ouvinte.conectado(connectionId);
                    continue;
                }
                int tipo = m.optInt("type");
                if (tipo == 1) ouvinte.evento(m.optString("target"), m.optJSONArray("arguments") == null ? new JSONArray() : m.optJSONArray("arguments"));
                else if (tipo == 3) {
                    Resposta r = pendentes.remove(m.optString("invocationId"));
                    if (r != null) r.pronta(m.isNull("result") ? null : m.opt("result"), m.has("error") ? limparErro(m.optString("error")) : null);
                } else if (tipo == 7) { caiu(); return; }
            } catch (Exception ignorado) {
                // Mensagem ilegível: ignora.
            }
        }
    }

    private static String limparErro(String erro) {
        return erro.replaceFirst("^.*HubException:\\s*", "");
    }

    private void pingar() {
        if (ws == null) return;
        // Sem nada do servidor por 35 s: conexão morta, religa.
        if (System.currentTimeMillis() - ultimaMensagem > 35000) { ws.cancel(); caiu(); return; }
        ws.send("{\"type\":6}" + SEP);
    }

    void invocar(String alvo, JSONArray argumentos, Resposta resposta) {
        if (!conectado()) { resposta.pronta(null, "Rádio sem conexão. Aguarde a reconexão."); return; }
        String id = String.valueOf(proximoId++);
        pendentes.put(id, resposta);
        try {
            JSONObject m = new JSONObject().put("type", 1).put("invocationId", id).put("target", alvo).put("arguments", argumentos);
            ws.send(m.toString() + SEP);
        } catch (Exception erro) {
            pendentes.remove(id);
            resposta.pronta(null, "Não foi possível falar com o servidor do rádio.");
            return;
        }
        exec.schedule(() -> {
            Resposta r = pendentes.remove(id);
            if (r != null) r.pronta(null, "O servidor do rádio não respondeu. Tente novamente.");
        }, 15, TimeUnit.SECONDS);
    }

    void enviar(String alvo, JSONArray argumentos) {
        if (!conectado()) return;
        try {
            ws.send(new JSONObject().put("type", 1).put("target", alvo).put("arguments", argumentos).toString() + SEP);
        } catch (Exception ignorado) { }
    }

    private void caiu() {
        boolean estava = pronto;
        fechar("Conexão do rádio caiu.");
        if (estava) ouvinte.desconectado();
        agendarReligar();
    }

    private void fechar(String motivo) {
        if (ping != null) { ping.cancel(false); ping = null; }
        WebSocket atual = ws;
        ws = null;
        pronto = false;
        connectionId = null;
        if (atual != null) { try { atual.close(1000, null); } catch (Exception ignorado) { } }
        List<Resposta> abertas = new ArrayList<>(pendentes.values());
        pendentes.clear();
        for (Resposta r : abertas) r.pronta(null, motivo);
    }

    private void agendarReligar() {
        if (!ativo) return;
        if (religar != null) religar.cancel(false);
        long[] esperas = { 1, 2, 5, 10, 20, 30 };
        long espera = esperas[Math.min(tentativas++, esperas.length - 1)];
        religar = exec.schedule(this::conectar, espera, TimeUnit.SECONDS);
    }
}
