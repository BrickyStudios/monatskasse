# Monatskasse — Design

v1.0 genehmigt 03.11.2026, v1.1 (Features + Apple-Design) am selben Tag.

## Zweck
Wer ein festes Monatsbudget hat (Taschengeld, Standard 225 €), schreibt seine Ausgaben mit, fotografiert
Kassenbons, übernimmt Posten daraus und sieht, wie viel noch da ist. Excel-Export als
Nachweis.

## Nicht-Ziele
- Kein Server, kein Login, **kein Sync** zwischen Handys (so entschieden).
- Kein Übertrag von Restgeld in den Folgemonat.
- Keine eigene iOS-App. iPhone-Nutzer nehmen die Web-App (dieselben Dateien aus `www/` mit Service Worker).

## Verhalten
- **Erster Start:** Ist noch nichts gespeichert, fragt die Übersicht nach dem Monatsbudget statt 225 € anzunehmen
  (`firstRun` in app.js). Wer gleich eine Ausgabe einträgt, behält 225 € bis zur Änderung in den Einstellungen.
- **Selbst-Update (nur Android-Release):** `Updater.java` fragt beim Start die GitHub-API nach dem neuesten Release,
  nimmt nur `Monatskasse.apk` aus `github.com/BrickyStudios/monatskasse/releases/download/`, lädt nach
  `cache/updates/` und übergibt an den Paketinstaller. Android prüft die Signatur. Debug-Builds prüfen nicht.
- **Immer aktueller Monat:** beim Start, bei Rückkehr in die App (`App.resume`,
  `visibilitychange`) und beim Tageswechsel (30-s-Takt). Zurückblättern geht, ein Chip
  „Zurück zu <Monat>" erscheint dann. Blättern endet beim ältesten Monat mit Daten
  bzw. beim aktuellen (keine leeren Sackgassen).
- **Budget-Historie:** `settings.allowanceHist` = `{ "YYYY-MM": cent }`. Beim ersten
  Ändern wird das alte Budget unter `0000-00` festgehalten, damit alte Monate korrekt
  bleiben.
- **Tempo-Hinweis:** Rest ÷ verbleibende Tage inkl. heute.
- **Löschen:** sofort, mit 5 s „Rückgängig" statt Nachfrage. Bestätigungsdialoge nur
  für Unumkehrbares (Alles löschen, Backup laden).
- **Belegfotos:** IndexedDB, Schlüssel `r_<id>`. Mehrere OCR-Posten teilen ein Foto.
  Verwaiste Fotos räumt der Start auf.
- **Backup:** JSON mit `app: "monatskasse"`, Ausgaben, Einstellungen, Fotos als data-URL.
  Laden prüft jedes Feld (Vertrauensgrenze), schreibt erst Fotos, dann Daten, damit ein
  Abbruch nichts zerstört.

## Design (nach Apples Prinzipien)
- **Systemschrift**, größenabhängiges Tracking: große Zahl −0,04 em, Text ~0.
- **Gruppierte Listen** im iOS-Stil, eingerückte Trennlinien, Ausgaben nach Tagen.
- **Durchscheinende Leisten** (blur + saturate); Trennlinie oben erst beim Scrollen.
- **Sheets:** Federphysik (Dämpfung/Response statt Dauer), 1:1 am Griff ziehen,
  Wisch-Schwung wird projiziert (Apple-Formel, d = 0,998), weicher Widerstand nach oben,
  jederzeit unterbrechbar. Federung nur bei Schwung.
- **Feedback beim Drücken** (`:active` ohne Verzögerung), Haptik nur bei Sichern,
  Löschen, Wegwischen.
- **Kategoriefarben** nach Reihenfolge der ersten Nutzung (bis 10 ohne Doppelung),
  Rot zuletzt, weil Rot „überzogen" bedeutet.
- `prefers-reduced-motion`, `-transparency`, `-contrast` werden beachtet.
- **Icon:** Hosentasche mit Münze (*Taschen*geld), adaptiv + monochrom.

## Android-Eigenheiten (nicht offensichtlich)
- Capacitor 7 braucht **JDK 21**; Plugins auf `~7.0.0` gepinnt.
- **Zurück-Taste:** ohne `@capacitor/app` beendet sie die App auch mit offenem Sheet.
  Jetzt: Tastatur → oberstes Sheet → Tab → App minimieren.
- **Edge-to-Edge:** Capacitor 7.0 kann es nicht; `windowOptOutEdgeToEdgeEnforcement`
  im Theme, sonst liegt die App ab Android 15 unter der Statusleiste.
- **Hell/Dunkel:** Capacitor fängt `uiMode` ab, das Theme greift nicht neu.
  `MainActivity.onConfigurationChanged` färbt die Leisten selbst nach.
- **OCR:** AGP entpackt `.gz`-Assets → Sprachdatei liegt als `deu.traineddata`,
  `gzip: false`, absolute Pfade (relativ bricht im Worker), `cacheMethod: "none"`
  (sonst 15 MB doppelt in IndexedDB).
- **Tastatur:** `adjustResize`, damit das Sheet über der Tastatur sitzt.

## Verifiziert (Emulator Pixel 7, Android 14)
Wisch zum Schließen + Zurückfedern, Zurück-Taste-Kette, Auto-Monat nach Hintergrund,
Löschen/Rückgängig, OCR über den echten Foto-Weg (5/5 Posten), Excel (LibreOffice zeigt
03.09.2026 und 12,50 €), Backup-Rundreise (13 Ausgaben, 2 Fotos, Summe identisch),
fremde Datei abgewiesen, Budgetwechsel lässt alte Monate unverändert,
Hell/Dunkel-Wechsel zur Laufzeit inkl. Statusleiste, Update von v1.0 behält Daten.
