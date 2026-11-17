package com.daytime.app;

import android.content.Context;
import android.widget.LinearLayout;
import android.widget.TextClock;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** The clock face: live time, date, sun and world clocks. */
final class ClockSection extends LinearLayout {

    private final Context context;
    private final TextView dateView;
    private final TextView sunView;
    private final TextView nextAlarmView;
    private final TextView locationChip;
    private Runnable onLocationRequested;

    ClockSection(Context context) {
        super(context);
        this.context = context;
        setOrientation(VERTICAL);
        setPadding(Ui.dp(context, 24), Ui.dp(context, 4), Ui.dp(context, 24), Ui.dp(context, 28));

        TextClock clock = new TextClock(context);
        clock.setFormat12Hour("h:mm");
        clock.setFormat24Hour("HH:mm");
        clock.setTextSize(76);
        clock.setTextColor(Ui.TEXT);
        clock.setTypeface(Ui.LIGHT);
        clock.setIncludeFontPadding(false);
        clock.setLetterSpacing(-0.05f);
        addView(clock);

        dateView = Ui.text(context, "", 15, Ui.COOL);
        LinearLayout.LayoutParams dateParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        dateParams.topMargin = Ui.dp(context, 8);
        addView(dateView, dateParams);

        sunView = Ui.text(context, "", 11.5f, Ui.MUTED);
        LinearLayout.LayoutParams sunParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sunParams.topMargin = Ui.dp(context, 12);
        addView(sunView, sunParams);

        locationChip = Ui.chip(context, "use location", false);
        locationChip.setTextSize(10);
        LinearLayout.LayoutParams locationParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        locationParams.topMargin = Ui.dp(context, 10);
        locationChip.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(android.view.View view) {
                if (onLocationRequested != null) {
                    onLocationRequested.run();
                }
            }
        });
        addView(locationChip, locationParams);

        nextAlarmView = Ui.text(context, "", 11, Ui.COOL);
        LinearLayout.LayoutParams alarmParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        alarmParams.topMargin = Ui.dp(context, 14);
        addView(nextAlarmView, alarmParams);

        addView(Ui.spacer(context, 26));
        addView(Ui.label(context, "world clock"));

        addWorldRow("bengaluru", "Asia/Kolkata");
        addWorldRow("london", "Europe/London");
        addWorldRow("new york", "America/New_York");
        addWorldRow("tokyo", "Asia/Tokyo");
    }

    void setOnLocationRequested(Runnable runnable) {
        this.onLocationRequested = runnable;
    }

    void refresh() {
        dateView.setText(new SimpleDateFormat("EEEE · d MMMM", Locale.getDefault()).format(new Date()));

        String[] sun = SolarTimes.formatToday(context);
        if (sun == null) {
            sunView.setText("sunrise and sunset need a location");
            locationChip.setVisibility(VISIBLE);
        } else {
            if (sun[0].isEmpty() && sun[1].isEmpty()) {
                sunView.setText("polar day or night");
            } else {
                String sunrise = sun[0].isEmpty() ? "—" : sun[0];
                String sunset = sun[1].isEmpty() ? "—" : sun[1];
                sunView.setText("sunrise " + sunrise + "     sunset " + sunset);
            }
            locationChip.setVisibility(GONE);
        }

        String next = AlarmStore.nextAlarmText(context);
        nextAlarmView.setText(next);
        nextAlarmView.setVisibility(next.isEmpty() ? GONE : VISIBLE);
    }

    private void addWorldRow(String city, String zone) {
        LinearLayout row = Ui.row(context);
        row.setPadding(0, Ui.dp(context, 12), 0, Ui.dp(context, 12));

        TextView name = Ui.text(context, city, 12, Ui.MUTED);
        row.addView(name, Ui.weight());

        TextClock time = new TextClock(context);
        time.setFormat12Hour("h:mm");
        time.setFormat24Hour("HH:mm");
        time.setTimeZone(zone);
        time.setTextSize(16);
        time.setTextColor(Ui.TEXT);
        time.setTypeface(Ui.LIGHT);
        time.setIncludeFontPadding(false);
        row.addView(time);

        addView(row);

        android.view.View divider = new android.view.View(context);
        divider.setBackgroundColor(Ui.LINE);
        addView(divider, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(context, 0.7f)));
    }
}
