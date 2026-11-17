package com.daytime.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

/**
 * Refreshes the widget's date, sunrise/sunset and agenda. The visible time is
 * a TextClock, so no wake-up is needed just to tick minutes.
 */
public class DaytimeWidgetProvider extends AppWidgetProvider {

    static final String ACTION_REFRESH = "com.daytime.app.action.REFRESH";

    private static final long REFRESH_INTERVAL_MS = 15L * 60L * 1000L;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        WidgetRenderer.update(context, appWidgetManager, appWidgetIds);
        schedule(context);
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        schedule(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (ACTION_REFRESH.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || Intent.ACTION_DATE_CHANGED.equals(action)) {
            WidgetRenderer.updateAll(context);
        }
    }

    private void schedule(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) {
            return;
        }
        Intent intent = new Intent(context, DaytimeWidgetProvider.class);
        intent.setAction(ACTION_REFRESH);
        PendingIntent pending = PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.setInexactRepeating(AlarmManager.RTC,
                System.currentTimeMillis() + REFRESH_INTERVAL_MS,
                REFRESH_INTERVAL_MS,
                pending);
    }
}
