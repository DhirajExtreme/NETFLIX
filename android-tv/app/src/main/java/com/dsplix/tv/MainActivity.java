package com.dsplix.tv;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.graphics.Color;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView webView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private String serverUrl;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(10, 10, 15));
        setContentView(root);
        serverUrl = getPreferences(MODE_PRIVATE).getString("serverUrl", "");
        if (serverUrl.isEmpty()) showConfig("Enter the laptop address shown by DS PLIX.");
        else showWeb();
    }

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density); }

    private void showConfig(String message) {
        if (webView != null) { webView.destroy(); webView = null; }
        root.removeAllViews();
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(40), dp(35), dp(40), dp(35));
        form.setBackgroundColor(Color.rgb(27, 27, 37));
        TextView title = new TextView(this);
        title.setText("DS PLIX TV"); title.setTextSize(28); title.setTextColor(Color.WHITE);
        form.addView(title);
        TextView help = new TextView(this);
        help.setText(message + "\nExample: http://192.168.1.50:3030");
        help.setTextSize(16); help.setTextColor(Color.LTGRAY);
        form.addView(help);
        EditText input = new EditText(this);
        input.setSingleLine(true); input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY); input.setHint("http://192.168.1.50:3030");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(serverUrl); form.addView(input);
        Button connect = new Button(this);
        connect.setText("Connect to laptop"); form.addView(connect);
        connect.setOnClickListener(v -> {
            try {
                Uri parsed = Uri.parse(input.getText().toString().trim());
                if (!"http".equals(parsed.getScheme()) || parsed.getHost() == null || parsed.getUserInfo() != null) {
                    throw new IllegalArgumentException();
                }
                serverUrl = parsed.buildUpon().path("/").clearQuery().fragment(null).build().toString();
                getPreferences(MODE_PRIVATE).edit().putString("serverUrl", serverUrl).apply();
                showWeb();
            } catch (Exception error) { help.setText("Enter an HTTP address such as http://192.168.1.50:3030"); }
        });
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(620), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        root.addView(form, params);
        input.requestFocus();
    }

    private void showWeb() {
        root.removeAllViews();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(10, 10, 15));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showConfig("Cannot reach the laptop. Check that DS PLIX is running and both devices are on the same network.");
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                fullscreenView = view; fullscreenCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
            }
            @Override public void onHideCustomView() {
                if (fullscreenView != null) root.removeView(fullscreenView);
                fullscreenView = null;
                if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
                fullscreenCallback = null;
            }
        });
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        webView.loadUrl(Uri.parse(serverUrl).buildUpon().appendQueryParameter("tv", "1").build().toString());
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) { showConfig("Change the laptop address."); return true; }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (fullscreenView != null) { webView.getWebChromeClient().onHideCustomView(); return true; }
            if (webView != null) webView.evaluateJavascript(
                "(() => { const ids=['player-overlay','settings-panel','media-detail-modal','search-overlay']; " +
                "const visible=ids.some(id=>!document.getElementById(id)?.classList.contains('hide')); " +
                "if(visible) document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); " +
                "return visible; })()", result -> { if ("false".equals(result)) finish(); });
            else finish();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override protected void onDestroy() {
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
