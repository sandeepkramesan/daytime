package com.daytime.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.widget.Chronometer;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/** Timer and stopwatch, the two measuring tools from a clock app. */
final class MeasureSection extends LinearLayout {

    private static final long[] PRESETS = {60_000L, 5 * 60_000L, 10 * 60_000L, 25 * 60_000L};

    private final Context context;
    private final TextView timerDisplay;
    private final TextView startButton;
    private final TextView resetButton;
    private final Chronometer chronometer;
    private final TextView stopwatchStart;
    private final LinearLayout timerPane;
    private final LinearLayout stopwatchPane;
    private final TextView timerTab;
    private final TextView stopwatchTab;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private boolean timerRunning;
    private long timerEndsAt;
    private long timerRemaining = 5 * 60_000L;

    private boolean stopwatchRunning;
    private long stopwatchAccumulated;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (!timerRunning) {
                return;
            }
            long remaining = timerEndsAt - SystemClock.elapsedRealtime();
            if (remaining <= 0) {
                timerRunning = false;
                timerRemaining = 0;
                renderTimer();
                startButton.setText("start");
                return;
            }
            timerRemaining = remaining;
            renderTimer();
            handler.postDelayed(this, 250);
        }
    };

    MeasureSection(Context context) {
        super(context);
        this.context = context;
        setOrientation(VERTICAL);
        setPadding(Ui.dp(context, 22), Ui.dp(context, 4), Ui.dp(context, 22), Ui.dp(context, 24));

        LinearLayout tabs = Ui.row(context);
        timerTab = Ui.chip(context, "timer", true);
        stopwatchTab = Ui.chip(context, "stopwatch", false);
        tabs.addView(timerTab);
        LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(Ui.dp(context, 8), Ui.dp(context, 1));
        tabs.addView(new View(context), gap);
        tabs.addView(stopwatchTab);
        addView(tabs);

        timerTab.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                showTimer();
            }
        });
        stopwatchTab.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                showStopwatch();
            }
        });

        // Timer pane
        timerPane = Ui.column(context);
        timerDisplay = Ui.display(context, "05:00", 64);
        timerDisplay.setGravity(Gravity.CENTER);
        timerDisplay.setPadding(0, Ui.dp(context, 34), 0, Ui.dp(context, 18));
        timerPane.addView(timerDisplay);

        LinearLayout presets = Ui.row(context);
        presets.setGravity(Gravity.CENTER);
        for (final long preset : PRESETS) {
            TextView chip = Ui.chip(context, String.valueOf(preset / 60_000L) + "m", false);
            chip.setTextSize(11);
            chip.setPadding(Ui.dp(context, 16), Ui.dp(context, 10), Ui.dp(context, 16), Ui.dp(context, 10));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            params.setMargins(Ui.dp(context, 3), 0, Ui.dp(context, 3), 0);
            chip.setLayoutParams(params);
            chip.setOnClickListener(new OnClickListener() {
                @Override
                public void onClick(View view) {
                    if (!timerRunning) {
                        timerRemaining = preset;
                        renderTimer();
                    }
                }
            });
            presets.addView(chip);
        }
        timerPane.addView(presets);

        startButton = Ui.button(context, "start", new OnClickListener() {
            @Override
            public void onClick(View view) {
                toggleTimer();
            }
        });
        LinearLayout.LayoutParams startParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(context, 46));
        startParams.topMargin = Ui.dp(context, 22);
        timerPane.addView(startButton, startParams);

        resetButton = Ui.text(context, "reset", 12, Ui.MUTED);
        resetButton.setGravity(Gravity.CENTER);
        resetButton.setPadding(0, Ui.dp(context, 14), 0, 0);
        resetButton.setClickable(true);
        resetButton.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                resetTimer();
            }
        });
        timerPane.addView(resetButton);

        addView(timerPane);

        // Stopwatch pane
        stopwatchPane = Ui.column(context);
        stopwatchPane.setVisibility(GONE);

        chronometer = new Chronometer(context);
        chronometer.setTextSize(64);
        chronometer.setTextColor(Ui.TEXT);
        chronometer.setTypeface(Ui.LIGHT);
        chronometer.setGravity(Gravity.CENTER);
        chronometer.setIncludeFontPadding(false);
        chronometer.setPadding(0, Ui.dp(context, 42), 0, Ui.dp(context, 26));
        chronometer.setBase(SystemClock.elapsedRealtime());
        stopwatchPane.addView(chronometer, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        stopwatchStart = Ui.button(context, "start", new OnClickListener() {
            @Override
            public void onClick(View view) {
                toggleStopwatch();
            }
        });
        stopwatchPane.addView(stopwatchStart, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(context, 46)));

        TextView stopwatchReset = Ui.text(context, "reset", 12, Ui.MUTED);
        stopwatchReset.setGravity(Gravity.CENTER);
        stopwatchReset.setPadding(0, Ui.dp(context, 14), 0, 0);
        stopwatchReset.setClickable(true);
        stopwatchReset.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                resetStopwatch();
            }
        });
        stopwatchPane.addView(stopwatchReset);

        addView(stopwatchPane);
    }

    private void showTimer() {
        timerPane.setVisibility(VISIBLE);
        stopwatchPane.setVisibility(GONE);
        timerTab.setBackground(Ui.shape(context, Ui.TEXT, 30, 0));
        timerTab.setTextColor(Ui.BG);
        stopwatchTab.setBackground(Ui.shape(context, 0x00000000, 30, Ui.LINE));
        stopwatchTab.setTextColor(Ui.TEXT);
    }

    private void showStopwatch() {
        timerPane.setVisibility(GONE);
        stopwatchPane.setVisibility(VISIBLE);
        stopwatchTab.setBackground(Ui.shape(context, Ui.TEXT, 30, 0));
        stopwatchTab.setTextColor(Ui.BG);
        timerTab.setBackground(Ui.shape(context, 0x00000000, 30, Ui.LINE));
        timerTab.setTextColor(Ui.TEXT);
    }

    void refresh() {
        renderTimer();
    }

    private void toggleTimer() {
        if (timerRunning) {
            timerRunning = false;
            handler.removeCallbacks(ticker);
            timerRemaining = Math.max(0, timerEndsAt - SystemClock.elapsedRealtime());
            AlarmStore.cancelTimer(context);
            startButton.setText("start");
            return;
        }

        if (timerRemaining <= 0) {
            timerRemaining = 5 * 60_000L;
        }
        timerEndsAt = SystemClock.elapsedRealtime() + timerRemaining;
        timerRunning = true;
        AlarmStore.scheduleTimer(context, System.currentTimeMillis() + timerRemaining);
        startButton.setText("pause");
        handler.post(ticker);
    }

    private void resetTimer() {
        timerRunning = false;
        handler.removeCallbacks(ticker);
        AlarmStore.cancelTimer(context);
        timerRemaining = 5 * 60_000L;
        startButton.setText("start");
        renderTimer();
    }

    private void renderTimer() {
        long remaining = Math.max(0, timerRemaining);
        long totalSeconds = remaining / 1000;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        long seconds = totalSeconds % 60;
        String text = hours > 0
                ? String.format(Locale.getDefault(), "%d:%02d:%02d", hours, minutes, seconds)
                : String.format(Locale.getDefault(), "%02d:%02d", minutes, seconds);
        timerDisplay.setText(text);
    }

    private void toggleStopwatch() {
        if (stopwatchRunning) {
            chronometer.stop();
            stopwatchAccumulated = SystemClock.elapsedRealtime() - chronometer.getBase();
            stopwatchRunning = false;
            stopwatchStart.setText("start");
        } else {
            chronometer.setBase(SystemClock.elapsedRealtime() - stopwatchAccumulated);
            chronometer.start();
            stopwatchRunning = true;
            stopwatchStart.setText("pause");
        }
    }

    private void resetStopwatch() {
        chronometer.stop();
        stopwatchRunning = false;
        stopwatchAccumulated = 0;
        chronometer.setBase(SystemClock.elapsedRealtime());
        stopwatchStart.setText("start");
    }
}
