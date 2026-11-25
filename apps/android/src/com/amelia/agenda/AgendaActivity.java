package com.amelia.agenda;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.net.URI;

public final class AgendaActivity extends Activity {
    private final Handler handler = new Handler(android.os.Looper.getMainLooper());
    private WebView web;
    private String server;
    private ValueCallback<Uri[]> fileResult;
    private final Runnable check = () -> ReminderJob.check(this, () -> handler.postDelayed(this::checkNow, 12000));

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        server = ReminderJob.preferences(this).getString("server", "");
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.rgb(251,248,245));
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bounds = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                view.setPadding(bounds.left, bounds.top, bounds.right, bounds.bottom);
            }
            return insets;
        });
        getWindow().setStatusBarColor(Color.rgb(251,248,245));
        getWindow().setNavigationBarColor(Color.rgb(251,248,245));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);
        Button settings = new Button(this, null, android.R.attr.borderlessButtonStyle);
        settings.setText("Conexión");
        settings.setTextColor(Color.rgb(113,55,72));
        settings.setAllCaps(false);
        settings.setOnClickListener(view -> settings());
        bar.addView(settings);
        layout.addView(bar);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " AmeliaNativeAndroid/1.0");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) && origin(uri.toString()).equals(server)) return false;
                if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException error) { Toast.makeText(AgendaActivity.this, "No hay navegador disponible.", Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileResult != null) fileResult.onReceiveValue(null);
                fileResult = callback;
                try { startActivityForResult(params.createIntent(), 70); return true; }
                catch (ActivityNotFoundException error) { fileResult = null; return false; }
            }
        });
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        if (server.isEmpty()) settings(); else web.loadUrl(server);
        ReminderJob.schedule(this);
    }

    static String origin(String value) {
        try {
            URI uri = URI.create(value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) return "";
            return new URI("https", null, uri.getHost().toLowerCase(java.util.Locale.ROOT),
                uri.getPort() == 443 ? -1 : uri.getPort(), null, null, null).toString();
        } catch (Exception error) { return ""; }
    }

    private void settings() {
        EditText input = new EditText(this);
        input.setSingleLine();
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("https://tu-servidor");
        input.setText(server);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (22 * getResources().getDisplayMetrics().density);
        content.setPadding(padding, 0, padding, 0);
        TextView help = new TextView(this);
        help.setText("Usa la misma dirección en Android y Windows para compartir tu agenda.");
        content.addView(help);
        content.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Conectar Amelia").setView(content)
            .setNegativeButton("Cancelar", null).setNeutralButton("Avisos", (window, button) -> requestNotices())
            .setPositiveButton("Conectar", null).create();
        dialog.setOnShowListener(window -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            String value = origin(input.getText().toString());
            if (value.isEmpty()) { input.setError("Escribe una dirección HTTPS válida."); return; }
            if (!value.equals(server)) {
                server = value;
                ReminderJob.preferences(this).edit().putString("server", server).remove("seen").apply();
                web.loadUrl(server);
            }
            dialog.dismiss();
            requestNotices();
        }));
        dialog.show();
    }

    private void requestNotices() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (ReminderJob.preferences(this).getBoolean("asked-notifications", false) &&
                !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
                startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName()));
                return;
            }
            ReminderJob.preferences(this).edit().putBoolean("asked-notifications", true).apply();
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 18);
        } else Toast.makeText(this, "Los avisos se consultan también en segundo plano.", Toast.LENGTH_SHORT).show();
    }

    private boolean active;
    private void checkNow() { if (active) check.run(); }
    @Override protected void onResume() { super.onResume(); active = true; checkNow(); }
    @Override protected void onPause() { active = false; handler.removeCallbacksAndMessages(null); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == 70 && fileResult != null) {
            fileResult.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileResult = null;
        }
    }
}
