# FoodChexker

An iPhone-friendly calorie counter. Snap a photo of your meal (or type what you ate) and free AI (Google Gemini) estimates the calories, protein, carbs and fat. It runs in Safari and installs to your Home Screen like a regular app, so you don't need a Mac, Xcode or an Apple developer account.

## Features

- **Photo → nutrition**: take a picture or pick one from your library; the AI identifies each food, estimates portions, and returns calories and macros.
- **Text entry**: type "2 eggs, toast with butter, coffee" instead of a photo. Text typed before snapping a photo is sent as extra detail ("only ate half").
- **Review before saving**: rename the meal, fix any item's calories (its macros scale with it), remove items, change servings, pick the meal.
- **Daily dashboard**: calorie ring plus protein/carb/fat progress against your goals; browse previous days.
- **Private**: your log and API key are stored only on your phone. Photos go straight from your phone to Google's AI.
- **Export**: download your whole log as CSV from Settings.

## Put it on your iPhone

1. **Turn on GitHub Pages** (one time): in this repo on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. **Deploy**: merge this code into `main`. The workflow in `.github/workflows/deploy.yml` builds the app and publishes it to `https://<your-github-username>.github.io/foodchexker/`.
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
| `src/image.ts` | Shrinks the photo on the phone before upload (faster and cheaper) and makes thumbnails. |
| `src/store.ts` | Saves your log and settings in the browser's local storage. |
| `src/main.ts` | The UI: dashboard, review sheet, settings. |
| `public/sw.js` | Service worker so the app opens offline. |

## Is it safe if the site is public?

Yes. **No key is in the code or on the website.** Each person pastes their own key into Settings on their own phone, and it's stored only there. Anyone can open the public link, but without a key it can't do anything, and nobody can see your key.

**Never put a key in the code.** The repo and the website are public, so anyone could copy it and use up your limits.

## Ideas for next steps

- Barcode scanning for packaged foods
- Favorite/recent meals for one-tap logging
- Weekly charts and streaks
- Sync across devices (would need a backend and accounts)
- A native SwiftUI version with Apple Health integration (needs a Mac with Xcode)
