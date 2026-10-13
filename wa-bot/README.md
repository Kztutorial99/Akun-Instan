# Bot WhatsApp Akun Instan

Bot WhatsApp yang membalas pembeli pakai AI toko. Dikontrol dari Admin Panel → **Bot WhatsApp**.

## Pasang di Railway
1. Railway → New Project → Deploy from GitHub → pilih repo ini, **Root Directory: `wa-bot`**.
2. Tambah **Volume**, mount path `/data`.
3. Variables:
   - `BOT_API_TOKEN` = token acak panjang (sama dengan `WA_BOT_TOKEN` di Vercel)
   - `AUTH_DIR` = `/data/auth`
   - `STORE_URL` = `https://akuninstan.com`
4. Settings → Networking → Generate Domain. Salin URL-nya ke Vercel sebagai `WA_BOT_URL`.
5. Buka Admin Panel → Bot WhatsApp → isi nomor → masukkan pairing code di WhatsApp
   (Perangkat tertaut → Tautkan dengan nomor telepon).
