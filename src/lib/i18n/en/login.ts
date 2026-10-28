/** Terjemahan EN untuk halaman masuk, bingkai halaman tanpa sesi, dan hasil hubungkan Threads (OAuth). */
const dict: Record<string, string> = {
  "Masuk untuk melihat performa akun": "Log in to see your account performance",
  "Email atau username": "Email or username",
  Password: "Password",
  "Sembunyikan password": "Hide password",
  "Tampilkan password": "Show password",
  "Caps Lock sedang aktif": "Caps Lock is on",
  "Memeriksa…": "Checking…",
  atau: "or",
  "Masuk atau Daftar dengan Google": "Log in or sign up with Google",
  "Belum punya akun?": "Don't have an account?",
  "Daftar gratis": "Sign up free",
  "Akses hanya untuk anggota yang terdaftar atau diundang.": "Access is limited to registered or invited members.",
  "Kebijakan Privasi": "Privacy Policy",
  "Syarat & Ketentuan": "Terms & Conditions",
  "Kebijakan Refund": "Refund Policy",
  Beranda: "Home",
  "Ke halaman masuk": "Go to login",

  // Galat masuk
  "Login gagal. Coba lagi.": "Login failed. Please try again.",
  "Email/username atau password salah.": "Incorrect email/username or password.",
  "Email/username dan password wajib diisi.": "Email/username and password are required.",
  "Login belum dikonfigurasi di server. Hubungi administrator.": "Login isn't configured on the server. Contact your administrator.",
  "Server sedang bermasalah. Coba lagi sebentar.": "The server is having trouble. Please try again in a moment.",
  "Masuk dengan Google belum diaktifkan: isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET di panel Super Admin > Integrasi atau .env.local.":
    "Google sign-in isn't enabled yet: set GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET in Super Admin > Integrations or .env.local.",
  "Masuk dengan Google gagal atau dibatalkan. Pastikan Authorized Redirect URI di Google Cloud Console sesuai dengan URL callback aplikasi.":
    "Google sign-in failed or was cancelled. Make sure the Authorized Redirect URI in Google Cloud Console matches the app's callback URL.",
  "Google menolak akses. Bila aplikasi Google masih berstatus Testing, email ini harus ditambahkan sebagai Test user di Google Cloud Console.":
    "Google denied access. If the Google app is still in Testing, this email must be added as a Test user in Google Cloud Console.",
  "Akun Google ini belum terdaftar dan pendaftaran mandiri sedang ditutup. Minta admin mengundang email Anda.":
    "This Google account isn't registered and self sign-up is closed. Ask an admin to invite your email.",
  "Undangan itu untuk email lain, atau sudah tidak berlaku. Masuk ke Google dengan email yang diundang.":
    "That invite is for a different email or has expired. Sign in to Google with the invited email.",
  "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.": "Too many attempts. Wait a moment and try again.",

  // Hasil hubungkan Threads (halaman publik /threads-terhubung)
  "Hubungkan Threads": "Connect Threads",
  "Hubungkan akun Threads": "Connect a Threads account",
  "@{username} terhubung": "@{username} connected",
  "Buka dashboard": "Open dashboard",
  "Akun Threads sudah tersimpan di workspace Anda. Kembali ke aplikasi atau browser tempat Anda membuka BotThreads, lalu muat ulang halaman Akun Threads.":
    "The Threads account is saved to your workspace. Go back to the app or browser where you opened BotThreads, then reload the Threads Accounts page.",
  "Akun Threads belum terhubung": "Threads account not connected",
  "Coba lagi dari dashboard": "Try again from the dashboard",
  "Login Threads tidak selesai. Silakan ulangi.": "Threads login didn't finish. Please try again.",
  // Halaman daftar (/daftar)
  "Pendaftaran belum dibuka": "Sign-up is not open yet",
  "Saat ini akun baru dibuat lewat undangan dari pemilik workspace.": "New accounts are currently created through an invitation from a workspace owner.",
  "Buat akun": "Create an account",
  "Satu akun, satu workspace untuk brand Anda.": "One account, one workspace for your brand.",
  "Login Google belum dikonfigurasi. Masukkan Google Client ID & Secret di Dashboard Super Admin (tab Integrasi & API Keys) atau file .env.local.":
    "Google login isn't configured yet. Enter the Google Client ID & Secret in the Super Admin Dashboard (Integrations & API Keys tab) or the .env.local file.",
  "Pendaftaran dengan Google dibatalkan.": "Sign-up with Google was cancelled.",
  "Sesi pendaftaran Google berakhir. Silakan klik Daftar dengan Google sekali lagi.": "The Google sign-up session expired. Please click Sign up with Google again.",
  "Tidak bisa terhubung ke Google saat ini. Coba lagi sebentar.": "Can't connect to Google right now. Please try again shortly.",
  "Email akun Google ini belum terverifikasi oleh Google.": "This Google account's email hasn't been verified by Google.",
  "Akun ini telah dinonaktifkan oleh pengelola platform.": "This account has been deactivated by the platform administrator.",
  "Nama brand minimal 2 karakter.": "Brand name must be at least 2 characters.",
  "3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.": "3-32 characters: lowercase letters, numbers, dots, underscores, or hyphens.",
  "Gagal mendaftar. Coba lagi.": "Sign-up failed. Please try again.",
  "Daftar dengan Google": "Sign up with Google",
  "atau isi sendiri": "or fill it in yourself",
  "Dipakai AI untuk menulis dengan suara brand Anda.": "Used by the AI to write in your brand's voice.",
  "Nama Anda (opsional)": "Your name (optional)",
  "Membuat akun...": "Creating account...",
  "Daftar dan mulai": "Sign up and start",
  "Dengan mendaftar, Anda menyetujui": "By signing up, you agree to the",
  serta: "and",
  " kami.": ".",
  "Sudah punya akun?": "Already have an account?",
};

export default dict;
