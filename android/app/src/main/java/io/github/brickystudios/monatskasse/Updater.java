package io.github.brickystudios.monatskasse;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.Button;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.Scanner;
import org.json.JSONArray;
import org.json.JSONObject;

/** Updates the app from GitHub Releases: ask for the latest tag, download Monatskasse.apk, hand it to Android's installer. */
final class Updater {

    static final String LATEST = "https://api.github.com/repos/BrickyStudios/monatskasse/releases/latest";
    static final String DOWNLOADS = "https://github.com/BrickyStudios/monatskasse/releases/download/";

    /** version without "v", the APK's URL and its size in bytes */
    static final class Release {
        final String version, url;
        final long bytes;
        Release(String version, String url, long bytes) { this.version = version; this.url = url; this.bytes = bytes; }
    }

    /** "v1.10.0" is newer than "1.9.2". */
    static boolean isNewer(String tag, String current) {
        int[] a = parts(tag), b = parts(current);
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int d = (i < a.length ? a[i] : 0) - (i < b.length ? b[i] : 0);
            if (d != 0) return d > 0;
        }
        return false;
    }

    private static int[] parts(String v) {
        String[] s = v.trim().replaceFirst("^v", "").split("\\.");
        int[] out = new int[s.length];
        for (int i = 0; i < s.length; i++) {
            String digits = s[i].replaceFirst("\\D.*$", "");
            out[i] = digits.isEmpty() ? 0 : Integer.parseInt(digits);
        }
        return out;
    }

    /** Reads GitHub's answer. Only an APK from this repo's own release downloads counts. */
    static Release parse(String json) {
        try {
            JSONObject r = new JSONObject(json);
            String tag = r.optString("tag_name", "");
            JSONArray assets = r.optJSONArray("assets");
            if (tag.isEmpty() || assets == null) return null;
            for (int i = 0; i < assets.length(); i++) {
                JSONObject a = assets.getJSONObject(i);
                String url = a.optString("browser_download_url", "");
                if ("Monatskasse.apk".equals(a.optString("name")) && url.startsWith(DOWNLOADS))
                    return new Release(tag.replaceFirst("^v", ""), url, a.optLong("size", 0));
            }
        } catch (Exception ignored) { }
        return null;
    }

    private static HttpURLConnection open(String url, int readTimeout) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(readTimeout);
        return c;
    }

    /** Asks GitHub in the background; shows the dialog only when something newer is out. Silent without network. */
    static void check(Activity a) {
        File apk = new File(a.getCacheDir(), "updates/Monatskasse.apk");
        new Thread(() -> {
            deleteDir(apk.getParentFile()); // the APK from the last update
            try {
                HttpURLConnection c = open(LATEST, 10_000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                String body;
                try (InputStream in = c.getInputStream(); Scanner s = new Scanner(in, "UTF-8").useDelimiter("\\A")) {
                    body = s.hasNext() ? s.next() : "";
                }
                Release r = parse(body);
                if (r != null && isNewer(r.version, BuildConfig.VERSION_NAME))
                    a.runOnUiThread(() -> { if (!a.isFinishing()) show(a, r, apk); });
            } catch (Exception ignored) { }
        }).start();
    }

    private static void show(Activity a, Release r, File apk) {
        String mb = String.format(Locale.GERMANY, "%.0f MB", r.bytes / 1_000_000.0);
        String intro = "Du hast " + BuildConfig.VERSION_NAME + ". Das Update lädt " + mb + " von GitHub. Deine Ausgaben bleiben erhalten.";
        // the first update leads through Android's "install unknown apps" screen; say so before it shows up
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls())
            intro += "\n\nBeim ersten Mal fragt Android, ob Monatskasse Apps installieren darf. Erlauben, dann zurück.";
        String text = intro;
        AlertDialog d = new AlertDialog.Builder(a)
                .setTitle("Monatskasse " + r.version + " ist da")
                .setMessage(text)
                .setPositiveButton("Installieren", null) // set below, so the tap doesn't close the dialog
                .setNegativeButton("Später", null)
                .create();
        d.setOnShowListener(x -> {
            Button install = d.getButton(AlertDialog.BUTTON_POSITIVE);
            Button later = d.getButton(AlertDialog.BUTTON_NEGATIVE);
            install.setOnClickListener(v -> {
                if (apk.exists()) { installApk(a, apk); return; } // installer was cancelled: no second download
                install.setEnabled(false);
                later.setEnabled(false);
                d.setCancelable(false);
                d.setMessage("Lädt … 0 %");
                new Thread(() -> {
                    boolean ok;
                    try {
                        download(r.url, apk, p -> a.runOnUiThread(() -> d.setMessage("Lädt … " + p + " %")));
                        ok = true;
                    } catch (Exception e) {
                        ok = false;
                    }
                    boolean done = ok;
                    a.runOnUiThread(() -> {
                        install.setEnabled(true);
                        later.setEnabled(true);
                        d.setCancelable(true);
                        install.setText(done ? "Installieren" : "Nochmal");
                        d.setMessage(done ? text : "Download hat nicht geklappt. Prüf die Verbindung und versuch es nochmal.");
                        if (done) installApk(a, apk);
                    });
                }).start();
            });
        });
        d.show();
    }

    interface Progress { void percent(int p); }

    /** Downloads into a .part file first, so a broken download never looks like a finished APK. */
    static void download(String url, File target, Progress progress) throws IOException {
        HttpURLConnection c = open(url, 30_000);
        long total = c.getContentLengthLong(), done = 0;
        File part = new File(target.getPath() + ".part");
        target.getParentFile().mkdirs();
        int last = -1;
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
            byte[] buf = new byte[64 * 1024];
            for (int n; (n = in.read(buf)) >= 0; ) {
                out.write(buf, 0, n);
                done += n;
                int p = total > 0 ? (int) (done * 100 / total) : 0;
                if (p != last) { progress.percent(p); last = p; }
            }
        }
        if (total > 0 && done != total) throw new IOException("download cut off at " + done + " of " + total + " bytes");
        if (!part.renameTo(target)) throw new IOException("could not move " + part.getName());
    }

    /** Android checks the signature: only an APK signed with the Monatskasse release key replaces the app. */
    private static void installApk(Activity a, File apk) {
        Uri uri = FileProvider.getUriForFile(a, a.getPackageName() + ".fileprovider", apk);
        a.startActivity(new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
    }

    private static void deleteDir(File dir) {
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) f.delete();
        dir.delete();
    }
}
