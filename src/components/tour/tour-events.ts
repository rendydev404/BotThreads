/** Event pembuka tur (dipancarkan menu profil); dipisah supaya pemancar tidak ikut memuat kode tur. */
export const TOUR_EVENT = "bt:tour";
export const startTour = () => window.dispatchEvent(new Event(TOUR_EVENT));
