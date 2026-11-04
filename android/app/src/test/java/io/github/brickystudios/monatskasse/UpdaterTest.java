package io.github.brickystudios.monatskasse;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdaterTest {

    @Test
    public void comparesVersionsAsNumbers() {
        assertTrue(Updater.isNewer("v1.10.0", "1.9.2"));
        assertTrue(Updater.isNewer("v2.0", "1.9.9"));
        assertTrue(Updater.isNewer("v1.2.0.1", "1.2.0"));
        assertFalse(Updater.isNewer("v1.2.0", "1.2.0"));
        assertFalse(Updater.isNewer("v1.1.0", "1.2.0"));
        assertFalse(Updater.isNewer("v1.2", "1.2.0"));
    }

    private static String json(String url, String name) {
        return "{\"tag_name\":\"v1.3.0\",\"assets\":[{\"name\":\"notes.txt\",\"browser_download_url\":\"x\"},"
                + "{\"name\":\"" + name + "\",\"browser_download_url\":\"" + url + "\",\"size\":45000000}]}";
    }

    @Test
    public void readsTheApkFromGithubsAnswer() {
        String url = Updater.DOWNLOADS + "v1.3.0/Monatskasse.apk";
        Updater.Release r = Updater.parse(json(url, "Monatskasse.apk"));
        assertEquals("1.3.0", r.version);
        assertEquals(url, r.url);
        assertEquals(45_000_000L, r.bytes);
    }

    @Test
    public void ignoresForeignDownloadsAndBrokenAnswers() {
        assertNull(Updater.parse(json("https://evil.example/Monatskasse.apk", "Monatskasse.apk")));
        assertNull(Updater.parse(json(Updater.DOWNLOADS + "v1.3.0/x.apk", "x.apk")));
        assertNull(Updater.parse("{\"message\":\"API rate limit exceeded\"}"));
        assertNull(Updater.parse("<html>"));
    }
}
