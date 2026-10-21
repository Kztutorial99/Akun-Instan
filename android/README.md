# Akun Instan — Aplikasi Android (Kotlin native)

Aplikasi pelanggan native (Kotlin + Jetpack Compose) yang memakai API yang sama dengan website `https://akuninstan.com`.

Fitur: login, katalog & beli akun (potong saldo), riwayat pesanan + lihat password akun, top up saldo QRIS (status dicek otomatis), bantuan AI, profil.

## Build
Otomatis lewat GitHub Actions (`.github/workflows/android-apk.yml`) setiap ada perubahan di folder `android/` pada branch `main`.
APK diunggah ke GitHub Releases; link tetap untuk website:
`https://github.com/Kztutorial99/Akun-Instan/releases/latest/download/akun-instan.apk`

## Signing (wajib sebelum rilis ke pelanggan)
Isi GitHub Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Tanpa itu, keystore sementara dibuat tiap build sehingga update APK tidak bisa dipasang di atas versi lama.
