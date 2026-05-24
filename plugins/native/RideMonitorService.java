package com.millin.motorista.overlay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
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
    private static final String PREFS_NAME = "millin_ride_monitor";
    private static final String PREF_TOKEN = "token";
    private static final String PREF_API_BASE = "apiBase";
    private static final int NOTIFICATION_ID = 7761;
    private static final long INTERVALO_CONSULTA_SEGUNDOS = 3;
    private static final Set<MediaPlayer> buzinasAtivas = Collections.synchronizedSet(new HashSet<>());
    private static volatile boolean appEmPrimeiroPlano = false;

    private final Set<String> idsConhecidos = Collections.synchronizedSet(new HashSet<>());
    private ScheduledExecutorService executor;
    private PowerManager.WakeLock wakeLock;
    private volatile String token;
    private volatile String apiBase = API_BASE_PADRAO;

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

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        pararLoop();
        liberarWakeLock();
        super.onDestroy();
    }

    private void atualizarCredenciais(Intent intent) {
        if (intent == null) return;

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
        apiBase = normalizarApiBase(prefs.getString(PREF_API_BASE, API_BASE_PADRAO));
    }

    private void iniciarForeground() {
        criarCanalNotificacao();
        Notification notification = criarNotificacao();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
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
        pararLoop();
        liberarWakeLock();
        idsConhecidos.clear();
        token = null;
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

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.createNotificationChannel(canal);
        }
    }

    private Notification criarNotificacao() {
        Intent abrirApp = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (abrirApp == null) {
            abrirApp = new Intent();
        }
        abrirApp.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, abrirApp, flags);
        int icone = getApplicationInfo().icon != 0 ? getApplicationInfo().icon : android.R.drawable.ic_dialog_info;

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        return builder
            .setContentTitle("MIL-LIN motorista online")
            .setContentText("Monitorando corridas em segundo plano.")
            .setSmallIcon(icone)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }

    private String normalizarApiBase(String valor) {
        if (valor == null || valor.trim().isEmpty()) return API_BASE_PADRAO;
        return valor.trim().replaceAll("/+$", "");
    }
}
