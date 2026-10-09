package com.millin.motorista.overlay;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import com.millin.motorista.R;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

// Alerta de rádio entre motoristas (BIP BIP ALERTA). Toca como alarme, mesmo com o motorista em outro app.
// O app (tempo real) e o monitor em segundo plano podem perceber o mesmo alerta: cada alerta toca uma vez só.
public final class RadioAlertas {
    private static final Set<String> tocados = new LinkedHashSet<>();
    private static final Set<MediaPlayer> ativos = Collections.synchronizedSet(new HashSet<>());

    private RadioAlertas() { }

    public static boolean tocar(Context context, String chave) {
        synchronized (tocados) {
            if (!tocados.add(chave)) return false;
            if (tocados.size() > 100) {
                Iterator<String> antigo = tocados.iterator();
                antigo.next();
                antigo.remove();
            }
        }
        MediaPlayer player = new MediaPlayer();
        AssetFileDescriptor arquivo = null;
        try {
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            arquivo = context.getResources().openRawResourceFd(R.raw.bip_alerta);
            if (arquivo == null) return false;
            player.setDataSource(arquivo.getFileDescriptor(), arquivo.getStartOffset(), arquivo.getLength());
            player.setLooping(false);
            ativos.add(player);
            player.setOnCompletionListener(RadioAlertas::liberar);
            player.setOnErrorListener((p, oque, extra) -> { liberar(p); return true; });
            player.prepare();
            player.start();
            return true;
        } catch (Exception erro) {
            liberar(player);
            return false;
        } finally {
            if (arquivo != null) try { arquivo.close(); } catch (Exception ignorado) { }
        }
    }

    // Volume do PRI RADIO (Configurações do app), separado do volume da voz: 0 = mudo, 1 = normal.
    public static float volumeBipe(Context context) {
        return context.getSharedPreferences("millin_radio", Context.MODE_PRIVATE).getFloat("volumeBipe", 1f);
    }

    public static void definirVolumeBipe(Context context, float volume) {
        context.getSharedPreferences("millin_radio", Context.MODE_PRIVATE).edit().putFloat("volumeBipe", Math.max(0f, Math.min(1f, volume))).apply();
    }

    private static final int TAXA_BIPE = 48000;
    private static short[] somBipe;

    // PRI RADIO em PCM (16 bits, mono, 48 kHz), lido uma vez do WAV.
    private static synchronized short[] somBipe(Context context) {
        if (somBipe != null) return somBipe;
        try (InputStream entrada = context.getResources().openRawResource(R.raw.pri_radio_pcm)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] parte = new byte[8192];
            int lidos;
            while ((lidos = entrada.read(parte)) > 0) bytes.write(parte, 0, lidos);
            byte[] wav = bytes.toByteArray();
            // Blocos do WAV a partir do byte 12; o som fica no bloco "data".
            for (int i = 12; i + 8 <= wav.length; ) {
                int tamanho = (wav[i + 4] & 0xff) | (wav[i + 5] & 0xff) << 8 | (wav[i + 6] & 0xff) << 16 | (wav[i + 7] & 0xff) << 24;
                if (wav[i] == 'd' && wav[i + 1] == 'a' && wav[i + 2] == 't' && wav[i + 3] == 'a') {
                    int amostras = Math.min(tamanho, wav.length - i - 8) / 2;
                    short[] pcm = new short[amostras];
                    for (int k = 0, p = i + 8; k < amostras; k++, p += 2) pcm[k] = (short) ((wav[p] & 0xff) | (wav[p + 1] << 8));
                    return somBipe = pcm;
                }
                if (tamanho < 0) break;
                i += 8 + tamanho + (tamanho & 1);
            }
        } catch (Exception ignorado) { }
        return null;
    }

    // Bipe do rádio (PRI RADIO) ao apertar para falar e quando o outro começa a falar, no volume das Configurações.
    // O volume é aplicado no próprio som: alguns aparelhos ignoram o volume do tocador no canal de voz da conversa.
    // Na conversa sai pela rota dela (alto-falante, fone ou Bluetooth) sem pedir foco de áudio; fora dela (teste nas
    // Configurações) toca como mídia. Devolve a duração em ms (0 = mudo).
    public static int bipe(Context context) {
        float volume = volumeBipe(context);
        if (volume <= 0f) return 0;
        short[] original = somBipe(context);
        if (original == null) return 0;
        short[] pcm = new short[original.length];
        for (int k = 0; k < original.length; k++) pcm[k] = (short) Math.round(original[k] * volume);
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        boolean conversa = audio != null && audio.getMode() == AudioManager.MODE_IN_COMMUNICATION;
        AudioTrack faixa = null;
        try {
            faixa = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(conversa ? AudioAttributes.USAGE_VOICE_COMMUNICATION : AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(TAXA_BIPE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build())
                .setBufferSizeInBytes(pcm.length * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build();
            faixa.write(pcm, 0, pcm.length);
            faixa.play();
            int duracao = (int) (pcm.length * 1000L / TAXA_BIPE);
            AudioTrack tocando = faixa;
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try { tocando.stop(); } catch (Exception ignorado) { }
                tocando.release();
            }, duracao + 400);
            return duracao;
        } catch (Exception erro) {
            if (faixa != null) try { faixa.release(); } catch (Exception ignorado) { }
            return 0;
        }
    }

    private static void liberar(MediaPlayer player) {
        if (player == null) return;
        ativos.remove(player);
        try { player.release(); } catch (Exception ignorado) { }
    }
}
