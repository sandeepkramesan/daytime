package com.daytime.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Re-arms alarms after a reboot, an app update, a clock or time-zone change,
 * or when the exact-alarm permission is granted again.
 */
public class RescheduleReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }
        switch (intent.getAction()) {
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
            case Intent.ACTION_TIME_CHANGED:
            case Intent.ACTION_TIMEZONE_CHANGED:
            case "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED":
                AlarmStore.rescheduleAll(context);
                break;
            default:
                break;
        }
    }
}
