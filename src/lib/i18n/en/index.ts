import common from "./common";
import layout from "./layout";
import login from "./login";
import accounts from "./accounts";
import dashboard from "./dashboard";
import content from "./content";
import autopilot from "./autopilot";
import radar from "./radar";
import settings from "./settings";

/** Kamus EN gabungan. Dimuat lewat import dinamis (lihat ../core.ts), jadi tidak ikut bundel pengguna ID. */
const en: Readonly<Record<string, string>> = {
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
