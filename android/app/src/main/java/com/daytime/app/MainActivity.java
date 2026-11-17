package com.daytime.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** One screen, four tabs: clock, alarms, measure, calendar. */
public class MainActivity extends Activity {

    private static final int REQUEST_CALENDAR = 1;
    private static final int REQUEST_LOCATION = 2;
    private static final int REQUEST_NOTIFICATIONS = 3;

    private static final String[] TAB_NAMES = {"clock", "alarms", "measure", "calendar"};

    private final ClockSection[] clockSection = new ClockSection[1];
    private final AlarmsSection[] alarmsSection = new AlarmsSection[1];
    private final MeasureSection[] measureSection = new MeasureSection[1];
    private final CalendarSection[] calendarSection = new CalendarSection[1];
    private final TextView[] tabLabels = new TextView[TAB_NAMES.length];
    private final View[] tabDots = new View[TAB_NAMES.length];

    private String current = "clock";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        NotificationHelper.ensureChannels(this);
        try {
            buildUi();
            // Desktop/freeform windows can launch "small"; ask for the whole
            // window explicitly. Harmless on a normal full-screen phone.
            getWindow().setLayout(
                    android.view.WindowManager.LayoutParams.MATCH_PARENT,
                    android.view.WindowManager.LayoutParams.MATCH_PARENT);
            show("clock");
            installWindowDiagnostics();
            android.util.Log.i("daytime", "ui ready");
        } catch (Throwable error) {
            android.util.Log.e("daytime", "startup failed", error);
            setContentView(errorView(error));
            return;
        }
        askForNotifications();
        if (!CalendarReader.hasPermission(this)) {
            // Ask on first launch so the home-screen widget fills in right away.
            requestCalendar();
        }
    }

    /**
     * If the app ends up in a window smaller than the display (widget launch
     * bounds, freeform, desktop mode), show the measured size so a screenshot
     * tells us exactly what the system did.
     */
    private void installWindowDiagnostics() {
        final View decor = getWindow().getDecorView();
        decor.postDelayed(new Runnable() {
            @Override
            public void run() {
                android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
                int width = decor.getWidth();
                int height = decor.getHeight();
                android.util.Log.i("daytime", "window " + width + "x" + height
                        + " screen " + metrics.widthPixels + "x" + metrics.heightPixels);

                boolean small = width < metrics.widthPixels * 0.85
                        || height < metrics.heightPixels * 0.85;
                if (!small) {
                    return;
                }

                getWindow().setLayout(
                        android.view.WindowManager.LayoutParams.MATCH_PARENT,
                        android.view.WindowManager.LayoutParams.MATCH_PARENT);

                TextView debug = new TextView(MainActivity.this);
                debug.setText("window " + width + "x" + height
                        + "  screen " + metrics.widthPixels + "x" + metrics.heightPixels);
                debug.setTextSize(10);
                debug.setTextColor(0xFFFFFFFF);
                debug.setBackgroundColor(0xFF333333);
                debug.setPadding(Ui.dp(MainActivity.this, 6), Ui.dp(MainActivity.this, 3),
                        Ui.dp(MainActivity.this, 6), Ui.dp(MainActivity.this, 3));

                if (decor instanceof FrameLayout) {
                    FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.WRAP_CONTENT);
                    params.gravity = Gravity.TOP;
                    ((FrameLayout) decor).addView(debug, params);
                }
            }
        }, 900);
    }

    private View errorView(Throwable error) {
        LinearLayout layout = Ui.column(this);
        layout.setBackgroundColor(Ui.BG);
        layout.setPadding(Ui.dp(this, 24), Ui.dp(this, 90), Ui.dp(this, 24), Ui.dp(this, 24));
        layout.setGravity(Gravity.TOP);

        layout.addView(Ui.text(this, "daytime could not start", 18, Ui.TEXT));
        TextView detail = Ui.text(this, String.valueOf(error), 11, Ui.MUTED);
        detail.setPadding(0, Ui.dp(this, 14), 0, 0);
        layout.addView(detail);
        return layout;
    }

    private void buildUi() {
        LinearLayout root = Ui.column(this);
        root.setBackgroundColor(Ui.BG);
        root.setGravity(Gravity.TOP);

        LinearLayout header = Ui.row(this);
        header.setPadding(Ui.dp(this, 24), Ui.dp(this, 20), Ui.dp(this, 24), Ui.dp(this, 4));

        TextView brand = Ui.text(this, "daytime", 15, Ui.TEXT);
        brand.setTypeface(Ui.MEDIUM);
        brand.setLetterSpacing(0.16f);
        header.addView(brand);

        View dot = new View(this);
        dot.setBackground(Ui.circle(Ui.RED));
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(
                Ui.dp(this, 5), Ui.dp(this, 5));
        dotParams.leftMargin = Ui.dp(this, 7);
        dotParams.topMargin = Ui.dp(this, 1);
        header.addView(dot, dotParams);
        header.addView(new View(this), Ui.weight());

        root.addView(header, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        FrameLayout content = new FrameLayout(this);
        clockSection[0] = new ClockSection(this);
        alarmsSection[0] = new AlarmsSection(this);
        measureSection[0] = new MeasureSection(this);
        calendarSection[0] = new CalendarSection(this);

        clockSection[0].setOnLocationRequested(new Runnable() {
            @Override
            public void run() {
                requestLocation();
            }
        });
        calendarSection[0].setOnPermissionRequested(new Runnable() {
            @Override
            public void run() {
                requestCalendar();
            }
        });

        content.addView(clockSection[0], fullFrame());
        content.addView(alarmsSection[0], fullFrame());
        content.addView(measureSection[0], fullFrame());
        content.addView(calendarSection[0], fullFrame());

        root.addView(content, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        View line = new View(this);
        line.setBackgroundColor(Ui.LINE);
        root.addView(line, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Math.max(1, Ui.dp(this, 0.7f))));

        LinearLayout nav = Ui.row(this);
        nav.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 16));
        for (int index = 0; index < TAB_NAMES.length; index++) {
            final String name = TAB_NAMES[index];

            LinearLayout item = Ui.column(this);
            item.setGravity(Gravity.CENTER);
            item.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 6));
            item.setClickable(true);
            item.setFocusable(true);
            item.setContentDescription(name + " tab");

            TextView label = Ui.text(this, name, 10, Ui.MUTED);
            label.setLetterSpacing(0.12f);
            label.setGravity(Gravity.CENTER);
            item.addView(label, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            View indicator = new View(this);
            indicator.setBackground(Ui.circle(Ui.RED));
            LinearLayout.LayoutParams indicatorParams = new LinearLayout.LayoutParams(
                    Ui.dp(this, 4), Ui.dp(this, 4));
            indicatorParams.topMargin = Ui.dp(this, 6);
            indicator.setLayoutParams(indicatorParams);
            indicator.setVisibility(View.INVISIBLE);
            item.addView(indicator);

            tabLabels[index] = label;
            tabDots[index] = indicator;

            item.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    show(name);
                }
            });

            nav.addView(item, new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        }
        root.addView(nav, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        setContentView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // A widget tap or desktop-mode launch can hand the activity the widget's
        // small bounds. Ask again after the launch animation settles.
        final View rootView = root;
        rootView.postDelayed(new Runnable() {
            @Override
            public void run() {
                getWindow().setLayout(
                        android.view.WindowManager.LayoutParams.MATCH_PARENT,
                        android.view.WindowManager.LayoutParams.MATCH_PARENT);
                android.util.Log.i("daytime", "window " + rootView.getWidth() + "x" + rootView.getHeight());
            }
        }, 350);
    }

    private FrameLayout.LayoutParams fullFrame() {
        return new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
    }

    private void show(String name) {
        current = name;
        clockSection[0].setVisibility(name.equals("clock") ? View.VISIBLE : View.GONE);
        alarmsSection[0].setVisibility(name.equals("alarms") ? View.VISIBLE : View.GONE);
        measureSection[0].setVisibility(name.equals("measure") ? View.VISIBLE : View.GONE);
        calendarSection[0].setVisibility(name.equals("calendar") ? View.VISIBLE : View.GONE);

        for (int index = 0; index < TAB_NAMES.length; index++) {
            boolean active = TAB_NAMES[index].equals(name);
            tabLabels[index].setTextColor(active ? Ui.TEXT : Ui.MUTED);
            tabDots[index].setVisibility(active ? View.VISIBLE : View.INVISIBLE);
        }

        refreshCurrent();
    }

    private void refreshCurrent() {
        if (current.equals("clock")) {
            clockSection[0].refresh();
        } else if (current.equals("alarms")) {
            alarmsSection[0].refresh();
        } else if (current.equals("measure")) {
            measureSection[0].refresh();
        } else if (current.equals("calendar")) {
            calendarSection[0].refresh();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshCurrent();
        WidgetRenderer.updateAll(this);
    }

    private void askForNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
    }

    private void requestCalendar() {
        if (CalendarReader.hasPermission(this)) {
            calendarSection[0].refresh();
            return;
        }
        requestPermissions(new String[]{Manifest.permission.READ_CALENDAR}, REQUEST_CALENDAR);
    }

    private void requestLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
            readLastLocation();
            return;
        }
        requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, REQUEST_LOCATION);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQUEST_LOCATION
                && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            readLastLocation();
            return;
        }

        refreshCurrent();
        WidgetRenderer.updateAll(this);
    }

    @SuppressWarnings("MissingPermission")
    private void readLastLocation() {
        LocationManager manager = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (manager == null) {
            Toast.makeText(this, "Location is unavailable on this device.", Toast.LENGTH_LONG).show();
            return;
        }

        Location best = null;
        try {
            for (String provider : manager.getProviders(true)) {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate != null && (best == null || candidate.getTime() > best.getTime())) {
                    best = candidate;
                }
            }
        } catch (SecurityException ignored) {
            // Permission was revoked; handled below.
        }

        if (best == null) {
            Toast.makeText(this, "No location saved yet. Open Maps once, then try again.",
                    Toast.LENGTH_LONG).show();
            return;
        }

        Prefs.saveLocation(this, best.getLatitude(), best.getLongitude());
        clockSection[0].refresh();
        WidgetRenderer.updateAll(this);
    }
}
