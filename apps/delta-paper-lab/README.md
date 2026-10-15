# Delta Paper Lab
Independent Android paper-trading prototype inspired by Delta Exchange India. Not affiliated with Delta Exchange.

GitHub Actions builds a debug APK. Open Actions → Build Delta Paper Lab APK → latest successful run → download `delta-paper-lab-debug-apk`.

Uses Java 17, Android SDK Platform 35, Android Gradle Plugin 8.7.3 and Gradle 8.9. Manual build from this folder: `gradle assembleDebug`.

All orders are local simulations only. Public market-data endpoints are attempted but must be verified on-device. Sample candles are labelled when historical data is unavailable. P&L and margin are simplified educational estimates, not exchange-accurate calculations.
