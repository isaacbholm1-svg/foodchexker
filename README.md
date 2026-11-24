# FoodChecker

An iPhone-friendly calorie counter. Snap a photo of your meal (or type what you ate) and free AI (Google Gemini) estimates the calories, protein, carbs and fat. It runs in Safari and installs to your Home Screen like a regular app, so you don't need a Mac, Xcode or an Apple developer account.

## Features

- **Setup**: name, age, sex, height, weight (metric or US units), activity level and goal.
- **Personal targets**: daily calories, protein, carbs, fat, fiber and water, worked out with the Mifflin-St Jeor equation and published guidelines (CDC weight-loss pace, ISSN protein ranges, Dietary Guidelines fat/fiber). Tap "How these numbers were worked out" to see the reasoning.
- **Goals**: lose weight, keep weight stable, build muscle, gain weight, or just eat healthier, with a pace and an optional goal weight (plus an estimated date).
- **Safety rules**: no weight-loss plans for under-18s or people already underweight, a minimum calorie floor, deficits capped at 1% of body weight per week, and no underweight goal weights.
- **Photo → nutrition**: snap or pick a photo, or type what you ate; free AI estimates each food's portion, calories and macros. Review and edit before saving.
- **Barcode scanning**: scan a packaged food with the camera (or type the number) and get its nutrition from [Open Food Facts](https://world.openfoodfacts.org), a free open food database. No AI or key needed. If a product isn't found, snap the nutrition label and the AI reads it.
- **Log again**: one-tap re-logging of recent meals without using the AI.
- **Daily / weekly / monthly / yearly progress**: calorie charts against your goal, days on target, streaks, average macros, most-eaten foods.
- **Weight tracking** with a trend chart and goal line.
- **Water tracker** with adjustable glass size.
- **Motivation**: dozens of messages using your name that react to your day (morning, on track, goal hit, streaks, protein and water goals, weekends, and kind words on harder days). Tap one for another.
- **Customize**: kg/lb, cm/ft-in, kcal/kJ, ml/fl oz; light, dark or auto theme; 6 accent colors; turn features on or off; edit targets by hand.
- **Your data**: stored only on your phone; back up and restore (backups never include the AI key), CSV export, delete everything.

## Put it on your iPhone

1. **Turn on GitHub Pages** (one time): in this repo on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. **Deploy**: merge this code into `main`. The workflow in `.github/workflows/deploy.yml` builds the app and publishes it to `https://<your-github-username>.github.io/<repo-name>/`.
3. **Install**: open that URL in **Safari** on your iPhone, tap **Share → Add to Home Screen**.
4. **Get a free AI key** (each person who uses the app does this once): sign in with a Google account at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), tap **Create API key**, copy it, open the app and paste it in Settings. No credit card needed.

### What it costs

Nothing. The app uses Google's free Gemini tier. It has daily and per-minute limits, but they're far more than a few meals a day. If you hit one, the app says so; wait and try again. If Google moves a model off the free tier, the app automatically tries the next free one.

Heads-up: Google's terms say free-tier requests may be used to improve their products, so don't use it for anything private.

## Run it on your computer

```bash
npm install
npm run dev
```

`npm run dev` prints a local URL and a network URL. Open the network URL on your iPhone (same Wi-Fi) to try it on the phone. Installing to the Home Screen as a full app and offline mode need the deployed HTTPS site.

## How it works

| File | What it does |
|---|---|
| `src/ai.ts` | Sends the photo/text to Gemini with a dietitian prompt and a JSON schema, so the answer comes back as structured data (items, portions, kcal, macros, confidence, notes). |
| `src/barcode.ts` | Camera barcode scanning (ZXing) and Open Food Facts lookup. |
| `src/image.ts` | Shrinks the photo on the phone before upload (faster and cheaper) and makes thumbnails. |
| `src/store.ts` | Saves meals, weights, water and settings on the phone; backup/restore. |
| `src/main.ts` | Today, review sheet, weight log and settings screens. |
| `src/onboarding.ts` | The setup wizard. |
| `src/nutrition.ts` | Target calculations, safety rules and unit conversions. |
| `src/stats.ts` | Progress tab and charts. |
| `src/motivation.ts` | Motivation messages. |
| `public/sw.js` | Service worker so the app opens offline. |

## Is it safe if the site is public?

Yes. **No key is in the code or on the website.** Each person pastes their own key into Settings on their own phone, and it's stored only there. Anyone can open the public link, but without a key it can't do anything, and nobody can see your key.

**Never put a key in the code.** The repo and the website are public, so anyone could copy it and use up your limits.

## Ideas for next steps

- Favorite/recent meals for one-tap logging
- Weekly charts and streaks
- Sync across devices (would need a backend and accounts)
- A native SwiftUI version with Apple Health integration (needs a Mac with Xcode)
