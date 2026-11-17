package com.daytime.app;

import android.app.Activity;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/** Full-screen ringing alarm with snooze and dismiss. */
public class AlarmActivity extends Activity {

    private MediaPlayer player;
    private Vibrator vibrator;
    private int alarmId;
    private String label;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable stopRinging = new Runnable() {
        @Override
        public void run() {
            stopSound();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }

        alarmId = getIntent().getIntExtra(AlarmStore.EXTRA_ID, -1);
        label = getIntent().getStringExtra(AlarmStore.EXTRA_LABEL);
        int hour = getIntent().getIntExtra(AlarmStore.EXTRA_HOUR, -1);
        int minute = getIntent().getIntExtra(AlarmStore.EXTRA_MINUTE, -1);

        String timeText = hour >= 0
                ? String.format(Locale.getDefault(), "%02d:%02d", hour, minute)
                : "timer";

        setContentView(buildUi(timeText));
        startSound();
        handler.postDelayed(stopRinging, 5L * 60L * 1000L);
    }

    private View buildUi(String timeText) {
        LinearLayout root = Ui.column(this);
        root.setBackgroundColor(Ui.BG);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(Ui.dp(this, 28), Ui.dp(this, 80), Ui.dp(this, 28), Ui.dp(this, 48));

        root.addView(Ui.label(this, "daytime · alarm"));

        TextView time = Ui.display(this, timeText, 78);
        LinearLayout.LayoutParams timeParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        timeParams.topMargin = Ui.dp(this, 22);
        root.addView(time, timeParams);

        if (label != null && !label.isEmpty()) {
            TextView caption = Ui.text(this, label.toLowerCase(Locale.getDefault()), 15, Ui.MUTED);
            LinearLayout.LayoutParams captionParams = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            captionParams.topMargin = Ui.dp(this, 10);
            root.addView(caption, captionParams);
        }

        LinearLayout snooze = Ui.row(this);
        snooze.setGravity(Gravity.CENTER);
        TextView snoozeButton = Ui.text(this, "snooze 10 min", 13, Ui.TEXT);
        snoozeButton.setGravity(Gravity.CENTER);
        snoozeButton.setBackground(Ui.shape(this, Ui.SURFACE_RAISED, 24, Ui.LINE));
        snoozeButton.setClickable(true);
        snoozeButton.setPadding(Ui.dp(this, 26), Ui.dp(this, 14), Ui.dp(this, 26), Ui.dp(this, 14));
        snoozeButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                AlarmStore.snooze(AlarmActivity.this, alarmId, label, 10);
                finishAlarm();
            }
        });

        TextView dismiss = Ui.text(this, "dismiss", 13, Ui.BG);
        dismiss.setGravity(Gravity.CENTER);
        dismiss.setBackground(Ui.shape(AlarmActivity.this, Ui.TEXT, 24, 0));
        dismiss.setClickable(true);
        dismiss.setPadding(Ui.dp(this, 40), Ui.dp(this, 14), Ui.dp(this, 40), Ui.dp(this, 14));
        dismiss.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                finishAlarm();
            }
        });

        LinearLayout actions = Ui.row(this);
        actions.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        actionParams.topMargin = Ui.dp(this, 46);
        actionParams.gravity = Gravity.CENTER_HORIZONTAL;
        actions.addView(snoozeButton);
        LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(
                Ui.dp(this, 10), LinearLayout.LayoutParams.WRAP_CONTENT);
        actions.addView(new View(this), gap);
        actions.addView(dismiss);
        root.addView(actions, actionParams);

        return root;
    }

    private void startSound() {
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) {
                uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception ignored) {
            player = null;
        }

        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator != null) {
            try {
                vibrator.vibrate(VibrationEffect.createWaveform(
                        new long[]{0, 500, 300, 500}, 0));
            } catch (RuntimeException ignored) {
                // Some devices disable vibration in silent mode.
            }
        }
    }

    private void stopSound() {
        handler.removeCallbacks(stopRinging);
        if (player != null) {
            try {
                player.stop();
            } catch (IllegalStateException ignored) {
                // Already stopped.
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
    }

    private void finishAlarm() {
        stopSound();
        NotificationHelper.cancel(this, alarmId);
        finish();
    }

    @Override
    protected void onDestroy() {
        stopSound();
        super.onDestroy();
    }
}
