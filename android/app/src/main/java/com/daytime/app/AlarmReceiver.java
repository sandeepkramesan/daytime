package com.daytime.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires an alarm or the timer: notification, ringing screen, reschedule. */
public class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }

        int id = intent.getIntExtra(AlarmStore.EXTRA_ID, -1);
        String label = intent.getStringExtra(AlarmStore.EXTRA_LABEL);
        int hour = intent.getIntExtra(AlarmStore.EXTRA_HOUR, -1);
        int minute = intent.getIntExtra(AlarmStore.EXTRA_MINUTE, -1);

        if (id == AlarmStore.TIMER_ID) {
            AlarmStore.clearTimer(context);
        }

        NotificationHelper.showAlarm(context, id, label, hour, minute);

        AlarmStore.Alarm alarm = AlarmStore.find(context, id);
        if (alarm != null) {
            if (alarm.repeating()) {
                AlarmStore.schedule(context, alarm);
            } else if (alarm.enabled) {
                alarm.enabled = false;
                AlarmStore.upsert(context, alarm);
            }
        }

        try {
            Intent open = new Intent(context, AlarmActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(AlarmStore.EXTRA_ID, id)
                    .putExtra(AlarmStore.EXTRA_LABEL, label)
                    .putExtra(AlarmStore.EXTRA_HOUR, hour)
                    .putExtra(AlarmStore.EXTRA_MINUTE, minute);
            context.startActivity(open);
        } catch (RuntimeException ignored) {
            // Android 10+ may block background activity starts; the full-screen
            // notification still brings the alarm up.
        }
    }
}
