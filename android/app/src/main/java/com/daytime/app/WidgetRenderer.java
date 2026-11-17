package com.daytime.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Paints the home-screen widget. The clock itself is a TextClock. */
final class WidgetRenderer {

    private static final int MAX_ROWS = 3;

    private static final int[] ROW_IDS = {
            R.id.widget_event_1, R.id.widget_event_2, R.id.widget_event_3,
    };
    private static final int[] TIME_IDS = {
            R.id.widget_event_1_time, R.id.widget_event_2_time, R.id.widget_event_3_time,
    };
    private static final int[] TITLE_IDS = {
            R.id.widget_event_1_title, R.id.widget_event_2_title, R.id.widget_event_3_title,
    };

    private WidgetRenderer() {
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) {
            return;
        }
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, DaytimeWidgetProvider.class));
        update(context, manager, ids);
    }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        if (ids == null || ids.length == 0) {
            return;
        }
        RemoteViews views = build(context);
        for (int id : ids) {
            manager.updateAppWidget(id, views);
        }
    }

    private static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_daytime);

        String date = new SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(new Date());
        views.setTextViewText(R.id.widget_date, date.toUpperCase(Locale.getDefault()));

        String[] sun = SolarTimes.formatToday(context);
        if (sun == null || (sun[0].isEmpty() && sun[1].isEmpty())) {
            views.setViewVisibility(R.id.widget_sun, View.GONE);
        } else {
            views.setViewVisibility(R.id.widget_sun, View.VISIBLE);
            views.setTextViewText(R.id.widget_sun, "\u2191 " + sun[0] + "\n\u2193 " + sun[1]);
        }

        boolean permitted = CalendarReader.hasPermission(context);
        views.setViewVisibility(R.id.widget_permission, permitted ? View.GONE : View.VISIBLE);

        List<CalendarReader.Event> events = permitted
                ? upcoming(context)
                : new ArrayList<CalendarReader.Event>();

        for (int index = 0; index < MAX_ROWS; index++) {
            if (index < events.size()) {
                CalendarReader.Event event = events.get(index);
                views.setViewVisibility(ROW_IDS[index], View.VISIBLE);
                views.setTextViewText(TIME_IDS[index],
                        event.allDay ? "ALL DAY" : SolarTimes.formatTime(context, event.start));
                views.setTextViewText(TITLE_IDS[index], event.title);
            } else {
                views.setViewVisibility(ROW_IDS[index], View.GONE);
            }
        }

        views.setViewVisibility(R.id.widget_empty,
                permitted && events.isEmpty() ? View.VISIBLE : View.GONE);

        Intent open = new Intent(context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);

        return views;
    }

    private static List<CalendarReader.Event> upcoming(Context context) {
        long now = System.currentTimeMillis();
        List<CalendarReader.Event> result = new ArrayList<>();
        for (CalendarReader.Event event : CalendarReader.today(context)) {
            if (event.allDay || event.end >= now) {
                result.add(event);
            }
            if (result.size() == MAX_ROWS) {
                break;
            }
        }
        return result;
    }
}
