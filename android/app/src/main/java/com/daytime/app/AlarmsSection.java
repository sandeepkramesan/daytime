package com.daytime.app;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.util.List;

/** The alarm list, with add, edit, delete and enable. */
final class AlarmsSection extends LinearLayout {

    private final Context context;
    private final LinearLayout list;

    AlarmsSection(Context context) {
        super(context);
        this.context = context;
        setOrientation(VERTICAL);
        setPadding(Ui.dp(context, 22), Ui.dp(context, 4), Ui.dp(context, 22), Ui.dp(context, 20));

        LinearLayout header = Ui.row(context);
        header.addView(Ui.display(context, "alarms", 26), Ui.weight());

        TextView add = Ui.text(context, "+", 28, Ui.COOL);
        add.setGravity(Gravity.CENTER);
        add.setPadding(Ui.dp(context, 12), Ui.dp(context, 4), Ui.dp(context, 4), Ui.dp(context, 8));
        add.setClickable(true);
        add.setContentDescription("add alarm");
        add.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                AlarmDialog.show(context, null, new Runnable() {
                    @Override
                    public void run() {
                        refresh();
                    }
                });
            }
        });
        header.addView(add);
        addView(header);

        ScrollView scroll = new ScrollView(context);
        scroll.setFillViewport(true);
        list = Ui.column(context);
        list.setPadding(0, Ui.dp(context, 10), 0, 0);
        scroll.addView(list);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        addView(scroll, scrollParams);
    }

    void refresh() {
        list.removeAllViews();

        List<AlarmStore.Alarm> alarms = AlarmStore.load(context);
        if (alarms.isEmpty()) {
            TextView empty = Ui.text(context, "no alarms yet", 13, Ui.MUTED);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, Ui.dp(context, 40), 0, 0);
            list.addView(empty);

            TextView hint = Ui.text(context, "tap + to add the first one", 11, Ui.COOL);
            hint.setGravity(Gravity.CENTER);
            hint.setPadding(0, Ui.dp(context, 8), 0, 0);
            list.addView(hint);
            return;
        }

        for (final AlarmStore.Alarm alarm : alarms) {
            list.addView(buildRow(alarm));
        }
    }

    private View buildRow(final AlarmStore.Alarm alarm) {
        LinearLayout row = Ui.row(context);
        row.setPadding(0, Ui.dp(context, 16), 0, Ui.dp(context, 16));

        TextView time = Ui.display(context, alarm.timeText(), 32);
        time.setTextColor(alarm.enabled ? Ui.TEXT : Ui.MUTED);
        row.addView(time);

        LinearLayout copy = Ui.column(context);
        copy.setPadding(Ui.dp(context, 16), 0, Ui.dp(context, 10), 0);

        String label = alarm.label.isEmpty() ? "alarm" : alarm.label;
        copy.addView(Ui.text(context, label, 12, Ui.MUTED));
        TextView repeat = Ui.text(context, alarm.repeatText(), 10, Ui.COOL);
        repeat.setPadding(0, Ui.dp(context, 4), 0, 0);
        copy.addView(repeat);

        row.addView(copy, Ui.weight());

        Switch toggle = new Switch(context);
        toggle.setChecked(alarm.enabled);
        toggle.setContentDescription("enable alarm " + alarm.timeText());
        toggle.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton button, boolean checked) {
                alarm.enabled = checked;
                AlarmStore.upsert(context, alarm);
                refresh();
            }
        });
        row.addView(toggle);

        row.setClickable(true);
        row.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View view) {
                AlarmDialog.show(context, alarm, new Runnable() {
                    @Override
                    public void run() {
                        refresh();
                    }
                });
            }
        });

        LinearLayout container = Ui.column(context);
        container.addView(row);

        View divider = new View(context);
        divider.setBackgroundColor(Ui.LINE);
        container.addView(divider, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(context, 0.7f)));

        return container;
    }
}
