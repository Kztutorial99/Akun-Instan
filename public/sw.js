/* Service worker minimal agar browser mengizinkan "Install aplikasi".
   Tidak menyimpan cache apa pun: semua permintaan langsung ke jaringan. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
