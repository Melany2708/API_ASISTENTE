package com.amelia.agenda;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.CookieManager;
import org.json.JSONArray;
import org.json.JSONObject;

import javax.net.ssl.HttpsURLConnection;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class ReminderJob extends JobService {
    static final String CHANNEL = "agenda-reminders";
    private static final int JOB_ID = 401;
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private Future<?> work;
    private JobParameters current;

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("agenda", Context.MODE_PRIVATE);
    }

    static void schedule(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler.getPendingJob(JOB_ID) != null) return;
        scheduler.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, ReminderJob.class))
            .setPeriodic(15 * 60 * 1000L)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build());
    }

    static void check(Context context, Runnable done) {
        final String base = preferences(context).getString("server", "");
        final String cookie = base.isEmpty() ? null : CookieManager.getInstance().getCookie(base);
        WORKER.execute(() -> {
            try { fetchNotices(context.getApplicationContext(), base, cookie); }
            finally { done.run(); }
        });
    }

    @Override public boolean onStartJob(JobParameters params) {
        final String base = preferences(this).getString("server", "");
        final String cookie = base.isEmpty() ? null : CookieManager.getInstance().getCookie(base);
        current = params;
        work = WORKER.submit(() -> {
            try { fetchNotices(this, base, cookie); }
            finally { new android.os.Handler(getMainLooper()).post(() -> {
                if (current == params) { current = null; work = null; jobFinished(params, false); }
            }); }
        });
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        if (work != null) work.cancel(true);
        work = null;
        current = null;
        return true;
    }

    private static void fetchNotices(Context context, String base, String cookie) {
        if (cookie == null || cookie.isEmpty()) return;
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) new URL(base + "/api/notices").openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Cookie", cookie);
            if (connection.getResponseCode() != 200) return;
            JSONArray notices;
            try (InputStream input = connection.getInputStream()) {
                byte[] bytes = new byte[100000];
                int total = 0;
                int count;
                while (total < bytes.length && (count = input.read(bytes, total, bytes.length - total)) > 0) total += count;
                notices = new JSONObject(new String(bytes, 0, total, StandardCharsets.UTF_8)).getJSONArray("notices");
            }
            SharedPreferences prefs = preferences(context);
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (!base.equals(prefs.getString("server", "")) || !manager.areNotificationsEnabled()) return;
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Recordatorios de Amelia", NotificationManager.IMPORTANCE_DEFAULT));
            Set<String> seen = prefs.getStringSet("seen", new HashSet<>());
            Set<String> next = new HashSet<>();
            long recent = System.currentTimeMillis() - 24 * 60 * 60 * 1000L;
            for (int i = notices.length() - 1; i >= 0; i--) {
                JSONObject notice = notices.getJSONObject(i);
                String id = notice.getString("id");
                next.add(id);
                if (!seen.contains(id) && notice.getLong("created") >= recent) {
                    Intent open = new Intent(context, AgendaActivity.class);
                    open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent tap = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    String content = notice.getString("message");
                    Notification notification = new Notification.Builder(context, CHANNEL)
                        .setSmallIcon(android.R.drawable.ic_popup_reminder)
                        .setContentTitle(notice.getString("title"))
                        .setContentText(content)
                        .setStyle(new Notification.BigTextStyle().bigText(content))
                        .setAutoCancel(true)
                        .setContentIntent(tap)
                        .build();
                    manager.notify(id, 0, notification);
                }
            }
            prefs.edit().putStringSet("seen", next).apply();
        } catch (Exception error) {
            Log.d("Amelia", "No se pudieron consultar los recordatorios.");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
