package com.daytime.app;

import android.app.Dialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.NumberPicker;
import android.widget.TextView;

import java.util.Calendar;
import java.util.Locale;

/** Add or edit an alarm: time, label and repeat days. */
final class AlarmDialog {

    private static final String[] DAYS = {"s", "m", "t", "w", "t", "f", "s"};

    private AlarmDialog() {
    }

    static void show(Context context, AlarmStore.Alarm existing, Runnable onChanged) {
        final Dialog dialog = new Dialog(context);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = Ui.column(context);
        root.setPadding(Ui.dp(context, 22), Ui.dp(context, 22), Ui.dp(context, 22), Ui.dp(context, 18));
        root.setBackground(Ui.shape(context, Ui.SURFACE, 26, Ui.LINE));

        root.addView(Ui.label(context, existing == null ? "new alarm" : "edit alarm"));

        final NumberPicker hourPicker = new NumberPicker(context);
        hourPicker.setMinValue(0);
        hourPicker.setMaxValue(23);
        hourPicker.setFormatter(twoDigits());
        hourPicker.setWrapSelectorWheel(false);

        final NumberPicker minutePicker = new NumberPicker(context);
        minutePicker.setMinValue(0);
        minutePicker.setMaxValue(59);
        minutePicker.setFormatter(twoDigits());
        minutePicker.setWrapSelectorWheel(false);

        int hour = existing != null ? existing.hour : 7;
        int minute = existing != null ? existing.minute : 30;
        hourPicker.setValue(hour);
        minutePicker.setValue(minute);
        tintPicker(hourPicker);
        tintPicker(minutePicker);

        LinearLayout timeRow = Ui.row(context);
        timeRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams pickerParams = new LinearLayout.LayoutParams(
                Ui.dp(context, 84), Ui.dp(context, 132));
        timeRow.addView(hourPicker, pickerParams);

        TextView colon = Ui.display(context, ":", 34);
        timeRow.addView(colon);

        timeRow.addView(minutePicker, new LinearLayout.LayoutParams(
                Ui.dp(context, 84), Ui.dp(context, 132)));

        LinearLayout.LayoutParams timeParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        timeParams.topMargin = Ui.dp(context, 6);
        timeParams.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(timeRow, timeParams);

        final EditText labelInput = new EditText(context);
        labelInput.setHint("label");
        labelInput.setText(existing != null ? existing.label : "");
        labelInput.setHintTextColor(Ui.MUTED);
        labelInput.setTextColor(Ui.TEXT);
        labelInput.setTextSize(14);
        labelInput.setSingleLine(true);
        labelInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        labelInput.setBackground(Ui.shape(context, Ui.SURFACE_RAISED, 14, Ui.LINE));
        labelInput.setPadding(Ui.dp(context, 14), Ui.dp(context, 12), Ui.dp(context, 14), Ui.dp(context, 12));
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        labelParams.topMargin = Ui.dp(context, 18);
        root.addView(labelInput, labelParams);

        final boolean[] days = new boolean[7];
        if (existing != null) {
            System.arraycopy(existing.days, 0, days, 0, 7);
        }

        LinearLayout dayRow = Ui.row(context);
        dayRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams dayRowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        dayRowParams.topMargin = Ui.dp(context, 16);
        root.addView(dayRow, dayRowParams);

        final TextView[] chips = new TextView[7];
        for (int index = 0; index < 7; index++) {
            final int dayIndex = index;
            TextView chip = Ui.chip(context, DAYS[index], days[index]);
            chip.setTextSize(11);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    Ui.dp(context, 38), Ui.dp(context, 38));
            params.setMargins(Ui.dp(context, 2), 0, Ui.dp(context, 2), 0);
            chip.setLayoutParams(params);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    days[dayIndex] = !days[dayIndex];
                    TextView target = (TextView) view;
                    target.setBackground(days[dayIndex]
                            ? Ui.shape(context, Ui.TEXT, 30, 0)
                            : Ui.shape(context, 0x00000000, 30, Ui.LINE));
                    target.setTextColor(days[dayIndex] ? Ui.BG : Ui.TEXT);
                }
            });
            chips[index] = chip;
            dayRow.addView(chip);
        }

        LinearLayout actions = Ui.row(context);
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        actionParams.topMargin = Ui.dp(context, 22);
        root.addView(actions, actionParams);

        if (existing != null) {
            TextView delete = Ui.text(context, "delete", 12, Ui.RED);
            delete.setGravity(Gravity.CENTER);
            delete.setPadding(Ui.dp(context, 14), Ui.dp(context, 12), Ui.dp(context, 14), Ui.dp(context, 12));
            delete.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    AlarmStore.delete(context, existing.id);
                    dialog.dismiss();
                    onChanged.run();
                }
            });
            actions.addView(delete);
        }

        actions.addView(new View(context), Ui.weight());

        TextView cancel = Ui.text(context, "cancel", 12, Ui.MUTED);
        cancel.setGravity(Gravity.CENTER);
        cancel.setPadding(Ui.dp(context, 14), Ui.dp(context, 12), Ui.dp(context, 14), Ui.dp(context, 12));
        cancel.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                dialog.dismiss();
            }
        });
        actions.addView(cancel);

        TextView save = Ui.text(context, "save", 12, Ui.BG);
        save.setGravity(Gravity.CENTER);
        save.setBackground(Ui.shape(context, Ui.TEXT, 20, 0));
        save.setPadding(Ui.dp(context, 22), Ui.dp(context, 11), Ui.dp(context, 22), Ui.dp(context, 11));
        save.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                AlarmStore.Alarm alarm = existing != null ? existing : new AlarmStore.Alarm();
                if (existing == null) {
                    alarm.id = (int) (System.currentTimeMillis() % 1000000L) + 10;
                }
                alarm.hour = hourPicker.getValue();
                alarm.minute = minutePicker.getValue();
                alarm.label = labelInput.getText().toString().trim();
                System.arraycopy(days, 0, alarm.days, 0, 7);
                alarm.enabled = true;
                AlarmStore.upsert(context, alarm);
                dialog.dismiss();
                onChanged.run();
            }
        });
        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        saveParams.setMargins(Ui.dp(context, 6), 0, 0, 0);
        actions.addView(save, saveParams);

        dialog.setContentView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.width = WindowManager.LayoutParams.MATCH_PARENT;
            attributes.dimAmount = 0.7f;
            window.setAttributes(attributes);
        }

        dialog.show();
    }

    private static NumberPicker.Formatter twoDigits() {
        return new NumberPicker.Formatter() {
            @Override
            public String format(int value) {
                return String.format(Locale.getDefault(), "%02d", value);
            }
        };
    }

    private static void tintPicker(NumberPicker picker) {
        for (int index = 0; index < picker.getChildCount(); index++) {
            View child = picker.getChildAt(index);
            if (child instanceof EditText) {
                EditText edit = (EditText) child;
                edit.setTextColor(Ui.TEXT);
                edit.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
                edit.setBackgroundColor(Color.TRANSPARENT);
            }
        }
    }
}
