package com.sandeeplab.deltapaper;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private WebView webView;
    private final ExecutorService network = Executors.newSingleThreadExecutor();

    private final class MarketDataBridge {
        @JavascriptInterface
        public void fetchTickers(final String symbols) {
            if (symbols == null || !symbols.matches("[A-Z0-9,-]{1,100}")) {
                deliver(new JSONObjectSafe(false, 0, "", "Invalid symbol request").json);
                return;
            }
            network.execute(() -> {
                HttpURLConnection connection = null;
                try {
                    URL url = new URL("https://api.india.delta.exchange/v2/tickers/" + symbols);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setRequestMethod("GET");
                    connection.setConnectTimeout(6500);
                    connection.setReadTimeout(6500);
                    connection.setUseCaches(false);
                    connection.setRequestProperty("Accept", "application/json");
                    connection.setRequestProperty("User-Agent", "DeltaPaperLab/0.2 Android");
                    int status = connection.getResponseCode();
                    InputStream stream = status >= 200 && status < 400
                        ? connection.getInputStream() : connection.getErrorStream();
                    String body = readAll(stream);
                    deliver(new JSONObjectSafe(status >= 200 && status < 300, status, body,
                        status >= 200 && status < 300 ? "" : "HTTP " + status).json);
                } catch (Exception e) {
                    deliver(new JSONObjectSafe(false, 0, "",
                        "Network error: " + (e.getMessage() == null ? "request failed" : e.getMessage())).json);
                } finally {
                    if (connection != null) connection.disconnect();
                }
            });
        }
    }

    private static final class JSONObjectSafe {
        final String json;
        JSONObjectSafe(boolean ok, int status, String body, String error) {
            JSONObject obj = new JSONObject();
            try {
                obj.put("ok", ok);
                obj.put("status", status);
                obj.put("body", body);
                obj.put("error", error);
                obj.put("receivedAt", System.currentTimeMillis());
            } catch (Exception ignored) { }
            json = obj.toString();
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        } finally {
            stream.close();
        }
        return result.toString();
    }

    private void deliver(String payload) {
        runOnUiThread(() -> {
            if (webView == null) return;
            String quoted = JSONObject.quote(payload);
            webView.evaluateJavascript("window.onNativeMarketData && window.onNativeMarketData(" + quoted + ")", null);
        });
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(9, 13, 18));
        getWindow().setNavigationBarColor(Color.rgb(9, 13, 18));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 13, 18));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new MarketDataBridge(), "MarketDataBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !url.startsWith("file:///android_asset/");
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("MarketDataBridge");
            webView.destroy();
            webView = null;
        }
        network.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
