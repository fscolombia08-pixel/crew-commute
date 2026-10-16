# Crew Commute ✈

A free, one-way flight finder for airline employees. Search from A to B across **every airline**: nonstop, 1 stop or 2 stops, any mix of airlines. Covers all 50 states plus Puerto Rico, the U.S. Virgin Islands, Guam, Saipan and American Samoa.

What it shows for each option:

- Times, connections, terminals and gates, the aircraft and who operates the flight (for example "UA 5432 operated by SkyWest")
- **On-time history** for each flight (U.S. DOT data), for example "78% on time · 1.5% canceled · avg. 12 min late"
- **Warnings** that can break a trip: tight connections, airline changes, flights running late, a late inbound plane, FAA ground stops and bad weather
- **Backups:** how many later flights still get you there
- **Commute mode:** enter your report time and the site finds your Plan A and the backup flights after it, including flights the night before
- **Quick trips:** one-tap searches for your usual routes (set in `config.js`)
- **Inbound plane check:** is the aircraft for your flight late on its previous leg?
- Weather (METAR/TAF) and FAA ground stops and delay programs at every airport on the trip
- English and Spanish, works on phones, can be added to the home screen, saves your usual trips

> **Important:** Crew Commute only finds flights. It does **not** show loads, open seats or the standby list. Always check loads and list in your airline's employee travel app.

---

## How it works

```
Your friends' phones ──> Website (GitHub Pages, free)
                              │  group code
                              ▼
                     Cloudflare helper (free) ──> AeroDataBox (flight schedules and status)
                     keeps the keys secret,   ──> FAA NAS Status (delays, free)
                     shares cached answers    ──> aviationweather.gov (METAR/TAF, free)
```

The route network (BTS T-100) and on-time history (BTS) are built into the site's `data` folder, so they cost nothing to use.

---

## Setup (about 25 minutes, once)

You need three free accounts: **GitHub**, **Cloudflare** and **RapidAPI** (for AeroDataBox).

### Step 1: Put the website on GitHub Pages

1. Sign in to GitHub. Click **+** (top right) and then **New repository**.
2. Name it `crew-commute`, set it to **Public**, and click **Create repository**. Don't add a README.
3. On the new page, click **uploading an existing file**.
4. Open the `crew-commute` folder on your computer. Select **everything inside it** (Ctrl+A) and drag it into the browser window. Drag the files and folders that are inside, not the `crew-commute` folder itself.
5. Wait until all files are listed, then click **Commit changes**.
6. Go to **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main**, and the folder to **/ (root)**. Click **Save**.
7. After 1–2 minutes your site is live at `https://YOUR-GITHUB-NAME.github.io/crew-commute/`. It opens in **demo mode** (made-up flights) until Step 3 is done.

### Step 2: Create the Cloudflare helper

Cloudflare sometimes renames menu items. If a name below looks a little different, look for the closest match.

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create → Create Worker** (you can start from "Hello World"). Name it `crew-commute-helper` and click **Deploy**.
3. Click **Edit code**. Delete everything in the editor. Open `worker/worker.js` from this folder in Notepad, copy all of it, paste it into the editor, and click **Deploy**.
4. Create the shared cache: go to **Storage & Databases → KV → Create**, name it `crew-commute-cache`, and click **Add**.
5. Connect the cache to the helper: open your Worker, go to **Settings → Bindings → Add → KV namespace**, set **Variable name** to `CACHE`, choose `crew-commute-cache`, and save.
6. Add the settings: open your Worker, go to **Settings → Variables and Secrets → Add**. Add these four:

   | Name | Type | Value |
   |---|---|---|
   | `ACCESS_CODE` | **Secret** | Your group code, for example `mango-runway-blue-42` (make up your own) |
   | `ADB_KEY` | **Secret** | Your RapidAPI key for AeroDataBox (see below) |
   | `ALLOWED_ORIGINS` | Text | `https://YOUR-GITHUB-NAME.github.io` (no `/crew-commute` at the end) |
   | `MONTHLY_UNITS` | Text | `400` on the free plan (`5000` on Pro) |

   Click **Deploy** (or **Save and deploy**).
7. Copy your Worker's address (it looks like `https://crew-commute-helper.YOUR-NAME.workers.dev`). Open it in a browser. You should see **"Crew Commute helper is running."**

**Where to find the RapidAPI key:** go to [aerodatabox.com/pricing](https://aerodatabox.com/pricing), choose **RapidAPI**, and subscribe to **Basic (free)**. On the AeroDataBox page in RapidAPI, the code examples show `X-RapidAPI-Key: ...`. That long value is your key. Keep it private.

### Step 3: Connect the website to the helper

1. In your GitHub repository, open `config.js` and click the pencil icon (Edit).
2. Put your Worker address between the quotes:
   `apiBase: "https://crew-commute-helper.YOUR-NAME.workers.dev"`
3. Click **Commit changes**. Wait about 1 minute.
4. Open your site, tap the gear icon (Settings), type the group code, and tap **Test connection**. You should see **"Connected."**
5. Search! The demo banner is gone, so the flights are real.

### Step 4: Share it with your friends

Send them the site link and the group code privately (for example in WhatsApp). Each person types the code once in Settings.

- **iPhone:** open the site in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap **⋮**, then **Add to Home screen** (or **Install app**).

---

## How much data does a search use?

AeroDataBox counts **units**. Every airport board for half a day costs 2 units. The helper saves each answer for a while, so when a friend repeats a search soon after, it costs 0 units.

| What you do | About |
|---|---|
| Search with up to 1 stop (one day) | 10 units the first time |
| Nonstop only | 4 units |
| "Search 2-stop routes" button | about 12 more units |
| Commute search, including the night before | 12–16 units |
| Inbound plane check | 2–4 units |
| Weather, FAA delays, on-time history | free |

- **Free plan (400 units a month):** about 30–40 new searches a month. Good for testing.
- **Pro (about $8 a month, 5,000 units):** about 450 new searches a month, plus all the repeats.

Then change `MONTHLY_UNITS` in Cloudflare to match your plan. The helper stops before the limit, so you won't be charged by surprise. Choose a plan with no overage charges.

---

## Changing the quick trips

Open `config.js` on GitHub, click the pencil icon, and edit the `quickTrips` list (for example `{ from: "DEN", to: "FLL" }`). Then click **Commit changes**.

---

## Updating the history (every few months)

The route network (T-100) and on-time history come from free BTS downloads. To refresh them:

1. Download the newer files again, as in `START-HERE.html` (Part A), into `data-raw`.
2. Build the data: ask Claude, or if you have Python installed, run this from this folder:
   `python tools/build_data.py ../data-raw data`
3. Upload the new `data` folder to GitHub (drag it into the repository and click **Commit changes**).

---

## Troubleshooting

| Message | Fix |
|---|---|
| "The group code is missing or wrong" | In Settings, type the code exactly as in Cloudflare's `ACCESS_CODE`. Capital letters don't matter. |
| "Can't reach the flight-data helper" | Check `apiBase` in `config.js`, and check that `ALLOWED_ORIGINS` is `https://YOUR-GITHUB-NAME.github.io` with no slash and nothing after it. |
| "The flight data key was refused" | Check `ADB_KEY`, and check that you are subscribed to AeroDataBox on RapidAPI. |
| "This month's flight-data limit is used up" | The plan's units are used up. It resets next month, or you can upgrade. |
| No flights for a small airport | Flight-data coverage of very small airlines can be incomplete. Try a nearby bigger airport. |
| Still in demo mode | Make sure `config.js` has your helper address, and that "Use demo data" is off in Settings. |

---

## What's in this folder

| Path | What it is |
|---|---|
| `index.html`, `assets/` | The website |
| `config.js` | Your helper address and quick trips (the only file you edit) |
| `data/` | Airports, route network and on-time history (built by `tools/build_data.py`) |
| `worker/worker.js` | The Cloudflare helper (copy into Cloudflare) |
| `tools/build_data.py` | Builds `data/` from the free downloads |
| `tests/` | Automatic checks (`node --test tests/*.test.mjs`) |

## Data sources and credits

- Flight schedules and status: [AeroDataBox](https://aerodatabox.com). Credit is required on the free plan and is shown in the footer.
- Route network: U.S. DOT Bureau of Transportation Statistics, T-100 Domestic Segment (public domain)
- On-time history: BTS Marketing Carrier On-Time Performance (public domain)
- Airports: [OurAirports](https://ourairports.com/data/) (public domain)
- Weather: NOAA Aviation Weather Center. Delays: FAA NAS Status.

Crew Commute is a free tool for airline employees and is not affiliated with any airline. Follow your airline's pass-travel rules.
