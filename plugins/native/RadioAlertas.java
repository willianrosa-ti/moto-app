package com.millin.motorista.overlay;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import com.millin.motorista.R;
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

    private static void liberar(MediaPlayer player) {
        if (player == null) return;
        ativos.remove(player);
        try { player.release(); } catch (Exception ignorado) { }
    }
}
