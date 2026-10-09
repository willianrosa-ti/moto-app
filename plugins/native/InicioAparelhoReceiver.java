package com.millin.motorista.overlay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

// Celular reiniciado ou app atualizado: se o motorista continua logado, religa o monitor (e com ele o rádio
// nativo e os alertas) sem precisar abrir o app.
public class InicioAparelhoReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String acao = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(acao) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(acao)) return;
        String token = context.getSharedPreferences("millin_ride_monitor", Context.MODE_PRIVATE).getString("token", null);
        if (token == null || token.trim().isEmpty()) return;
        try {
            Intent servico = new Intent(context, RideMonitorService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(servico);
            else context.startService(servico);
        } catch (Exception ignorado) {
            // Sem permissão para iniciar agora: religa quando o app for aberto.
        }
    }
}
