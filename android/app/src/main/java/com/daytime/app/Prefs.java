package com.daytime.app;

import android.content.Context;
import android.content.SharedPreferences;

/** The only persisted state: the coordinates used for sunrise and sunset. */
final class Prefs {

    private static final String FILE = "daytime";
    private static final String KEY_LATITUDE = "latitude";
    private static final String KEY_LONGITUDE = "longitude";

    private Prefs() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static boolean hasLocation(Context context) {
        return prefs(context).contains(KEY_LATITUDE) && prefs(context).contains(KEY_LONGITUDE);
    }

    static void saveLocation(Context context, double latitude, double longitude) {
        prefs(context).edit()
                .putLong(KEY_LATITUDE, Double.doubleToRawLongBits(latitude))
                .putLong(KEY_LONGITUDE, Double.doubleToRawLongBits(longitude))
                .apply();
    }

    static double latitude(Context context) {
        return Double.longBitsToDouble(prefs(context).getLong(KEY_LATITUDE, 0L));
    }

    static double longitude(Context context) {
        return Double.longBitsToDouble(prefs(context).getLong(KEY_LONGITUDE, 0L));
    }
}
