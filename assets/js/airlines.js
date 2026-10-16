/* Crew Commute: airline names, operators (from ATC call signs) and aircraft facts. */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var L = CC.airlines = {};

  /* Marketing airlines (IATA code -> name). */
  L.NAMES = {
    AA: 'American', UA: 'United', DL: 'Delta', WN: 'Southwest', B6: 'JetBlue', AS: 'Alaska',
    HA: 'Hawaiian', F9: 'Frontier', NK: 'Spirit', G4: 'Allegiant', SY: 'Sun Country', MX: 'Breeze',
    XP: 'Avelo', '9K': 'Cape Air', '9X': 'Southern Airways Express', LF: 'Contour', '7H': 'Ravn Alaska',
    '4B': 'Boutique Air', KS: 'PenAir', '3M': 'Silver Airways', MW: 'Mokulele', BB: 'Seaborne',
    OO: 'SkyWest', YX: 'Republic', MQ: 'Envoy', OH: 'PSA', PT: 'Piedmont', '9E': 'Endeavor',
    YV: 'Mesa', G7: 'GoJet', QX: 'Horizon', ZW: 'Air Wisconsin', C5: 'CommutAir', CP: 'Compass',
    GQ: 'Big Sky', '8V': 'Wright Air Service', Z3: 'Grant Aviation', DH: 'Star Marianas',
    AC: 'Air Canada', BA: 'British Airways', IB: 'Iberia', QR: 'Qatar', JL: 'JAL', NH: 'ANA',
    AF: 'Air France', KL: 'KLM', VS: 'Virgin Atlantic', LH: 'Lufthansa', AM: 'Aeromexico',
    KE: 'Korean Air', EI: 'Aer Lingus', AY: 'Finnair', CM: 'Copa', LA: 'LATAM', AV: 'Avianca',
    EK: 'Emirates', EY: 'Etihad', TK: 'Turkish', QF: 'Qantas', NZ: 'Air New Zealand', FI: 'Icelandair',
    WS: 'WestJet', VX: 'Virgin America', '2E': 'Smokies Air'
  };

  /* ATC call-sign prefix (ICAO) -> { iata of the operating carrier, display name }. */
  L.OPERATORS = {
    AAL: ['AA', 'American'], UAL: ['UA', 'United'], DAL: ['DL', 'Delta'], SWA: ['WN', 'Southwest'],
    JBU: ['B6', 'JetBlue'], ASA: ['AS', 'Alaska'], HAL: ['HA', 'Hawaiian'], FFT: ['F9', 'Frontier'],
    NKS: ['NK', 'Spirit'], AAY: ['G4', 'Allegiant'], SCX: ['SY', 'Sun Country'], MXY: ['MX', 'Breeze'],
    VXP: ['XP', 'Avelo'], SKW: ['OO', 'SkyWest'], RPA: ['YX', 'Republic'], ENY: ['MQ', 'Envoy'],
    JIA: ['OH', 'PSA'], PDT: ['PT', 'Piedmont'], EDV: ['9E', 'Endeavor'], ASH: ['YV', 'Mesa'],
    GJS: ['G7', 'GoJet'], QXE: ['QX', 'Horizon'], AWI: ['ZW', 'Air Wisconsin'], UCA: ['C5', 'CommutAir'],
    CPZ: ['CP', 'Compass'], KAP: ['9K', 'Cape Air'], VTE: ['LF', 'Contour'], RVF: ['7H', 'Ravn Alaska'],
    SIL: ['3M', 'Silver Airways'], MUL: ['MW', 'Mokulele'], SBS: ['BB', 'Seaborne'], BTQ: ['4B', 'Boutique Air'],
    FDY: ['9X', 'Southern Airways Express'], GUN: ['Z3', 'Grant Aviation'], PEN: ['KS', 'PenAir'],
    WRF: ['8V', 'Wright Air Service'], SMJ: ['DH', 'Star Marianas']
  };

  /* Regional brands, so we can say "United Express" etc. */
  L.EXPRESS = { AA: 'American Eagle', UA: 'United Express', DL: 'Delta Connection', AS: 'Alaska Horizon/SkyWest' };

  L.name = function (iata) { return L.NAMES[iata] || iata || ''; };

  /* Split "UA 1234" / "UA1234" / "SKW5432" into carrier + number. */
  L.splitNumber = function (s) {
    s = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
    var m = s.match(/^([A-Z0-9]{2,3}?)\s?(\d{1,5}[A-Z]?)$/);
    if (!m) return { carrier: '', num: s.replace(/\s/g, '') };
    return { carrier: m[1], num: m[2].replace(/^0+(?=\d)/, '') };
  };

  /* Operator from call sign ("SKW5432" -> SkyWest). */
  L.operatorFromCallsign = function (cs) {
    if (!cs) return null;
    var m = String(cs).toUpperCase().match(/^([A-Z]{3})\d/);
    if (!m) return null;
    var op = L.OPERATORS[m[1]];
    return op ? { icao: m[1], iata: op[0], name: op[1] } : { icao: m[1], iata: null, name: m[1] };
  };

  /* Aircraft facts from a model string: approximate seats, size class and minimum turn time. */
  var MODELS = [
    [/caravan|c208|islander|bn-2|king ?air|pc-12|cessna|piper|navajo|twin otter|dhc-6/i, 9, 'small', 15],
    [/saab ?340|beech ?1900|b190|ems?b-?110/i, 30, 'small', 20],
    [/crj ?-?2|crj ?200|erj ?-?145|e145|embraer 145|erj ?-?140/i, 50, 'regional', 25],
    [/dash ?8|q400|dhc-8|atr/i, 72, 'regional', 25],
    [/crj ?-?7|crj ?700|e170|embraer 170|erj-?170/i, 70, 'regional', 30],
    [/crj ?-?9|crj ?900|e175|embraer 175|erj-?175|e-?jet/i, 76, 'regional', 30],
    [/e190|e195|embraer 19/i, 100, 'regional', 30],
    [/a220|cs300|cs100|bcs/i, 130, 'narrow', 35],
    [/717/i, 128, 'narrow', 30],
    [/a319/i, 128, 'narrow', 35],
    [/a321/i, 196, 'narrow', 40],
    [/a320/i, 160, 'narrow', 35],
    [/737.*max ?10|737-10/i, 200, 'narrow', 40],
    [/737.*max ?9|737-9|737-900/i, 179, 'narrow', 40],
    [/737.*max ?8|737-8|737-800|max ?8/i, 172, 'narrow', 35],
    [/737.*max ?7|737-7|737-700/i, 143, 'narrow', 35],
    [/737/i, 160, 'narrow', 35],
    [/757/i, 180, 'narrow', 45],
    [/767/i, 211, 'wide', 60],
    [/787/i, 250, 'wide', 75],
    [/777/i, 300, 'wide', 75],
    [/a330|a332|a333|a339/i, 270, 'wide', 70],
    [/a350/i, 300, 'wide', 75],
    [/747|a380/i, 380, 'wide', 90]
  ];
  L.aircraft = function (model) {
    if (!model) return null;
    for (var i = 0; i < MODELS.length; i++) {
      if (MODELS[i][0].test(model)) return { seats: MODELS[i][1], size: MODELS[i][2], turnMin: MODELS[i][3] };
    }
    return { seats: 150, size: 'narrow', turnMin: 35 };
  };

  /* Short model label: "Boeing 737-800" -> "737-800". */
  L.shortModel = function (model) {
    if (!model) return '';
    return String(model).replace(/^(Boeing|Airbus|Embraer|Bombardier|De Havilland Canada|Canadair)\s+/i, '')
      .replace(/\s+/g, ' ').trim();
  };

  /* Tracking links (free, no data cost). */
  L.trackLinks = function (leg) {
    var ident = (leg.callSign || (leg.carrier + leg.num)).replace(/\s/g, '');
    var fr = (leg.carrier + leg.num).toLowerCase();
    var out = [
      { name: 'FlightAware', url: 'https://www.flightaware.com/live/flight/' + encodeURIComponent(ident) },
      { name: 'Flightradar24', url: 'https://www.flightradar24.com/data/flights/' + encodeURIComponent(fr) }
    ];
    if (leg.reg) out.push({ name: leg.reg, url: 'https://www.flightaware.com/live/flight/' + encodeURIComponent(leg.reg) });
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
