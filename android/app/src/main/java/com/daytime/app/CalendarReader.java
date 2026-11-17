package com.daytime.app;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * Reads events from the on-device calendar provider.
 *
 * This is the same data Google Calendar syncs to the phone, so daytime needs no
 * account, no network and no OAuth on Android — only READ_CALENDAR.
 */
final class CalendarReader {

    static final class Event {
        final String title;
        final long start;
        final long end;
        final boolean allDay;

        Event(String title, long start, long end, boolean allDay) {
            this.title = title;
            this.start = start;
            this.end = end;
            this.allDay = allDay;
        }
    }

    private CalendarReader() {
    }

    static boolean hasPermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.READ_CALENDAR)
                == PackageManager.PERMISSION_GRANTED;
    }

    static List<Event> today(Context context) {
        Calendar start = Calendar.getInstance();
        start.set(Calendar.HOUR_OF_DAY, 0);
        start.set(Calendar.MINUTE, 0);
        start.set(Calendar.SECOND, 0);
        start.set(Calendar.MILLISECOND, 0);

        Calendar end = (Calendar) start.clone();
        end.add(Calendar.DAY_OF_YEAR, 1);

        return range(context, start.getTimeInMillis(), end.getTimeInMillis());
    }

    static List<Event> range(Context context, long startMillis, long endMillis) {
        List<Event> events = new ArrayList<>();
        if (!hasPermission(context)) {
            return events;
        }

        Uri.Builder builder = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(builder, startMillis);
        ContentUris.appendId(builder, endMillis);

        String[] projection = {
                CalendarContract.Instances.TITLE,
                CalendarContract.Instances.BEGIN,
                CalendarContract.Instances.END,
                CalendarContract.Instances.ALL_DAY,
        };

        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    builder.build(),
                    projection,
                    null,
                    null,
                    CalendarContract.Instances.BEGIN + " ASC");

            while (cursor != null && cursor.moveToNext()) {
                String title = cursor.getString(0);
                long begin = cursor.getLong(1);
                long finish = cursor.getLong(2);
                boolean allDay = cursor.getInt(3) != 0;
                if (title == null || title.trim().isEmpty()) {
                    title = "Untitled event";
                }
                events.add(new Event(title, begin, finish, allDay));
            }
        } catch (SecurityException ignored) {
            // Permission was revoked between the check and the query.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        return events;
    }
}
