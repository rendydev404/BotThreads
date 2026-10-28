import common from "./common";
import layout from "./layout";
import login from "./login";
import accounts from "./accounts";
import dashboard from "./dashboard";
import content from "./content";
import autopilot from "./autopilot";
import radar from "./radar";
import settings from "./settings";
import landing from "./landing";
import landingFilm from "./landing-film";
import autoComment from "./auto-comment";

/** Kamus EN gabungan. Dimuat lewat import dinamis (lihat ../core.ts), jadi tidak ikut bundel pengguna ID. */
const en: Readonly<Record<string, string>> = {
  // Auto Komentar paling awal: kunci yang sudah diterjemahkan modul lain tetap memakai terjemahan modul itu.
  ...autoComment,
  // Halaman publik paling awal: bila kunci bentrok, terjemahan aplikasi (di bawah) yang dipakai.
  ...landingFilm,
  ...landing,
  ...settings,
  ...radar,
  ...autopilot,
  ...content,
  ...dashboard,
  ...accounts,
  ...login,
  ...layout,
  ...common,
};

export default en;
