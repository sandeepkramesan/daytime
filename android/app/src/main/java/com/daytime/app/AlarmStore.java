package com.daytime.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Alarm model, persistence and AlarmManager scheduling. */
final class AlarmStore {

    static final String ACTION_FIRE = "com.daytime.app.action.ALARM";
    static final String EXTRA_ID = "alarm_id";
    static final String EXTRA_LABEL = "alarm_label";
    static final String EXTRA_HOUR = "alarm_hour";
    static final String EXTRA_MINUTE = "alarm_minute";
    static final int TIMER_ID = 424242;

    private static final String PREFS = "daytime";
    private static final String KEY_ALARMS = "alarms";
    private static final String KEY_TIMER_AT = "timer_at";
    private static final String[] DAY_NAMES = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};

    static final class Alarm {
        int id;
        int hour;
        int minute;
        String label = "";
        boolean[] days = new boolean[7];
        boolean enabled = true;

        boolean repeating() {
            for (boolean day : days) {
                if (day) {
                    return true;
                }
            }
            return false;
        }

        String timeText() {
            return String.format(Locale.getDefault(), "%02d:%02d", hour, minute);
        }

        String repeatText() {
            if (!repeating()) {
                return "once";
            }
            int count = 0;
            for (boolean day : days) {
                if (day) {
                    count++;
                }
            }
            if (count == 7) {
                return "every day";
            }
            if (count == 5 && days[1] && days[2] && days[3] && days[4] && days[5]) {
                return "weekdays";
            }
            if (count == 2 && days[0] && days[6]) {
                return "weekends";
            }
            StringBuilder builder = new StringBuilder();
            for (int index = 0; index < 7; index++) {
                if (days[index]) {
                    if (builder.length() > 0) {
                        builder.append(' ');
                    }
                    builder.append(DAY_NAMES[index]);
                }
            }
            return builder.toString();
        }
    }

    private AlarmStore() {
    }

    static List<Alarm> load(Context context) {
        List<Alarm> alarms = new ArrayList<>();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_ALARMS, "[]");
        try {
            JSONArray array = new JSONArray(raw);
            for (int index = 0; index < array.length(); index++) {
                JSONObject object = array.getJSONObject(index);
                Alarm alarm = new Alarm();
                alarm.id = object.getInt("id");
                alarm.hour = object.getInt("hour");
                alarm.minute = object.getInt("minute");
                alarm.label = object.optString("label", "");
                alarm.enabled = object.optBoolean("enabled", true);
                JSONArray days = object.optJSONArray("days");
                for (int day = 0; day < 7; day++) {
                    alarm.days[day] = days != null && days.optBoolean(day, false);
                }
                alarms.add(alarm);
            }
        } catch (JSONException ignored) {
            // Corrupted preferences simply mean no alarms.
        }
        Collections.sort(alarms, new Comparator<Alarm>() {
            @Override
            public int compare(Alarm left, Alarm right) {
                return (left.hour * 60 + left.minute) - (right.hour * 60 + right.minute);
            }
        });
        return alarms;
    }

    static void save(Context context, List<Alarm> alarms) {
        JSONArray array = new JSONArray();
        for (Alarm alarm : alarms) {
            JSONObject object = new JSONObject();
            try {
                object.put("id", alarm.id);
                object.put("hour", alarm.hour);
                object.put("minute", alarm.minute);
                object.put("label", alarm.label);
                object.put("enabled", alarm.enabled);
                JSONArray days = new JSONArray();
                for (int day = 0; day < 7; day++) {
                    days.put(alarm.days[day]);
                }
                object.put("days", days);
            } catch (JSONException ignored) {
                continue;
            }
            array.put(object);
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_ALARMS, array.toString())
                .apply();
    }

    static Alarm find(Context context, int id) {
        for (Alarm alarm : load(context)) {
            if (alarm.id == id) {
                return alarm;
            }
        }
        return null;
    }

    static void upsert(Context context, Alarm alarm) {
        List<Alarm> alarms = load(context);
        boolean replaced = false;
        for (int index = 0; index < alarms.size(); index++) {
            if (alarms.get(index).id == alarm.id) {
                alarms.set(index, alarm);
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            alarms.add(alarm);
        }
        save(context, alarms);
        if (alarm.enabled) {
            schedule(context, alarm);
        } else {
            cancel(context, alarm.id);
        }
    }

    static void delete(Context context, int id) {
        List<Alarm> alarms = load(context);
        for (int index = 0; index < alarms.size(); index++) {
            if (alarms.get(index).id == id) {
                alarms.remove(index);
                break;
            }
        }
        save(context, alarms);
        cancel(context, id);
    }

    static void setEnabled(Context context, Alarm alarm, boolean enabled) {
        alarm.enabled = enabled;
        upsert(context, alarm);
    }

    static Calendar nextOccurrence(Alarm alarm) {
        Calendar now = Calendar.getInstance();
        Calendar base = Calendar.getInstance();
        base.set(Calendar.HOUR_OF_DAY, alarm.hour);
        base.set(Calendar.MINUTE, alarm.minute);
        base.set(Calendar.SECOND, 0);
        base.set(Calendar.MILLISECOND, 0);

        if (!alarm.repeating()) {
            if (!base.after(now)) {
                base.add(Calendar.DAY_OF_YEAR, 1);
            }
            return base;
        }

        for (int offset = 0; offset < 8; offset++) {
            Calendar candidate = (Calendar) base.clone();
            candidate.add(Calendar.DAY_OF_YEAR, offset);
            int dayIndex = candidate.get(Calendar.DAY_OF_WEEK) - 1; // Sunday == 0
            if (alarm.days[dayIndex] && candidate.after(now)) {
                return candidate;
            }
        }
        base.add(Calendar.DAY_OF_YEAR, 7);
        return base;
    }

    static void schedule(Context context, Alarm alarm) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) {
            return;
        }

        long triggerAt = nextOccurrence(alarm).getTimeInMillis();
        PendingIntent pending = fireIntent(context, alarm, triggerAt);

        Intent show = new Intent(context, MainActivity.class);
        PendingIntent showIntent = PendingIntent.getActivity(context, 0, show,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        setAlarmClock(manager, triggerAt, showIntent, pending);
    }

    static void cancel(Context context, int id) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Alarm alarm = find(context, id);
        if (manager == null || alarm == null) {
            return;
        }
        PendingIntent pending = fireIntent(context, alarm, 0L);
        manager.cancel(pending);
        pending.cancel();
    }

    static void scheduleTimer(Context context, long triggerAt) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) {
            return;
        }
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_FIRE);
        intent.putExtra(EXTRA_ID, TIMER_ID);
        intent.putExtra(EXTRA_LABEL, "timer");
        intent.putExtra(EXTRA_HOUR, -1);
        intent.putExtra(EXTRA_MINUTE, -1);
        PendingIntent pending = PendingIntent.getBroadcast(context, TIMER_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent show = new Intent(context, MainActivity.class);
        PendingIntent showIntent = PendingIntent.getActivity(context, 0, show,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        setAlarmClock(manager, triggerAt, showIntent, pending);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_TIMER_AT, triggerAt)
                .apply();
    }

    static void clearTimer(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_TIMER_AT)
                .apply();
    }

    static void cancelTimer(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) {
            return;
        }
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_FIRE);
        PendingIntent pending = PendingIntent.getBroadcast(context, TIMER_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.cancel(pending);
        pending.cancel();
        clearTimer(context);
    }

    static void snooze(Context context, int id, String label, int minutes) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) {
            return;
        }
        Alarm alarm = find(context, id);
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_FIRE);
        intent.putExtra(EXTRA_ID, id);
        intent.putExtra(EXTRA_LABEL, label != null ? label : (alarm != null ? alarm.label : ""));
        intent.putExtra(EXTRA_HOUR, alarm != null ? alarm.hour : -1);
        intent.putExtra(EXTRA_MINUTE, alarm != null ? alarm.minute : -1);
        PendingIntent pending = PendingIntent.getBroadcast(context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent show = new Intent(context, MainActivity.class);
        PendingIntent showIntent = PendingIntent.getActivity(context, 0, show,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        long triggerAt = System.currentTimeMillis() + minutes * 60000L;
        setAlarmClock(manager, triggerAt, showIntent, pending);
    }

    /**
     * Re-arm every enabled alarm and a pending timer. AlarmManager drops all
     * alarms on reboot and may shift them after a clock or time-zone change.
     */
    static void rescheduleAll(Context context) {
        for (Alarm alarm : load(context)) {
            if (alarm.enabled) {
                schedule(context, alarm);
            }
        }
        long timerAt = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_TIMER_AT, 0L);
        if (timerAt > System.currentTimeMillis()) {
            scheduleTimer(context, timerAt);
        } else if (timerAt != 0L) {
            clearTimer(context);
        }
    }

    /**
     * setAlarmClock needs the exact-alarm permission on Android 12+. If it was
     * revoked, fall back to an inexact Doze-safe alarm instead of crashing:
     * late is better than never for an alarm clock.
     */
    private static void setAlarmClock(AlarmManager manager, long triggerAt,
            PendingIntent showIntent, PendingIntent pending) {
        boolean exactAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                || manager.canScheduleExactAlarms();
        if (exactAllowed) {
            try {
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(triggerAt, showIntent), pending);
                return;
            } catch (SecurityException ignored) {
                // Permission revoked between the check and the call.
            }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
    }

    static String nextAlarmText(Context context) {
        Alarm next = null;
        long nextAt = Long.MAX_VALUE;
        for (Alarm alarm : load(context)) {
            if (!alarm.enabled) {
                continue;
            }
            long at = nextOccurrence(alarm).getTimeInMillis();
            if (at < nextAt) {
                nextAt = at;
                next = alarm;
            }
        }
        if (next == null) {
            return "";
        }
        SimpleDateFormat dayFormat = new SimpleDateFormat("EEE", Locale.getDefault());
        return "next alarm " + dayFormat.format(new java.util.Date(nextAt)).toLowerCase(Locale.getDefault())
                + " · " + next.timeText();
    }

    static PendingIntent fireIntent(Context context, Alarm alarm, long triggerAt) {
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_FIRE);
        intent.putExtra(EXTRA_ID, alarm.id);
        intent.putExtra(EXTRA_LABEL, alarm.label);
        intent.putExtra(EXTRA_HOUR, alarm.hour);
        intent.putExtra(EXTRA_MINUTE, alarm.minute);
        return PendingIntent.getBroadcast(context, alarm.id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
