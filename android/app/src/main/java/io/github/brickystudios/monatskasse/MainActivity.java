package io.github.brickystudios.monatskasse;

import android.content.res.Configuration;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // debug builds carry the debug key, Android would refuse to put a release over them
        if (savedInstanceState == null && !BuildConfig.DEBUG) Updater.check(this);
    }

    // Capacitor fängt den Hell/Dunkel-Wechsel ab (configChanges=uiMode), ohne die Activity neu
    // zu starten. Das Theme greift dann nicht neu, also Status- und Navigationsleiste selbst nachziehen.
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        Window w = getWindow();
        w.setStatusBarColor(getColor(R.color.app_bg));
        w.setNavigationBarColor(getColor(R.color.bar_bg));
        boolean light = getResources().getBoolean(R.bool.light_bars);
        WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(w, w.getDecorView());
        bars.setAppearanceLightStatusBars(light);
        bars.setAppearanceLightNavigationBars(light);
    }
}
