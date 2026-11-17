package com.daytime.app;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Small design system so every screen shares the same quiet, monochrome look. */
final class Ui {

    static final int BG = 0xFF050505;
    static final int SURFACE = 0xFF101010;
    static final int SURFACE_RAISED = 0xFF181818;
    static final int TEXT = 0xFFF5F5F5;
    static final int MUTED = 0xFF8F8F8F;
    static final int COOL = 0xFF93A3B4;
    static final int LINE = 0xFF242424;
    static final int RED = 0xFFED1C2E;

    static final Typeface THIN = Typeface.create("sans-serif-thin", Typeface.NORMAL);
    static final Typeface LIGHT = Typeface.create("sans-serif-light", Typeface.NORMAL);
    static final Typeface NORMAL = Typeface.create("sans-serif", Typeface.NORMAL);
    static final Typeface MEDIUM = Typeface.create("sans-serif-medium", Typeface.NORMAL);

    private Ui() {
    }

    static int dp(Context context, float value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, context.getResources().getDisplayMetrics()));
    }

    static TextView text(Context context, CharSequence value, float sizeSp, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(NORMAL);
        view.setIncludeFontPadding(false);
        return view;
    }

    static TextView label(Context context, CharSequence value) {
        TextView view = text(context, value, 9.5f, COOL);
        view.setAllCaps(true);
        view.setLetterSpacing(0.18f);
        return view;
    }

    static TextView display(Context context, CharSequence value, float sizeSp) {
        TextView view = text(context, value, sizeSp, TEXT);
        view.setTypeface(LIGHT);
        view.setLetterSpacing(-0.04f);
        return view;
    }

    static LinearLayout column(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    static LinearLayout row(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        return layout;
    }

    static LinearLayout.LayoutParams weight() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    }

    static LinearLayout.LayoutParams match(int height) {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height);
    }

    static View divider(Context context) {
        View view = new View(context);
        view.setBackgroundColor(LINE);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(context, 0.7f)));
        params.topMargin = dp(context, 18);
        params.bottomMargin = dp(context, 8);
        view.setLayoutParams(params);
        return view;
    }

    static GradientDrawable shape(Context context, int fill, float radiusDp, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(context, radiusDp));
        if (stroke != 0) {
            drawable.setStroke(Math.max(1, dp(context, 0.8f)), stroke);
        }
        return drawable;
    }

    static GradientDrawable circle(int fill) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        drawable.setColor(fill);
        return drawable;
    }

    static TextView button(Context context, CharSequence label, View.OnClickListener listener) {
        TextView view = text(context, label, 12f, TEXT);
        view.setGravity(Gravity.CENTER);
        view.setLayoutParams(match(dp(context, 46)));
        view.setBackground(shape(context, SURFACE_RAISED, 23, LINE));
        view.setClickable(true);
        view.setFocusable(true);
        view.setOnClickListener(listener);
        return view;
    }

    static TextView chip(Context context, CharSequence label, boolean active) {
        TextView view = text(context, label, 11f, active ? BG : TEXT);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(context, 14), dp(context, 9), dp(context, 14), dp(context, 9));
        view.setBackground(active
                ? shape(context, TEXT, 30, 0)
                : shape(context, 0x00000000, 30, LINE));
        view.setClickable(true);
        view.setFocusable(true);
        return view;
    }

    static View spacer(Context context, int heightDp) {
        View view = new View(context);
        view.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, heightDp)));
        return view;
    }

    static void margins(View view, int left, int top, int right, int bottom) {
        if (view.getLayoutParams() instanceof LinearLayout.LayoutParams) {
            LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) view.getLayoutParams();
            params.setMargins(dp(view.getContext(), left), dp(view.getContext(), top),
                    dp(view.getContext(), right), dp(view.getContext(), bottom));
            view.setLayoutParams(params);
        }
    }
}
