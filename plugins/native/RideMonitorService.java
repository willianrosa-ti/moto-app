package com.millin.motorista.overlay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.millin.motorista.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class RideMonitorService extends Service {
    public static final String ACTION_START = "com.millin.motorista.overlay.START_RIDE_MONITOR";
    public static final String ACTION_STOP = "com.millin.motorista.overlay.STOP_RIDE_MONITOR";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_API_BASE = "apiBase";

    private static final String API_BASE_PADRAO = "https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net";
    private static final String CHANNEL_ID = "millin_ride_monitor";
    private static final String ALERT_CHANNEL_ID = "millin_ride_alerts";
    private static final String PREFS_NAME = "millin_ride_monitor";
    private static final String PREF_TOKEN = "token";
    private static final String PREF_API_BASE = "apiBase";
    private static final int NOTIFICATION_ID = 7761;
    private static final int ALERT_NOTIFICATION_ID = 7762;
    private static final long INTERVALO_CONSULTA_SEGUNDOS = 3;
    private static final long INTERVALO_LOCALIZACAO_MS = 5000;
    private static final long INTERVALO_REENVIO_LOCALIZACAO_MS = 10000;
    private static final float DISTANCIA_LOCALIZACAO_METROS = 10f;
    private static final Set<MediaPlayer> buzinasAtivas = Collections.synchronizedSet(new HashSet<>());
    private static volatile boolean appEmPrimeiroPlano = false;

    private final Set<String> idsConhecidos = Collections.synchronizedSet(new HashSet<>());
    private ScheduledExecutorService executor;
    private LocationManager locationManager;
    private LocationListener locationListener;
    private PowerManager.WakeLock wakeLock;
    private volatile String token;
    private volatile boolean radarAtivo = true;
    private long ultimaConsultaMensagens = 0;
    private final Set<String> filaConhecida = new HashSet<>();
    private volatile String apiBase = API_BASE_PADRAO;
    private volatile Location ultimaLocalizacao;
    private volatile long ultimoEnvioLocalizacaoMs = 0L;
    private volatile String corridaAtivaConhecidaId;

    public static void setAppInForeground(boolean appEmPrimeiroPlanoAtual) {
        appEmPrimeiroPlano = appEmPrimeiroPlanoAtual;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            pararMonitoramento();
            return START_NOT_STICKY;
        }

        atualizarCredenciais(intent);
        carregarCredenciaisSalvasSeNecessario();

        if (token == null || token.trim().isEmpty()) {
            pararMonitoramento();
            return START_NOT_STICKY;
        }

        iniciarForeground();
        iniciarWakeLock();
        iniciarLoop();
        if (radarAtivo) iniciarMonitoramentoLocalizacao(); else pararMonitoramentoLocalizacao();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        pararMonitoramentoLocalizacao();
        pararLoop();
        liberarWakeLock();
        super.onDestroy();
    }

    private void atualizarCredenciais(Intent intent) {
        if (intent == null) return;

        radarAtivo = intent.getBooleanExtra("radarAtivo", true);
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putBoolean("radarAtivo", radarAtivo).apply();
        if (intent.hasExtra("refreshToken")) {
            try { DriverSessionSecrets.save(this, intent.getStringExtra("refreshToken")); } catch (Exception ignored) { }
        }
        String novoToken = intent.getStringExtra(EXTRA_TOKEN);
        String novaApiBase = intent.getStringExtra(EXTRA_API_BASE);

        if (novoToken != null && !novoToken.trim().isEmpty()) {
            token = novoToken.trim();
        }

        if (novaApiBase != null && !novaApiBase.trim().isEmpty()) {
            apiBase = normalizarApiBase(novaApiBase);
        }

        if (token != null && !token.trim().isEmpty()) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString(PREF_TOKEN, token)
                .putString(PREF_API_BASE, apiBase)
                .apply();
        }
    }

    private void carregarCredenciaisSalvasSeNecessario() {
        if (token != null && !token.trim().isEmpty()) return;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        token = prefs.getString(PREF_TOKEN, null);
        radarAtivo = prefs.getBoolean("radarAtivo", true);
        apiBase = normalizarApiBase(prefs.getString(PREF_API_BASE, API_BASE_PADRAO));
    }

    private void iniciarForeground() {
        criarCanalNotificacao();
        Notification notification = criarNotificacao();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int tiposForeground = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING : 0;
            if (radarAtivo && temPermissaoLocalizacao()) {
                tiposForeground |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            }

            startForeground(
                NOTIFICATION_ID,
                notification,
                tiposForeground
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void iniciarLoop() {
        if (executor != null && !executor.isShutdown()) return;

        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(
            this::consultarCorridasComSeguranca,
            0,
            INTERVALO_CONSULTA_SEGUNDOS,
            TimeUnit.SECONDS
        );
    }

    private void consultarCorridasComSeguranca() {
        try {
            if (!renovarTokenSeNecessario()) return;
            if (!appEmPrimeiroPlano) consultarRadio();
            if (System.currentTimeMillis() - ultimaConsultaMensagens > 12000) {
                ultimaConsultaMensagens = System.currentTimeMillis();
                consultarMensagens();
                consultarJornada();
            }
            if (!radarAtivo) return;
            consultarFila();
        } catch (Exception ignored) { }
        if (!radarAtivo) return;
        try {
            consultarCorridaAtivaComSeguranca();
        } catch (Exception ignored) {
        }

        try {
            Set<String> idsAtuais = buscarIdsCorridasPendentes();
            if (idsAtuais == null) return;

            boolean temCorridaNova = false;
            synchronized (idsConhecidos) {
                for (String id : idsAtuais) {
                    if (!idsConhecidos.contains(id)) {
                        temCorridaNova = true;
                        break;
                    }
                }

                idsConhecidos.clear();
                idsConhecidos.addAll(idsAtuais);
            }

            if (temCorridaNova && !appEmPrimeiroPlano) {
                tocarAlertaCorrida();
            }
        } catch (Exception ignored) {
        } finally {
            reenviarUltimaLocalizacaoSeNecessario();
        }
    }

    private void consultarCorridaAtivaComSeguranca() throws Exception {
        JSONObject corridaAtiva = buscarCorridaAtiva();

        if (corridaAtiva == null) {
            corridaAtivaConhecidaId = null;
            return;
        }

        Object idObjeto = corridaAtiva.opt("id");
        if (idObjeto == null || JSONObject.NULL.equals(idObjeto)) return;

        String idCorrida = String.valueOf(idObjeto);
        boolean corridaNova = !idCorrida.equals(corridaAtivaConhecidaId);
        corridaAtivaConhecidaId = idCorrida;

        if (!corridaNova || !corridaAtiva.optBoolean("direcionada", false)) return;

        tocarAlertaCorrida();
        notificarCorridaDirecionada();

        if (!appEmPrimeiroPlano) {
            abrirAppParaCorridaDirecionada();
        }
    }

    private Set<String> buscarIdsCorridasPendentes() throws Exception {
        String tokenAtual = token;
        if (tokenAtual == null || tokenAtual.trim().isEmpty()) return null;

        URL url = new URL(normalizarApiBase(apiBase) + "/api/Corrida/pendentes");
        HttpURLConnection conexao = (HttpURLConnection) url.openConnection();
        conexao.setRequestMethod("GET");
        conexao.setConnectTimeout(10000);
        conexao.setReadTimeout(10000);
        conexao.setRequestProperty("Authorization", "Bearer " + tokenAtual);
        conexao.setRequestProperty("Accept", "application/json");

        int status = conexao.getResponseCode();
        if (status < 200 || status >= 300) {
            conexao.disconnect();
            return null;
        }

        String resposta = lerResposta(conexao.getInputStream());
        conexao.disconnect();

        JSONArray lista = new JSONArray(resposta);
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < lista.length(); i++) {
            JSONObject corrida = lista.optJSONObject(i);
            if (corrida == null) continue;

            Object id = corrida.opt("id");
            if (id != null) {
                ids.add(String.valueOf(id));
            }
        }

        return ids;
    }

    private JSONObject buscarCorridaAtiva() throws Exception {
        String tokenAtual = token;
        if (tokenAtual == null || tokenAtual.trim().isEmpty()) return null;

        HttpURLConnection conexao = null;

        try {
            URL url = new URL(normalizarApiBase(apiBase) + "/api/Corrida/ativa");
            conexao = (HttpURLConnection) url.openConnection();
            conexao.setRequestMethod("GET");
            conexao.setConnectTimeout(10000);
            conexao.setReadTimeout(10000);
            conexao.setRequestProperty("Authorization", "Bearer " + tokenAtual);
            conexao.setRequestProperty("Accept", "application/json");

            int status = conexao.getResponseCode();
            if (status == 204) return null;
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("Falha ao consultar corrida ativa: " + status);
            }

            String resposta = lerResposta(conexao.getInputStream());
            if (resposta == null || resposta.trim().isEmpty()) return null;

            return new JSONObject(resposta);
        } finally {
            if (conexao != null) {
                conexao.disconnect();
            }
        }
    }

    private void iniciarMonitoramentoLocalizacao() {
        if (locationManager != null && locationListener != null) return;
        if (!temPermissaoLocalizacao()) return;

        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (location == null) return;

                ultimaLocalizacao = location;
                agendarEnvioLocalizacao(location, false);
            }

            @Override
            public void onProviderEnabled(String provider) {
            }

            @Override
            public void onProviderDisabled(String provider) {
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
            }
        };

        registrarProviderLocalizacao(LocationManager.GPS_PROVIDER);
        registrarProviderLocalizacao(LocationManager.NETWORK_PROVIDER);

        Location ultimaConhecida = obterMelhorUltimaLocalizacao();
        if (ultimaConhecida != null) {
            ultimaLocalizacao = ultimaConhecida;
            agendarEnvioLocalizacao(ultimaConhecida, true);
        }
    }

    private void registrarProviderLocalizacao(String provider) {
        try {
            if (locationManager != null &&
                locationListener != null &&
                locationManager.isProviderEnabled(provider)) {
                locationManager.requestLocationUpdates(
                    provider,
                    INTERVALO_LOCALIZACAO_MS,
                    DISTANCIA_LOCALIZACAO_METROS,
                    locationListener
                );
            }
        } catch (SecurityException ignored) {
        } catch (Exception ignored) {
        }
    }

    private void pararMonitoramentoLocalizacao() {
        try {
            if (locationManager != null && locationListener != null) {
                locationManager.removeUpdates(locationListener);
            }
        } catch (SecurityException ignored) {
        } catch (Exception ignored) {
        } finally {
            locationListener = null;
            locationManager = null;
            ultimaLocalizacao = null;
            ultimoEnvioLocalizacaoMs = 0L;
        }
    }

    private boolean temPermissaoLocalizacao() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;

        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private Location obterMelhorUltimaLocalizacao() {
        if (!temPermissaoLocalizacao() || locationManager == null) return null;

        Location melhor = null;
        melhor = escolherMelhorLocalizacao(melhor, obterUltimaLocalizacao(LocationManager.GPS_PROVIDER));
        melhor = escolherMelhorLocalizacao(melhor, obterUltimaLocalizacao(LocationManager.NETWORK_PROVIDER));

        return melhor;
    }

    private Location obterUltimaLocalizacao(String provider) {
        try {
            if (locationManager != null && locationManager.isProviderEnabled(provider)) {
                return locationManager.getLastKnownLocation(provider);
            }
        } catch (SecurityException ignored) {
        } catch (Exception ignored) {
        }

        return null;
    }

    private Location escolherMelhorLocalizacao(Location atual, Location candidata) {
        if (candidata == null) return atual;
        if (atual == null) return candidata;

        long diferencaTempo = candidata.getTime() - atual.getTime();
        if (diferencaTempo > 120000) return candidata;
        if (diferencaTempo < -120000) return atual;

        if (candidata.hasAccuracy() && atual.hasAccuracy()) {
            return candidata.getAccuracy() <= atual.getAccuracy() ? candidata : atual;
        }

        return candidata;
    }

    private void agendarEnvioLocalizacao(Location location, boolean forcar) {
        if (executor == null || executor.isShutdown()) return;

        executor.execute(() -> enviarLocalizacaoComSeguranca(location, forcar));
    }

    private void reenviarUltimaLocalizacaoSeNecessario() {
        Location localizacao = ultimaLocalizacao;

        if (localizacao == null) {
            localizacao = obterMelhorUltimaLocalizacao();
            if (localizacao != null) {
                ultimaLocalizacao = localizacao;
            }
        }

        enviarLocalizacaoComSeguranca(localizacao, false);
    }

    private void enviarLocalizacaoComSeguranca(Location location, boolean forcar) {
        if (location == null || appEmPrimeiroPlano || !radarAtivo) return;

        String tokenAtual = token;
        if (tokenAtual == null || tokenAtual.trim().isEmpty()) return;

        long agora = System.currentTimeMillis();
        if (!forcar && agora - ultimoEnvioLocalizacaoMs < INTERVALO_REENVIO_LOCALIZACAO_MS) return;

        ultimoEnvioLocalizacaoMs = agora;

        HttpURLConnection conexao = null;

        try {
            URL url = new URL(normalizarApiBase(apiBase) + "/api/Motorista/atualizar-localizacao");
            JSONObject corpo = new JSONObject();
            corpo.put("latitude", location.getLatitude());
            corpo.put("longitude", location.getLongitude());

            byte[] payload = corpo.toString().getBytes(StandardCharsets.UTF_8);

            conexao = (HttpURLConnection) url.openConnection();
            conexao.setRequestMethod("POST");
            conexao.setConnectTimeout(10000);
            conexao.setReadTimeout(10000);
            conexao.setDoOutput(true);
            conexao.setFixedLengthStreamingMode(payload.length);
            conexao.setRequestProperty("Authorization", "Bearer " + tokenAtual);
            conexao.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conexao.setRequestProperty("Accept", "application/json");

            try (OutputStream outputStream = conexao.getOutputStream()) {
                outputStream.write(payload);
            }

            int status = conexao.getResponseCode();
            InputStream resposta = status >= 200 && status < 400
                ? conexao.getInputStream()
                : conexao.getErrorStream();

            if (resposta != null) {
                resposta.close();
            }
        } catch (Exception ignored) {
        } finally {
            if (conexao != null) {
                conexao.disconnect();
            }
        }
    }

    private String lerResposta(InputStream inputStream) throws Exception {
        BufferedReader leitor = new BufferedReader(
            new InputStreamReader(inputStream, StandardCharsets.UTF_8)
        );
        StringBuilder resposta = new StringBuilder();
        String linha;
        while ((linha = leitor.readLine()) != null) {
            resposta.append(linha);
        }
        leitor.close();
        return resposta.toString();
    }

    private void tocarAlertaCorrida() {
        vibrar();

        MediaPlayer mediaPlayer = new MediaPlayer();
        AssetFileDescriptor arquivo = null;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mediaPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                );
            } else {
                mediaPlayer.setAudioStreamType(AudioManager.STREAM_ALARM);
            }

            arquivo = getResources().openRawResourceFd(R.raw.buzina);
            if (arquivo == null) {
                throw new IllegalStateException("Arquivo de buzina nao encontrado.");
            }

            mediaPlayer.setDataSource(arquivo.getFileDescriptor(), arquivo.getStartOffset(), arquivo.getLength());
            mediaPlayer.setVolume(1.0f, 1.0f);
            buzinasAtivas.add(mediaPlayer);
            mediaPlayer.setOnCompletionListener(RideMonitorService::liberarBuzina);
            mediaPlayer.setOnErrorListener((player, what, extra) -> {
                liberarBuzina(player);
                return true;
            });
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception ignored) {
            liberarBuzina(mediaPlayer);
        } finally {
            if (arquivo != null) {
                try {
                    arquivo.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private void vibrar() {
        try {
            Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null) return;

            long[] padrao = new long[] {0, 450, 250, 450};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(padrao, -1));
            } else {
                vibrator.vibrate(padrao, -1);
            }
        } catch (Exception ignored) {
        }
    }

    private static void liberarBuzina(MediaPlayer mediaPlayer) {
        if (mediaPlayer == null) return;

        buzinasAtivas.remove(mediaPlayer);
        try {
            mediaPlayer.release();
        } catch (Exception ignored) {
        }
    }

    private void iniciarWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;

        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager == null) return;

            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MIL-LIN:RideMonitor");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        } catch (Exception ignored) {
        }
    }

    private void liberarWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
        } finally {
            wakeLock = null;
        }
    }

    private void pararMonitoramento() {
        pararMonitoramentoLocalizacao();
        pararLoop();
        liberarWakeLock();
        idsConhecidos.clear();
        corridaAtivaConhecidaId = null;
        token = null;
        DriverSessionSecrets.clear(this);
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().clear().apply();
        stopForeground(true);
        stopSelf();
    }

    private void pararLoop() {
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    private void criarCanalNotificacao() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel canal = new NotificationChannel(
            CHANNEL_ID,
            "MIL-LIN motorista online",
            NotificationManager.IMPORTANCE_LOW
        );
        canal.setDescription("Mantem o alerta de corridas funcionando em segundo plano.");

        NotificationChannel canalAlerta = new NotificationChannel(
            ALERT_CHANNEL_ID,
            "MIL-LIN corridas direcionadas",
            NotificationManager.IMPORTANCE_HIGH
        );
        canalAlerta.setDescription("Alertas fortes para corridas direcionadas pela agencia.");
        canalAlerta.enableVibration(true);
        canalAlerta.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.createNotificationChannel(canal);
            manager.createNotificationChannel(canalAlerta);
        }
    }

    private Notification criarNotificacao() {
        PendingIntent pendingIntent = criarPendingIntentAbrirApp(0);
        int icone = getApplicationInfo().icon != 0 ? getApplicationInfo().icon : android.R.drawable.ic_dialog_info;

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        return builder
            .setContentTitle(radarAtivo ? "MIL-LIN motorista online" : "MIL-LIN mensagens")
            .setContentText(radarAtivo ? "Corridas, mensagens e GPS ativos." : "Recebendo mensagens da agência. Radar desligado.")
            .setSmallIcon(icone)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }

    private Intent criarIntentAbrirApp() {
        Intent abrirApp = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (abrirApp == null) {
            abrirApp = new Intent();
        }

        abrirApp.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT |
            Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        abrirApp.putExtra("corridaDirecionada", true);

        return abrirApp;
    }

    private PendingIntent criarPendingIntentAbrirApp(int requestCode) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        return PendingIntent.getActivity(this, requestCode, criarIntentAbrirApp(), flags);
    }

    private void abrirAppParaCorridaDirecionada() {
        try {
            startActivity(criarIntentAbrirApp());
        } catch (Exception ignored) {
        }
    }

    private void notificarCorridaDirecionada() { notificarCorridaDirecionada(false); }

    private void notificarCorridaDirecionada(boolean emFila) {
        criarCanalNotificacao();

        PendingIntent pendingIntent = criarPendingIntentAbrirApp(1);
        int icone = getApplicationInfo().icon != 0 ? getApplicationInfo().icon : android.R.drawable.ic_dialog_info;

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, ALERT_CHANNEL_ID)
            : new Notification.Builder(this);

        builder
            .setContentTitle(emFila ? "Nova corrida na fila" : "Corrida direcionada para voce")
            .setContentText(emFila ? "Você tem outra corrida aguardando a conclusão da atual." : "A corrida ira iniciar em 5 segundos.")
            .setSmallIcon(icone)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_MAX)
            .setDefaults(Notification.DEFAULT_ALL)
            .setFullScreenIntent(pendingIntent, !emFila)
            .setVibrate(new long[] {0, 450, 250, 450});

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            builder.setVisibility(Notification.VISIBILITY_PUBLIC);
        }

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(ALERT_NOTIFICATION_ID, builder.build());
        }
    }

    private boolean renovarTokenSeNecessario() throws Exception {
        if (token == null) return false;
        try {
            String payload = new String(android.util.Base64.decode(token.split("\\.")[1], android.util.Base64.URL_SAFE), StandardCharsets.UTF_8);
            if (new JSONObject(payload).optLong("exp") * 1000 > System.currentTimeMillis() + 120000) return true;
        } catch (Exception ignored) { }
        String refresh = DriverSessionSecrets.read(this);
        if (refresh.isEmpty()) return false;
        HttpURLConnection connection = (HttpURLConnection) new URL(apiBase + "/api/Autenticacao/renovar-motorista").openConnection();
        try {
            connection.setRequestMethod("POST"); connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
            connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
            byte[] body = new JSONObject().put("refreshToken", refresh).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) { out.write(body); }
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) { pararMonitoramento(); return false; }
            if (status != 200) return false;
            token = new JSONObject(lerResposta(connection.getInputStream())).getString("token");
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString(PREF_TOKEN, token).apply();
            return true;
        } finally { connection.disconnect(); }
    }

    private String consultarJson(String endpoint) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(apiBase + endpoint).openConnection();
        try {
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
            if (connection.getResponseCode() != 200) return null;
            return lerResposta(connection.getInputStream());
        } finally { connection.disconnect(); }
    }

    // Com o app em segundo plano, o rádio é consultado a cada ciclo para os alertas tocarem na hora.
    private void consultarRadio() {
        try {
            String radioJson = consultarJson("/api/Radio/atual");
            if (radioJson == null) return;
            JSONObject radio = new JSONObject(radioJson);
            JSONObject chamada = radio.optJSONObject("chamada");
            if (chamada == null || !radio.optBoolean("recebendo")) return;
            JSONObject origem = chamada.optJSONObject("origem");
            String id = chamada.optString("id");
            int alertas = chamada.optInt("alertas", 0);
            if (alertas > 0) RadioAlertas.tocar(this, id + ":" + alertas);
            DriverNotifications.show(this, "radio-" + id, "Rádio · " + (origem == null ? "Agência" : origem.optString("nome")), "Rádio chamando. Toque para abrir e conectar.");
        } catch (Exception ignorado) { /* Próximo ciclo tenta de novo. */ }
    }

    private void consultarMensagens() throws Exception {
        if (appEmPrimeiroPlano) return;
        String diretasJson = consultarJson("/api/ChatDireto/novas");
        if (diretasJson != null) {
            JSONArray diretas = new JSONArray(diretasJson);
            for (int i = 0; i < diretas.length(); i++) {
                JSONObject m = diretas.getJSONObject(i);
                DriverNotifications.show(this, "direta-" + m.optString("colegaId") + "-" + m.optString("id"), "Mensagem · " + m.optString("nome", "Motorista"), m.optString("texto"));
            }
        }
        String json = consultarJson("/api/Chat/mensagens");
        if (json == null) return;
        JSONObject chat = new JSONObject(json);
        String tituloMensagem = "Mensagem - " + nomeAgencia(chat);
        JSONArray mensagens = chat.optJSONArray("mensagens");
        if (mensagens != null) {
            for (int i = mensagens.length() - 1; i >= 0; i--) {
                JSONObject m = mensagens.getJSONObject(i);
                if ("Agencia".equals(m.optString("remetente")) && m.isNull("lidaEm")) {
                    DriverNotifications.show(this, m.optString("id"), tituloMensagem, m.optString("texto"));
                    break;
                }
            }
        }
        String avisosJson = consultarJson("/api/Avisos/meus");
        if (avisosJson != null) {
            JSONObject resposta = new JSONObject(avisosJson);
            JSONArray avisos = resposta.optJSONArray("avisos");
            String tituloAviso = "Aviso - " + nomeAgencia(resposta);
            for (int i = 0; avisos != null && i < avisos.length(); i++) {
                JSONObject aviso = avisos.getJSONObject(i);
                if (aviso.isNull("vistoEm")) DriverNotifications.show(this, "aviso-" + aviso.optString("id"), tituloAviso, aviso.optString("texto"));
            }
        }
        String suporteJson = consultarJson("/api/Suporte/minhas-respostas");
        if (suporteJson != null) {
            JSONArray suporte = new JSONArray(suporteJson);
            for (int i = 0; i < suporte.length(); i++) {
                JSONObject m = suporte.getJSONObject(i);
                if (!m.optBoolean("lidaPeloMotorista", true)) {
                    DriverNotifications.show(this, "suporte-" + m.optString("id"), "Resposta de suporte", m.optString("respostaAgencia")); break;
                }
            }
        }
    }

    private static String nomeAgencia(JSONObject dados) {
        String nome = dados.isNull("nomeAgencia") ? "" : dados.optString("nomeAgencia", "").trim();
        return nome.isEmpty() ? "Agência" : nome;
    }

    private void consultarFila() throws Exception {
        String json = consultarJson("/api/Corrida/fila");
        if (json == null) return;
        JSONArray fila = new JSONArray(json);
        Set<String> atual = new HashSet<>();
        boolean nova = false;
        for (int i = 0; i < fila.length(); i++) {
            String id = fila.getJSONObject(i).optString("id"); atual.add(id);
            if (!filaConhecida.contains(id)) nova = true;
        }
        filaConhecida.clear(); filaConhecida.addAll(atual);
        if (nova) { tocarAlertaCorrida(); notificarCorridaDirecionada(true); }
    }

    private void consultarJornada() throws Exception {
        if (!radarAtivo) return;
        String json = consultarJson("/api/Motorista/jornada");
        if (json == null) return;
        JSONObject jornada = new JSONObject(json);
        if (jornada.optBoolean("podeReceber") || jornada.optBoolean("podeContinuar")) return;
        HttpURLConnection connection = (HttpURLConnection) new URL(apiBase + "/api/Motorista/alterar-status-online").openConnection();
        try {
            connection.setRequestMethod("POST"); connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
            connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            try (OutputStream out = connection.getOutputStream()) { out.write("false".getBytes(StandardCharsets.UTF_8)); }
            if (connection.getResponseCode() != 200) return;
        } finally { connection.disconnect(); }
        radarAtivo = false;
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putBoolean("radarAtivo", false).apply();
        pararMonitoramentoLocalizacao();
        DriverNotifications.show(this, "jornada-" + java.time.LocalDate.now(), "Turno encerrado", jornada.optString("mensagem", "Radar desligado fora do horário de atuação."));
    }

    private String normalizarApiBase(String valor) {
        if (valor == null || valor.trim().isEmpty()) return API_BASE_PADRAO;
        return valor.trim().replaceAll("/+$", "");
    }
}
