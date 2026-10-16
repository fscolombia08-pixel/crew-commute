#!/usr/bin/env python3
"""
Crew Commute data builder.

Turns free public downloads into the small data files the website uses:
  data/airports.js        every U.S. airport with scheduled service (50 states + territories), with time zones
  data/routes.js          the U.S. route network, flights per month (BTS T-100 Domestic Segment)
  data/ontime/X.js        on-time history per flight number (one file per first letter of the airport code)
  data/meta.js            which months the history covers

Inputs (put them in one folder, zipped or not, any file names):
  - OurAirports airports.csv
  - BTS "T-100 Domestic Segment (U.S. Carriers)" CSV/ZIP files
  - BTS "Marketing Carrier On-Time Performance" (or "Reporting Carrier") CSV/ZIP files

Usage:
  python3 tools/build_data.py data-raw data

Only uses the Python standard library, so it runs anywhere (Windows, Mac, Linux, GitHub Actions).
"""
import csv
import datetime
import io
import json
import os
import sys
import zipfile
from collections import Counter, defaultdict

csv.field_size_limit(10_000_000)
COUNTRIES = {'US', 'PR', 'VI', 'GU', 'MP', 'AS'}
# Airlines left out of the route network and on-time history (Spirit, NK, stopped flying in May 2026).
EXCLUDED_CARRIERS = {'NK'}
TERRITORY_REGION = {'PR': 'PR', 'VI': 'VI', 'GU': 'GU', 'MP': 'MP', 'AS': 'AS'}
STATE_TZ = {
    'AL': 'America/Chicago', 'AK': 'America/Anchorage', 'AZ': 'America/Phoenix', 'AR': 'America/Chicago',
    'CA': 'America/Los_Angeles', 'CO': 'America/Denver', 'CT': 'America/New_York', 'DE': 'America/New_York',
    'DC': 'America/New_York', 'FL': 'America/New_York', 'GA': 'America/New_York', 'HI': 'Pacific/Honolulu',
    'ID': 'America/Boise', 'IL': 'America/Chicago', 'IN': 'America/Indiana/Indianapolis', 'IA': 'America/Chicago',
    'KS': 'America/Chicago', 'KY': 'America/New_York', 'LA': 'America/Chicago', 'ME': 'America/New_York',
    'MD': 'America/New_York', 'MA': 'America/New_York', 'MI': 'America/Detroit', 'MN': 'America/Chicago',
    'MS': 'America/Chicago', 'MO': 'America/Chicago', 'MT': 'America/Denver', 'NE': 'America/Chicago',
    'NV': 'America/Los_Angeles', 'NH': 'America/New_York', 'NJ': 'America/New_York', 'NM': 'America/Denver',
    'NY': 'America/New_York', 'NC': 'America/New_York', 'ND': 'America/Chicago', 'OH': 'America/New_York',
    'OK': 'America/Chicago', 'OR': 'America/Los_Angeles', 'PA': 'America/New_York', 'RI': 'America/New_York',
    'SC': 'America/New_York', 'SD': 'America/Chicago', 'TN': 'America/Chicago', 'TX': 'America/Chicago',
    'UT': 'America/Denver', 'VT': 'America/New_York', 'VA': 'America/New_York', 'WA': 'America/Los_Angeles',
    'WV': 'America/New_York', 'WI': 'America/Chicago', 'WY': 'America/Denver',
    'PR': 'America/Puerto_Rico', 'VI': 'America/St_Thomas', 'GU': 'Pacific/Guam', 'MP': 'Pacific/Saipan',
    'AS': 'Pacific/Pago_Pago'
}
TZ_BY_CODE = {
    'IWD': 'America/Menominee', 'IMT': 'America/Menominee', 'MNM': 'America/Menominee',
    'EVV': 'America/Chicago', 'GYY': 'America/Chicago', 'DIK': 'America/Denver', 'ONO': 'America/Boise',
    'ENV': 'America/Denver'
}


def timezone_for(code, region, lat, lon):
    """Time zone from state plus the known split-state exceptions."""
    if code in TZ_BY_CODE:
        return TZ_BY_CODE[code]
    tz = STATE_TZ.get(region, 'America/New_York')
    if region == 'FL' and lon < -85.0:
        return 'America/Chicago'
    if region == 'TX' and lon < -104.9:
        return 'America/Denver'
    if region == 'KY' and lon < -86.0:
        return 'America/Chicago'
    if region == 'TN' and lon > -85.3:
        return 'America/New_York'
    if region == 'SD' and lon < -100.6:
        return 'America/Denver'
    if region == 'NE' and lon < -101.4:
        return 'America/Denver'
    if region == 'KS' and lon < -101.6:
        return 'America/Denver'
    if region == 'ID' and lat > 45.5:
        return 'America/Los_Angeles'
    if region == 'AK' and lon < -169.5:
        return 'America/Adak'
    return tz


# ---------------------------------------------------------------- reading files

def csv_sources(folder):
    """Yield (label, reader) for every CSV, including CSVs inside ZIP files."""
    for root, _dirs, files in os.walk(folder):
        for name in sorted(files):
            path = os.path.join(root, name)
            low = name.lower()
            if low.endswith('.csv'):
                f = open(path, 'r', encoding='utf-8-sig', errors='replace', newline='')
                yield name, f
            elif low.endswith('.zip'):
                try:
                    z = zipfile.ZipFile(path)
                except zipfile.BadZipFile:
                    print('  ! not a valid zip, skipped:', name)
                    continue
                for member in z.namelist():
                    if member.lower().endswith('.csv'):
                        raw = z.open(member)
                        yield name + ' > ' + member, io.TextIOWrapper(raw, encoding='utf-8-sig', errors='replace', newline='')


def kind_of(header):
    h = {c.strip() for c in header}
    up = {c.upper() for c in h}
    if {'ident', 'iata_code', 'iso_country'} <= h:
        return 'airports'
    if {'DEPARTURES_PERFORMED', 'SEATS', 'PASSENGERS', 'ORIGIN', 'DEST'} <= up:
        return 't100'
    if 'Flight_Number_Marketing_Airline' in h:
        return 'ontime_mkt'
    if 'Flight_Number_Reporting_Airline' in h:
        return 'ontime_rep'
    return None


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- builders

class Builder:
    def __init__(self):
        self.airport_rows = []
        self.t100 = defaultdict(lambda: [0.0, 0.0, 0.0])   # (o, d, carrier, y, m) -> deps, seats, pax
        self.t100_months = set()
        self.ot = defaultdict(lambda: [0, 0, 0, 0.0, 0, Counter()])   # (o, key) -> n, cxl, ontime, sumdelay, completed, ops
        self.ot_months = set()
        self.served = set()

    # ---- OurAirports
    def add_airports(self, header, rows):
        names = [h.strip() for h in header]
        for row in rows:
            r = dict(zip(names, row))
            if r.get('iso_country') not in COUNTRIES:
                continue
            if r.get('type') not in ('large_airport', 'medium_airport', 'small_airport', 'seaplane_base'):
                continue
            iata = (r.get('iata_code') or '').strip().upper()
            if len(iata) != 3 or not iata.isalnum():
                continue
            self.airport_rows.append(r)

    # ---- T-100 segment
    def add_t100(self, header, rows):
        n = 0
        names = [h.strip().upper() for h in header]
        want = ['CLASS', 'AIRCRAFT_CONFIG', 'DEPARTURES_PERFORMED', 'SEATS', 'PASSENGERS', 'ORIGIN', 'DEST',
                'UNIQUE_CARRIER', 'CARRIER', 'YEAR', 'MONTH']
        idx = {k: names.index(k) for k in want if k in names}
        for row in rows:
            r = {k: (row[i] if i < len(row) else '') for k, i in idx.items()}
            cls = (r.get('CLASS') or 'F').strip().upper()
            if cls != 'F':
                continue
            cfg = (r.get('AIRCRAFT_CONFIG') or '1').strip()
            if cfg and num(cfg, 1) != 1:
                continue
            deps, seats, pax = num(r.get('DEPARTURES_PERFORMED')), num(r.get('SEATS')), num(r.get('PASSENGERS'))
            if deps <= 0 or seats <= 0 or pax <= 0:
                continue
            o, d = (r.get('ORIGIN') or '').strip(), (r.get('DEST') or '').strip()
            carrier = (r.get('UNIQUE_CARRIER') or r.get('CARRIER') or '').strip().upper()
            y, m = int(num(r.get('YEAR'))), int(num(r.get('MONTH')))
            if not (o and d and carrier and y and 1 <= m <= 12):
                continue
            if carrier in EXCLUDED_CARRIERS:
                continue
            a = self.t100[(o, d, carrier, y, m)]
            a[0] += deps
            a[1] += seats
            a[2] += pax
            self.t100_months.add((y, m))
            if pax > 0:
                self.served.add(o)
                self.served.add(d)
            n += 1
        return n

    # ---- On-time
    def add_ontime(self, header, rows, marketing):
        n = 0
        names = [h.strip() for h in header]
        want = ['Marketing_Airline_Network', 'IATA_Code_Marketing_Airline', 'Flight_Number_Marketing_Airline',
                'Operating_Airline', 'IATA_Code_Operating_Airline', 'Reporting_Airline', 'IATA_CODE_Reporting_Airline',
                'Flight_Number_Reporting_Airline', 'Origin', 'Dest', 'Cancelled', 'Diverted', 'ArrDelay', 'ArrDel15',
                'Year', 'Month']
        idx = {k: names.index(k) for k in want if k in names}
        for row in rows:
            r = {k: (row[i] if i < len(row) else '') for k, i in idx.items()}
            if marketing:
                mk = (r.get('Marketing_Airline_Network') or r.get('IATA_Code_Marketing_Airline') or '').strip().upper()
                fn = (r.get('Flight_Number_Marketing_Airline') or '').strip()
                op = (r.get('Operating_Airline') or r.get('IATA_Code_Operating_Airline') or mk).strip().upper()
            else:
                mk = (r.get('Reporting_Airline') or r.get('IATA_CODE_Reporting_Airline') or '').strip().upper()
                fn = (r.get('Flight_Number_Reporting_Airline') or '').strip()
                op = mk
            o, d = (r.get('Origin') or '').strip().upper(), (r.get('Dest') or '').strip().upper()
            if not (mk and fn and o and d):
                continue
            if mk in EXCLUDED_CARRIERS or op in EXCLUDED_CARRIERS:
                continue
            try:
                fn = str(int(float(fn)))
            except ValueError:
                continue
            cancelled = num(r.get('Cancelled')) >= 1
            diverted = num(r.get('Diverted')) >= 1
            arr_delay = r.get('ArrDelay')
            for key in ((o, mk + fn + '-' + d), (o, '*' + mk + '-' + d)):
                s = self.ot[key]
                s[0] += 1
                if cancelled:
                    s[1] += 1
                elif not diverted and arr_delay not in (None, ''):
                    s[4] += 1
                    s[3] += num(arr_delay)
                    if num(r.get('ArrDel15')) < 1:
                        s[2] += 1
                s[5][op] += 1
            y, m = int(num(r.get('Year'))), int(num(r.get('Month')))
            if y and m:
                self.ot_months.add((y, m))
            n += 1
        return n

    # ---------------------------------------------------------------- outputs
    def airports(self):
        out = []
        for r in self.airport_rows:
            iata = r['iata_code'].strip().upper()
            sched = (r.get('scheduled_service') or '').strip().lower() == 'yes'
            if not sched and iata not in self.served:
                continue
            country = r['iso_country']
            region = TERRITORY_REGION.get(country) or (r.get('iso_region') or 'US-').split('-', 1)[-1]
            lat, lon = num(r.get('latitude_deg')), num(r.get('longitude_deg'))
            icao = (r.get('icao_code') or r.get('gps_code') or '').strip().upper()
            if not icao and len(r.get('ident', '')) == 4:
                icao = r['ident'].strip().upper()
            name = (r.get('name') or iata).strip()
            city = (r.get('municipality') or '').strip() or name
            out.append([iata, icao, name, city, region, round(lat, 4), round(lon, 4), timezone_for(iata, region, lat, lon)])
        seen, final = set(), []
        for a in sorted(out, key=lambda x: x[0]):
            if a[0] not in seen:
                seen.add(a[0])
                final.append(a)
        return final

    def routes(self):
        """Route network: average departures per month over the latest 12 months (all airlines).
        The site uses it to pick good connection airports for 2-stop searches. No load factors."""
        by = defaultdict(lambda: defaultdict(float))     # route -> (y, m) -> departures
        for (o, d, c, y, m), v in self.t100.items():
            by[o + '-' + d][(y, m)] += v[0]
        out = {}
        for route, months in by.items():
            keys = sorted(months.keys())[-12:]
            per_month = sum(months[k] for k in keys) / max(1, len(keys))
            if per_month >= 2:
                out[route] = int(round(per_month))
        return out

    def ontime(self):
        per = defaultdict(lambda: {'f': {}, 'c': {}})
        for (o, key), s in self.ot.items():
            n, cxl, ontime, sumdelay, completed, ops = s
            if n < 4:
                continue
            row = [n, round(100 * ontime / completed) if completed else None,
                   round(sumdelay / completed) if completed else None, round(100 * cxl / n, 1)]
            if key.startswith('*'):
                per[o]['c'][key[1:]] = row
            else:
                op = ops.most_common(1)[0][0] if ops else None
                per[o]['f'][key] = row + [op]
        return per


def month_label(months):
    if not months:
        return ''
    a, b = min(months), max(months)
    fmt = lambda ym: datetime.date(ym[0], ym[1], 1).strftime('%b %Y')
    return fmt(a) if a == b else fmt(a) + ' – ' + fmt(b)


def js_wrap(assign, payload):
    return ('(function (r) { var CC = r.CC = r.CC || {}; CC.data = CC.data || {}; CC.data.ontime = CC.data.ontime || {}; '
            + assign + ' = ' + json.dumps(payload, separators=(',', ':')) +
            '; })(typeof window !== "undefined" ? window : globalThis);\n')


def read_meta(dst):
    """Keep what earlier runs found (e.g. on-time history) when this run only updates part of the data."""
    try:
        with open(os.path.join(dst, 'meta.js'), encoding='utf-8') as f:
            text = f.read()
        start = text.index('CC.data.meta = ') + len('CC.data.meta = ')
        end = text.index('; })', start)
        data = json.loads(text[start:end])
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'data-raw'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'data'
    if not os.path.isdir(src):
        sys.exit('Input folder not found: ' + src)
    b = Builder()
    found = Counter()
    sources = []
    for label, f in csv_sources(src):
        reader = csv.reader(f)
        header = next(reader, [])
        kind = kind_of(header)
        f.close()
        if not kind:
            print('  - skipped (unknown columns):', label)
            continue
        sources.append((label, kind))
        found[kind] += 1
    if found['ontime_mkt'] and found['ontime_rep']:
        print('  ! Both on-time file types found: using the Marketing Carrier files only (they match flight numbers on the site).')
    for label, f in csv_sources(src):
        kinds = [k for (l, k) in sources if l == label]
        if not kinds:
            f.close()
            continue
        kind = kinds[0]
        if kind == 'ontime_rep' and found['ontime_mkt']:
            f.close()
            continue
        reader = csv.reader(f)
        header = next(reader, [])
        print('  + reading', kind, '<-', label)
        if kind == 'airports':
            b.add_airports(header, reader)
        elif kind == 't100':
            print('      rows used:', b.add_t100(header, reader))
        else:
            print('      rows used:', b.add_ontime(header, reader, kind == 'ontime_mkt'))
        f.close()

    os.makedirs(os.path.join(dst, 'ontime'), exist_ok=True)
    meta = read_meta(dst)
    meta['built'] = datetime.date.today().isoformat()

    if found['airports']:
        airports = b.airports()
        with open(os.path.join(dst, 'airports.js'), 'w', encoding='utf-8') as out:
            out.write('/* Crew Commute airports: built by tools/build_data.py from OurAirports (public domain). */\n')
            out.write('(function (r) { var CC = r.CC = r.CC || {}; CC.data = CC.data || {}; CC.data.airportsSource = "ourairports"; CC.data.airports = ')
            out.write(json.dumps(airports, separators=(',', ':'), ensure_ascii=False))
            out.write('; })(typeof window !== "undefined" ? window : globalThis);\n')
        print('airports.js:', len(airports), 'airports')
    else:
        print('! No OurAirports file found: data/airports.js was not changed.')

    if found['t100']:
        routes = b.routes()
        with open(os.path.join(dst, 'routes.js'), 'w', encoding='utf-8') as out:
            out.write('/* Route network (flights per month): built by tools/build_data.py from BTS T-100 Domestic Segment. */\n')
            out.write('(function (r) { var CC = r.CC = r.CC || {}; CC.data = CC.data || {}; CC.data.routes = ')
            out.write(json.dumps({'months': month_label(b.t100_months), 'r': routes}, separators=(',', ':')))
            out.write('; })(typeof window !== "undefined" ? window : globalThis);\n')
        meta['t100'] = 'T-100 ' + month_label(b.t100_months)
        print('routes.js:', len(routes), 'routes,', month_label(b.t100_months))
    else:
        print('! No T-100 file found: data/routes.js was not changed.')

    if found['ontime_mkt'] or found['ontime_rep']:
        per = b.ontime()
        label = month_label(b.ot_months)
        for name in os.listdir(os.path.join(dst, 'ontime')):
            if name.endswith('.js'):
                os.remove(os.path.join(dst, 'ontime', name))
        groups = defaultdict(list)
        for o in sorted(per):
            per[o]['months'] = label
            groups[o[0]].append(o)
        for letter, codes in groups.items():
            with open(os.path.join(dst, 'ontime', letter + '.js'), 'w', encoding='utf-8') as out:
                out.write('/* On-time history for airports starting with ' + letter + ' (BTS). */\n')
                for o in codes:
                    out.write(js_wrap('CC.data.ontime[' + json.dumps(o) + ']', per[o]))
        meta['ontime'] = 'On-time ' + label
        meta['ontimeAirports'] = sorted(per.keys())
        print('ontime/:', len(per), 'airports in', len(groups), 'files,', label)
    else:
        print('! No on-time file found: on-time history was not changed.')

    with open(os.path.join(dst, 'meta.js'), 'w', encoding='utf-8') as out:
        out.write('/* Data versions: built by tools/build_data.py */\n')
        out.write('(function (r) { var CC = r.CC = r.CC || {}; CC.data = CC.data || {}; CC.data.meta = ')
        out.write(json.dumps(meta, separators=(',', ':')))
        out.write('; })(typeof window !== "undefined" ? window : globalThis);\n')
    print('meta.js:', {k: v for k, v in meta.items() if k != 'ontimeAirports'})


if __name__ == '__main__':
    main()
