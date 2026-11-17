package com.daytime.app;

import android.content.Context;
import android.text.format.DateFormat;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Sunrise and sunset computed on the device with the NOAA "sunrise equation".
 *
 * The same maths as core.js, ported so the widget needs no network and no
 * third-party sun service. Returns null during polar day or polar night.
 */
final class SolarTimes {

    private SolarTimes() {
    }

    /** {sunrise, sunset} formatted for display, or null when no location is saved. */
    static String[] formatToday(Context context) {
        if (!Prefs.hasLocation(context)) {
            return null;
        }

        Calendar day = Calendar.getInstance();
        Date sunrise = compute(day, Prefs.latitude(context), Prefs.longitude(context), true);
        Date sunset = compute(day, Prefs.latitude(context), Prefs.longitude(context), false);

        if (sunrise == null && sunset == null) {
            return new String[]{"", ""};
        }

        return new String[]{
                sunrise == null ? "" : format(context, sunrise),
                sunset == null ? "" : format(context, sunset),
        };
    }

    static String formatTime(Context context, long millis) {
        return format(context, new Date(millis));
    }

    private static String format(Context context, Date date) {
        boolean twentyFourHour = DateFormat.is24HourFormat(context);
        SimpleDateFormat formatter = new SimpleDateFormat(
                twentyFourHour ? "HH:mm" : "h:mm",
                Locale.getDefault());
        formatter.setTimeZone(TimeZone.getDefault());
        return formatter.format(date);
    }

    private static Date compute(Calendar day, double latitude, double longitude, boolean sunrise) {
        long utcMidnight = utcMidnight(day);
        int dayOfYear = dayOfYear(day, utcMidnight);

        double longitudeHour = longitude / 15.0;
        double approximate = dayOfYear + ((sunrise ? 6 : 18) - longitudeHour) / 24.0;
        double meanAnomaly = 0.9856 * approximate - 3.289;
        double trueLongitude = normalize(meanAnomaly
                + 1.916 * Math.sin(Math.toRadians(meanAnomaly))
                + 0.020 * Math.sin(Math.toRadians(2 * meanAnomaly))
                + 282.634);

        double rightAscension = normalize(
                Math.toDegrees(Math.atan(0.91764 * Math.tan(Math.toRadians(trueLongitude)))));
        rightAscension += Math.floor(trueLongitude / 90) * 90 - Math.floor(rightAscension / 90) * 90;
        rightAscension /= 15;

        double sinDeclination = 0.39782 * Math.sin(Math.toRadians(trueLongitude));
        double cosDeclination = Math.cos(Math.asin(sinDeclination));
        double latitudeRadians = Math.toRadians(latitude);
        double cosHourAngle = (Math.cos(Math.toRadians(90.833))
                - sinDeclination * Math.sin(latitudeRadians))
                / (cosDeclination * Math.cos(latitudeRadians));

        if (Double.isNaN(cosHourAngle) || cosHourAngle > 1 || cosHourAngle < -1) {
            return null;
        }

        double hourAngle = (sunrise
                ? 360 - Math.toDegrees(Math.acos(cosHourAngle))
                : Math.toDegrees(Math.acos(cosHourAngle))) / 15;
        double localMeanTime = hourAngle + rightAscension - 0.06571 * approximate - 6.622;
        double utcHours = ((localMeanTime - longitudeHour) % 24 + 24) % 24;

        return new Date(utcMidnight + Math.round(utcHours * 3600000.0));
    }

    private static int dayOfYear(Calendar day, long utcMidnight) {
        Calendar yearStart = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        yearStart.clear();
        yearStart.set(day.get(Calendar.YEAR), Calendar.JANUARY, 1, 0, 0, 0);
        long base = yearStart.getTimeInMillis() - 86400000L; // Day 1 is January 1st.
        return (int) Math.floor((utcMidnight - base) / 86400000.0);
    }

    private static long utcMidnight(Calendar localDay) {
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        utc.clear();
        utc.set(localDay.get(Calendar.YEAR), localDay.get(Calendar.MONTH),
                localDay.get(Calendar.DAY_OF_MONTH), 0, 0, 0);
        return utc.getTimeInMillis();
    }

    private static double normalize(double value) {
        return ((value % 360) + 360) % 360;
    }
}
