package com.millin.motorista.overlay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import java.util.HashSet;
import java.util.Set;

public final class DriverNotifications {
    private static final String CHANNEL = "millin_messages_v1";
    public static synchronized void show(Context context, String id, String title, String text) {
        SharedPreferences prefs = context.getSharedPreferences("millin_message_alerts", Context.MODE_PRIVATE);
        Set<String> seen = new HashSet<>(prefs.getStringSet("seen", new HashSet<>()));
        if (seen.contains(id)) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Mensagens da agência", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Mensagens e respostas de suporte, com o som de notificação do celular.");
            channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        String route = id.startsWith("suporte-") ? "radar/notificacoes" : id.startsWith("jornada-") ? "radar" : "radar/suporte";
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("appmotorista://" + route));
        intent.setPackage(context.getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, 8861, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        Notification notification = builder.setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(pending).setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPriority(Notification.PRIORITY_HIGH)
            .setDefaults(Notification.DEFAULT_ALL).build();
        try {
            manager.notify(id.hashCode(), notification);
            if (seen.size() >= 200) seen.clear();
            seen.add(id); prefs.edit().putStringSet("seen", seen).apply();
        } catch (SecurityException ignored) { /* User may disable notifications. */ }
    }
}
