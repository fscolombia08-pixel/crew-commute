/*
 * Crew Commute settings.
 *
 * apiBase: the address of your Cloudflare helper, for example
 *   "https://crew-commute-helper.yourname.workers.dev"
 *   Leave it empty to run the site in demo mode (made-up flights).
 *   This address is not a secret. The group code and data key stay in Cloudflare.
 *
 * quickTrips: one-tap searches shown to everyone at the top of the search box.
 */
window.CREW_CONFIG = {
  apiBase: "",
  quickTrips: [
    { from: "DEN", to: "FLL" },
    { from: "DEN", to: "MIA" },
    { from: "FLL", to: "DEN" },
    { from: "MIA", to: "DEN" }
  ]
};
