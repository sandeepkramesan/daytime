package com.daytime.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.provider.CalendarContract;
import android.view.Gravity;
import android.view.View;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Month grid plus the selected day's agenda, backed by the device calendar. */
final class CalendarSection extends ScrollView {

    private static final String[] WEEKDAYS = {"s", "m", "t", "w", "t", "f", "s"};

    private final Context context;
    private final LinearLayout content;
    private final TextView monthLabel;
    private final GridLayout grid;
    private final LinearLayout agenda;
    private final TextView agendaTitle;
    private final TextView allowButton;
    private final Calendar shown = Calendar.getInstance();
    private final Calendar selected = Calendar.getInstance();
    private final Set<Integer> eventDays = new HashSet<>();

    private Runnable onPermissionRequested;

    CalendarSection(Context context) {
        super(context);
        this.context = context;
        setFillViewport(true);
        setBackgroundColor(Ui.BG);

        content = Ui.column(context);
        content.setPadding(Ui.dp(context, 20), Ui.dp(context, 2), Ui.dp(context, 20), Ui.dp(context, 26));
        addView(content);

        shown.set(Calendar.DAY_OF_MONTH, 1);
        normalize(selected);

        LinearLayout header = Ui.row(context);
        header.setPadding(0, Ui.dp(context, 6), 0, Ui.dp(context, 10));

        TextView previous = navButton("‹");
        previous.setContentDescription("previous month");
        previous.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                shown.add(Calendar.MONTH, -1);
                selected.setTimeInMillis(shown.getTimeInMillis());
                normalize(selected);
                refresh();
            }
        });

        monthLabel = Ui.display(context, "", 19);
        monthLabel.setGravity(Gravity.CENTER);

        TextView next = navButton("›");
        next.setContentDescription("next month");
        next.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                shown.add(Calendar.MONTH, 1);
                selected.setTimeInMillis(shown.getTimeInMillis());
                normalize(selected);
                refresh();
            }
        });

        TextView today = Ui.chip(context, "today", false);
        today.setTextSize(10);
        today.setPadding(Ui.dp(context, 12), Ui.dp(context, 7), Ui.dp(context, 12), Ui.dp(context, 7));
        today.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                Calendar now = Calendar.getInstance();
                normalize(now);
                shown.setTimeInMillis(now.getTimeInMillis());
                shown.set(Calendar.DAY_OF_MONTH, 1);
                selected.setTimeInMillis(now.getTimeInMillis());
                refresh();
            }
        });

        header.addView(previous);
        header.addView(monthLabel, Ui.weight());
        header.addView(today);
        header.addView(next);
        content.addView(header);

        LinearLayout weekdayRow = Ui.row(context);
        for (String weekday : WEEKDAYS) {
            TextView cell = Ui.text(context, weekday, 9.5f, Ui.COOL);
            cell.setGravity(Gravity.CENTER);
            cell.setLetterSpacing(0.1f);
            cell.setAllCaps(true);
            weekdayRow.addView(cell, new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        }
        content.addView(weekdayRow);

        grid = new GridLayout(context);
        grid.setColumnCount(7);
        grid.setRowCount(6);
        LinearLayout.LayoutParams gridParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        gridParams.topMargin = Ui.dp(context, 4);
        content.addView(grid, gridParams);

        allowButton = Ui.button(context, "allow calendar access", new OnClickListener() {
            @Override
            public void onClick(View view) {
                if (onPermissionRequested != null) {
                    onPermissionRequested.run();
                }
            }
        });
        LinearLayout.LayoutParams allowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(context, 46));
        allowParams.topMargin = Ui.dp(context, 18);
        allowParams.bottomMargin = Ui.dp(context, 8);
        content.addView(allowButton, allowParams);

        content.addView(Ui.spacer(context, 14));
        agendaTitle = Ui.label(context, "agenda");
        content.addView(agendaTitle);

        agenda = Ui.column(context);
        content.addView(agenda);

        TextView addEvent = Ui.button(context, "add event", new OnClickListener() {
            @Override
            public void onClick(View view) {
                addEvent();
            }
        });
        LinearLayout.LayoutParams addParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(context, 46));
        addParams.topMargin = Ui.dp(context, 20);
        content.addView(addEvent, addParams);
    }

    void setOnPermissionRequested(Runnable runnable) {
        this.onPermissionRequested = runnable;
    }

    void refresh() {
        boolean permitted = CalendarReader.hasPermission(context);
        allowButton.setVisibility(permitted ? GONE : VISIBLE);

        eventDays.clear();
        if (permitted) {
            Calendar start = (Calendar) shown.clone();
            start.set(Calendar.DAY_OF_MONTH, 1);
            normalize(start);
            Calendar end = (Calendar) start.clone();
            end.add(Calendar.MONTH, 1);

            for (CalendarReader.Event event : CalendarReader.range(
                    context, start.getTimeInMillis(), end.getTimeInMillis())) {
                Calendar day = Calendar.getInstance();
                day.setTimeInMillis(event.start);
                eventDays.add(day.get(Calendar.YEAR) * 10000
                        + (day.get(Calendar.MONTH) + 1) * 100
                        + day.get(Calendar.DAY_OF_MONTH));
            }
        }

        renderMonth();
        renderAgenda(permitted);
    }

    private void renderMonth() {
        monthLabel.setText(new SimpleDateFormat("MMMM yyyy", Locale.getDefault())
                .format(shown.getTime()));

        grid.removeAllViews();

        Calendar cursor = (Calendar) shown.clone();
        cursor.set(Calendar.DAY_OF_MONTH, 1);
        int leading = cursor.get(Calendar.DAY_OF_WEEK) - 1;
        cursor.add(Calendar.DAY_OF_MONTH, -leading);

        for (int index = 0; index < 42; index++) {
            Calendar day = (Calendar) cursor.clone();
            boolean inMonth = day.get(Calendar.MONTH) == shown.get(Calendar.MONTH);
            grid.addView(buildCell(day, inMonth));
            cursor.add(Calendar.DAY_OF_MONTH, 1);
        }
    }

    private View buildCell(final Calendar day, boolean inMonth) {
        Calendar normalizedDay = (Calendar) day.clone();
        normalize(normalizedDay);

        boolean isSelected = sameDay(normalizedDay, selected);
        boolean isToday = sameDay(normalizedDay, Calendar.getInstance());
        boolean hasEvents = eventDays.contains(dayKey(normalizedDay));

        LinearLayout cell = Ui.column(context);
        cell.setGravity(Gravity.CENTER);

        GridLayout.LayoutParams params = new GridLayout.LayoutParams();
        params.width = 0;
        params.height = Ui.dp(context, 44);
        params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
        cell.setLayoutParams(params);

        TextView number = Ui.text(context, String.valueOf(day.get(Calendar.DAY_OF_MONTH)), 13,
                isSelected ? Ui.BG : inMonth ? Ui.TEXT : 0xFF4A4A4A);
        number.setGravity(Gravity.CENTER);
        number.setTextSize(13);
        int size = Ui.dp(context, 30);
        number.setLayoutParams(new LinearLayout.LayoutParams(size, size));
        if (isSelected) {
            number.setBackground(Ui.circle(Ui.TEXT));
        }

        View dot = new View(context);
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(
                Ui.dp(context, 3), Ui.dp(context, 3));
        dotParams.topMargin = Ui.dp(context, 3);
        dot.setLayoutParams(dotParams);
        if (isToday) {
            dot.setBackground(Ui.circle(Ui.RED));
            dot.setVisibility(VISIBLE);
        } else if (hasEvents && inMonth) {
            dot.setBackground(Ui.circle(Ui.COOL));
            dot.setVisibility(VISIBLE);
        } else {
            dot.setVisibility(INVISIBLE);
        }

        cell.addView(number);
        cell.addView(dot);

        cell.setClickable(true);
        cell.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                selected.setTimeInMillis(day.getTimeInMillis());
                normalize(selected);
                shown.setTimeInMillis(selected.getTimeInMillis());
                shown.set(Calendar.DAY_OF_MONTH, 1);
                refresh();
            }
        });

        return cell;
    }

    private void renderAgenda(boolean permitted) {
        agenda.removeAllViews();
        agendaTitle.setText("agenda · " + new SimpleDateFormat("EEE d MMM", Locale.getDefault())
                .format(selected.getTime()).toLowerCase(Locale.getDefault()));

        if (!permitted) {
            TextView hint = Ui.text(context, "daytime is read-only; it shows the calendars already on this phone.",
                    12, Ui.MUTED);
            hint.setPadding(0, Ui.dp(context, 10), 0, 0);
            agenda.addView(hint);
            return;
        }

        Calendar start = (Calendar) selected.clone();
        normalize(start);
        Calendar end = (Calendar) start.clone();
        end.add(Calendar.DAY_OF_YEAR, 1);

        List<CalendarReader.Event> events = CalendarReader.range(
                context, start.getTimeInMillis(), end.getTimeInMillis());

        if (events.isEmpty()) {
            TextView empty = Ui.text(context, "nothing scheduled", 12, Ui.MUTED);
            empty.setPadding(0, Ui.dp(context, 12), 0, 0);
            agenda.addView(empty);
            return;
        }

        for (CalendarReader.Event event : events) {
            LinearLayout row = Ui.row(context);
            row.setPadding(0, Ui.dp(context, 12), 0, Ui.dp(context, 12));

            TextView time = Ui.text(context,
                    event.allDay ? "all day" : SolarTimes.formatTime(context, event.start),
                    11, Ui.COOL);
            time.setLayoutParams(new LinearLayout.LayoutParams(Ui.dp(context, 58),
                    LinearLayout.LayoutParams.WRAP_CONTENT));
            row.addView(time);

            row.addView(Ui.text(context, event.title, 13, Ui.TEXT), Ui.weight());
            agenda.addView(row);

            View divider = new View(context);
            divider.setBackgroundColor(Ui.LINE);
            agenda.addView(divider, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(context, 0.7f)));
        }
    }

    private void addEvent() {
        Calendar begin = (Calendar) selected.clone();
        normalize(begin);
        begin.set(Calendar.HOUR_OF_DAY, 9);

        Calendar end = (Calendar) begin.clone();
        end.set(Calendar.HOUR_OF_DAY, 10);

        Intent intent = new Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin.getTimeInMillis())
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.getTimeInMillis());

        try {
            context.startActivity(intent);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(context, "No calendar app can create events.", Toast.LENGTH_LONG).show();
        }
    }

    private TextView navButton(String glyph) {
        TextView button = Ui.text(context, glyph, 22, Ui.COOL);
        button.setGravity(Gravity.CENTER);
        button.setPadding(Ui.dp(context, 10), Ui.dp(context, 4), Ui.dp(context, 10), Ui.dp(context, 8));
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    private static int dayKey(Calendar calendar) {
        return calendar.get(Calendar.YEAR) * 10000
                + (calendar.get(Calendar.MONTH) + 1) * 100
                + calendar.get(Calendar.DAY_OF_MONTH);
    }

    private static boolean sameDay(Calendar left, Calendar right) {
        return left.get(Calendar.YEAR) == right.get(Calendar.YEAR)
                && left.get(Calendar.DAY_OF_YEAR) == right.get(Calendar.DAY_OF_YEAR);
    }

    private static void normalize(Calendar calendar) {
        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
    }
}
