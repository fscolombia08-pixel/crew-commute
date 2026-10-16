/*
 * Crew Commute settings.
 *
 * apiBase: the address of your Cloudflare helper. It is not a secret.
 *   The group code and the flight-data key stay in Cloudflare.
 *   Leave it empty ("") to run the site in demo mode (made-up flights).
 *
 * quickTrips: one-tap searches shown to everyone at the top of the search box.
 *
 * hideAirlines: airlines never shown in results (Spirit, NK, stopped flying in May 2026).
 */
window.CREW_CONFIG = {
  apiBase: "https://crew-commute-helper.fscolombia08.workers.dev",
  quickTrips: [
    { from: "DEN", to: "FLL" },
    { from: "DEN", to: "MIA" },
    { from: "FLL", to: "DEN" },
    { from: "MIA", to: "DEN" }
  ],
  hideAirlines: ["NK"]
};
