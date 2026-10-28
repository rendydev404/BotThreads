/** Terjemahan EN untuk animasi halaman perkenalan: film demo, animasi robot di meja, intro judul, dan contoh posting persona. */
const dict: Record<string, string> = {
  // Contoh posting persona (personas.ts) dan asal idenya
  "jam 11 tuh jam paling rawan. belum laper-laper amat, tapi udah buka aplikasi pesen makan tiap 5 menit 🫠":
    "11am is the danger zone. not really hungry yet, but somehow opening the food delivery app every 5 minutes 🫠",
  "tim saus dipisah apa tim langsung disiram? jawab jujur, ini nentuin kita bisa temenan apa nggak":
    "team sauce on the side or team sauce poured on? answer honestly, this decides if we can be friends",
  "tanggal 25, dompet senyum lagi. yang kemarin ngomong mau hemat, malem ini traktir siapa nih?":
    "the 25th, wallets are smiling again. you said you'd save money yesterday, so who are you treating tonight?",
  "senin itu bukan soal semangat. senin itu soal siapa yang nyampe kantor duluan dan kebagian kopi yang masih panas":
    "monday isn't about motivation. monday is about who gets to the office first and grabs the coffee while it's still hot",
  "kopi susu gula aren udah 5 tahun dibilang tren sesaat. ya tetep di sini, tetep dipesen, tetep enak 🤷":
    "palm sugar iced latte has been called a passing trend for 5 years. still here, still ordered, still delicious 🤷",
  "jam 3 sore: mata berat, kerjaan numpuk, gelas kedua mulai kedengeran masuk akal":
    "3pm: heavy eyes, work piling up, and a second cup is starting to sound reasonable",
  "baju yang paling sering dipake tuh bukan yang paling mahal. tapi yang gak perlu disetrika. setuju gak?":
    "the clothes you wear most aren't the priciest ones. they're the ones that don't need ironing. agree?",
  "outfit kondangan bulan ini udah 3x sama. solusinya bukan beli baju baru, tapi ganti circle. bercanda. dikit.":
    "wore the same wedding-guest outfit 3 times this month. the fix isn't new clothes, it's a new circle. kidding. mostly.",
  "malem minggu, keranjang penuh, saldo bilang sabar dulu. kira-kira siapa yang menang malem ini? 😭":
    "saturday night, cart is full, bank balance says be patient. who wins tonight? 😭",
  "skincare paling mahal itu yang udah dibeli tapi gak pernah dipake. yang paling murah? tidur cukup. dua-duanya penting sih":
    "the most expensive skincare is the one you bought and never used. the cheapest? enough sleep. both matter tbh",
  "siang ini panasnya gak ngotak ☀️ sunscreen udah di-reapply belum? apa masih ngandelin yang tadi pagi jam 7":
    "the heat today is unreal ☀️ reapplied your sunscreen yet? or still counting on the 7am layer",
  "tim cuci muka 2x apa tim sekali aja cukup? kolom komen dibuka, silakan membela diri":
    "team double cleanse or team once is enough? comments are open, defend yourselves",
  "jujur ya, {biz} yang bagus tuh kerasa dari hal-hal kecil yang gak pernah dipamerin":
    "honestly, good {biz} shows in the little things nobody brags about",
  "tanggal muda, rencana banyak. kalo hari ini cuma boleh pilih satu, {biz} masuk list gak? 👀":
    "fresh paycheck, lots of plans. if you could only pick one thing today, would {biz} make the list? 👀",
  "pertanyaan serius nih: kalian pilih {biz} karena harganya, karena kata temen, atau karena udah terlanjur cocok?":
    "serious question: do you choose {biz} for the price, a friend's recommendation, or because it just clicks?",
  "bisnis Anda": "your business",
  "Jam makan siang": "Lunchtime",
  "Posting terbaik minggu lalu": "Last week's best post",
  "Momen gajian": "Payday moment",
  "Momen awal pekan": "Start-of-week moment",
  "Momen akhir pekan": "Weekend moment",
  "Tren pencarian": "Search trends",
  "Tren cuaca": "Weather trend",
  "Jam ramai akun ini": "This account's peak hour",

  // Film demo "satu hari autopilot" (film/autopilot-film.tsx)
  "Satu hari kerja tim konten.": "A content team's whole workday.",
  "Dikerjakan autopilot, sendiri.": "Done by autopilot, on its own.",
  "menghubungkan @kedai.sore": "connecting @kedai.sore",
  "memuat Pengetahuan brand": "loading brand Knowledge",
  "membaca jam ramai 30 hari": "reading 30 days of peak hours",
  "autopilot siap": "autopilot ready",
  "06.00 · TREN DIPANTAU": "06.00 · WATCHING TRENDS",
  "Mencari bahan dari 4 sumber.": "Finding material from 4 sources.",
  "“gajian tanggal 25”": "“payday on the 25th”",
  "Posting terbaik Anda": "Your best posts",
  "“tim saus dipisah”": "“team sauce on the side”",
  "48rb views": "48K views",
  "Kalender momen": "Moment calendar",
  "Jumat gajian": "Payday Friday",
  "H-0": "D-DAY",
  "Catatan Anda": "Your notes",
  "Menu baru: sambal matah": "New menu: sambal matah",
  "IDE DINILAI": "IDEAS SCORED",
  "gajian dateng, siapa yang ditraktir malem ini?": "payday's here, who's getting treated tonight?",
  "debat abadi: saus dipisah apa disiram": "the eternal debate: sauce on the side or poured on",
  "sambal matah baru, pedesnya level berapa?": "new sambal matah, how spicy do you go?",
  "10.42 · DRAF DITULIS": "10.42 · DRAFT WRITTEN",
  "AI menulis dengan suara brand Anda.": "AI writes in your brand's voice.",
  "tanggal 25, dompet senyum lagi 😌 yang kemarin ngomong mau hemat, malem ini traktir siapa nih? sambal matah baru udah nungguin":
    "the 25th, wallets are smiling again 😌 you said you'd save money yesterday, so who are you treating tonight? the new sambal matah is waiting",
  "SUARA BRAND": "BRAND VOICE",
  "santai, jenaka": "relaxed, witty",
  BAHAN: "SOURCE",
  "Momen gajian + menu baru": "Payday moment + new menu",
  "JAM TAYANG": "POSTING TIME",
  "12.12 · jam makan siang": "12.12 · lunchtime",
  "draf · menulis…": "draft · writing…",
  "{n} karakter · tanpa harga yang tidak ada di Pengetahuan": "{n} characters · no prices that aren't in Knowledge",
  "10.44 · DRAF DIPERIKSA": "10.44 · DRAFT CHECKED",
  "Tidak semua draf boleh terbit.": "Not every draft gets to go live.",
  "Bentuk & panjang tulisan": "Format & length",
  "Harga & promo sesuai Pengetahuan": "Prices & promos match Knowledge",
  "Bebas topik terlarang": "No banned topics",
  "Tidak kembar dengan akun lain": "Not a twin of another account's post",
  MEMERIKSA: "CHECKING",
  LOLOS: "PASSED",
  "2 draf lain hari ini ditolak dan ditulis ulang": "2 other drafts today were rejected and rewritten",
  "SKOR EDITOR AI": "AI EDITOR SCORE",
  "LOLOS · MASUK ANTREAN": "PASSED · QUEUED",
  "10.45 · ANTRE DI JAM RAMAI": "10.45 · QUEUED AT PEAK HOURS",
  "Jam tayang dihitung, bukan ditebak.": "Posting times are calculated, not guessed.",
  "RATA-RATA VIEWS PER JAM · 30 HARI": "AVERAGE VIEWS PER HOUR · 30 DAYS",
  "JEDA MIN. 2,5 JAM": "MIN. GAP 2.5 HRS",
  "ANTREAN HARI INI": "TODAY'S QUEUE",
  "draf gajian · lolos": "payday draft · passed",
  "ditulis 90 mnt sebelumnya": "written 90 min before",
  "12.12 · TERBIT DI THREADS": "12.12 · LIVE ON THREADS",
  "Tepat di jamnya. Lalu dipelajari.": "Right on time. Then learned from.",
  "12.12 · baru saja · lewat API resmi Threads": "12.12 · just now · via the official Threads API",
  "VIEWS SEJAK TERBIT": "VIEWS SINCE POSTING",
  "3,4× di atas rata-rata akun": "3.4× above the account's average",
  "ide lanjutan dibuat untuk besok": "follow-up idea created for tomorrow",
  "Threads Anda posting sendiri,": "Your Threads posts on its own,",
  "MEMUAT DEMO AUTOPILOT": "LOADING AUTOPILOT DEMO",
  "MATIKAN SUARA": "MUTE SOUND",
  "NYALAKAN SUARA": "TURN ON SOUND",

  // Animasi robot di meja (hero-film/autopilot-desk.tsx, desk-section.tsx)
  "MENYALAKAN AUTOPILOT…": "STARTING AUTOPILOT…",
  "Animasi: robot tertidur di meja sementara akun Threads di monitornya menulis, memeriksa, dan menerbitkan posting sendiri, lalu suka dan balasan berdatangan.":
    "Animation: a robot sleeps at its desk while the Threads account on its monitor writes, checks, and publishes posts by itself, then likes and replies start coming in.",
  "baru saja": "just now",
  "lolos cek aturan · skor 0,87": "passed rule checks · score 0.87",
  "AI menulis…": "AI is writing…",
  "menunggu jam tayang": "waiting for posting time",
  "Mulai utas baru…": "Start a thread…",
  "Posting@@tombol": "Post",
  "+38 suka": "+38 likes",
  "rina.ayu membalas": "rina.ayu replied",
  "+1,2rb views": "+1.2K views",
  "3 balasan baru": "3 new replies",
  "+52 suka": "+52 likes",
  "diposting ulang": "reposted",
  "+3,4rb views": "+3.4K views",
  "+71 suka": "+71 likes",
  "dimas.p membalas": "dimas.p replied",
  "pemilik lagi tidur": "owner is asleep",
  "THREADS TETAP JALAN": "THREADS KEEPS RUNNING",
};

export default dict;
