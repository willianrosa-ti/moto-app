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
        // Alguns fabricantes avisam o "ligou" com o nome deles (QUICKBOOT).
        boolean ligou = Intent.ACTION_BOOT_COMPLETED.equals(acao) || "android.intent.action.QUICKBOOT_POWERON".equals(acao)
            || "com.htc.intent.action.QUICKBOOT_POWERON".equals(acao);
        if (!ligou && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(acao)) return;
        String token = context.getSharedPreferences("millin_ride_monitor", Context.MODE_PRIVATE).getString("token", null);
        if (token == null || token.trim().isEmpty()) return;
        try {
            Intent servico = new Intent(context, RideMonitorService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(servico);
            else context.startService(servico);
        } catch (Exception semPermissao) {
            // O Android não deixou religar sozinho (economia de bateria do fabricante): sem isso o motorista nem
            // saberia que está desconectado. Tocar abre o app, que religa tudo.
            DriverNotifications.show(context, "aviso-religar-" + System.currentTimeMillis(), "MIL-LIN desconectado",
                "Toque para reconectar o rádio, os alertas e as mensagens.");
        }
    }
}
