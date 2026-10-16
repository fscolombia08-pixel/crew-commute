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
 *
 * airlineLogos: where the airline logos come from ({code} = airline code, {w} and {h} = size).
 *   It uses the free Aviasales airline-logo service. The logos belong to the airlines.
 *   If a logo can't load, the site shows the airline code instead. Put "" to turn logos off.
 */
window.CREW_CONFIG = {
  apiBase: "https://crew-commute-helper.fscolombia08.workers.dev",
  quickTrips: [
    { from: "DEN", to: "FLL" },
    { from: "DEN", to: "MIA" },
    { from: "FLL", to: "DEN" },
    { from: "MIA", to: "DEN" }
  ],
  hideAirlines: ["NK"],
  airlineLogos: "https://img.wway.io/pics/root/{code}@png?exar=1&rs=fit:{w}:{h}"
};
