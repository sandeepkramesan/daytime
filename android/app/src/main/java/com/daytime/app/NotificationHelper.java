package com.daytime.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import java.util.Locale;

/** Alarm notifications: high importance, full-screen, alarm sound. */
final class NotificationHelper {

    static final String CHANNEL_ALARMS = "alarms";

    private NotificationHelper() {
    }

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ALARMS, "alarms", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Scheduled alarms and timers");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 400, 250, 400});
        channel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    static void showAlarm(Context context, int id, String label, int hour, int minute) {
        ensureChannels(context);
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        Intent open = new Intent(context, AlarmActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(AlarmStore.EXTRA_ID, id)
                .putExtra(AlarmStore.EXTRA_LABEL, label)
                .putExtra(AlarmStore.EXTRA_HOUR, hour)
                .putExtra(AlarmStore.EXTRA_MINUTE, minute);

        PendingIntent pending = PendingIntent.getActivity(context, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = label == null || label.isEmpty() ? "alarm" : label.toLowerCase(Locale.getDefault());
        String text = hour >= 0
                ? String.format(Locale.getDefault(), "%02d:%02d", hour, minute)
                : "timer finished";

        Notification.Builder builder = new Notification.Builder(context, CHANNEL_ALARMS)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(text)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setWhen(System.currentTimeMillis())
                .setFullScreenIntent(pending, true)
                .setContentIntent(pending);

        manager.notify(id, builder.build());
    }

    static void cancel(Context context, int id) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(id);
        }
    }
}
