# FoodChexker

An iPhone-friendly calorie counter. Snap a photo of your meal (or type what you ate) and AI estimates the calories, protein, carbs and fat. It runs in Safari and installs to your Home Screen like a regular app, so you don't need a Mac, Xcode or an Apple developer account.

## Features

- **Photo → nutrition**: take a picture or pick one from your library; Claude identifies each food, estimates portions, and returns calories and macros.
- **Text entry**: type "2 eggs, toast with butter, coffee" instead of a photo. Text typed before snapping a photo is sent as extra detail ("only ate half").
- **Review before saving**: rename the meal, fix any item's calories (its macros scale with it), remove items, change servings, pick the meal.
- **Daily dashboard**: calorie ring plus protein/carb/fat progress against your goals; browse previous days.
- **Private**: your log and API key are stored only on your phone. Photos go straight from your phone to Anthropic's API.
- **Export**: download your whole log as CSV from Settings.

## Put it on your iPhone

1. **Turn on GitHub Pages** (one time): in this repo on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. **Deploy**: merge this code into `main`. The workflow in `.github/workflows/deploy.yml` builds the app and publishes it to `https://<your-github-username>.github.io/foodchexker/`.
3. **Install**: open that URL in **Safari** on your iPhone, tap **Share → Add to Home Screen**.
4. **Get an API key**: create one at [platform.claude.com](https://platform.claude.com/settings/keys) (you'll need to add a few dollars of credit). Open the app and paste the key in Settings.

### What it costs

The app uses `claude-opus-5-5` ($4 per million input tokens, $20 per million output tokens). A typical photo analysis is roughly 2,000–3,000 input tokens and a few hundred to a couple thousand output tokens (including the model's thinking), so expect around **1–5 cents per meal**. You can watch exact usage in the Anthropic console.

## Run it on your computer

```bash
npm install
npm run dev
```

`npm run dev` prints a local URL and a network URL. Open the network URL on your iPhone (same Wi-Fi) to try it on the phone. Installing to the Home Screen as a full app and offline mode need the deployed HTTPS site.

## How it works

| File | What it does |
|---|---|
| `src/ai.ts` | Sends the photo/text to Claude with a dietitian prompt and a Zod schema, so the answer comes back as structured JSON (items, portions, kcal, macros, confidence, notes). |
| `src/image.ts` | Shrinks the photo on the phone before upload (faster and cheaper) and makes thumbnails. |
| `src/store.ts` | Saves your log and settings in the browser's local storage. |
| `src/main.ts` | The UI: dashboard, review sheet, settings. |
| `public/sw.js` | Service worker so the app opens offline. |

## Security note

The app calls the Anthropic API directly from your phone using the key you paste in, which is fine for a personal app because the key never leaves your device except to go to Anthropic. **Don't** hard-code a key into the code or share your deployed link with a key baked in. If you ever want other people to use it, add a small backend (for example a Cloudflare Worker) that holds the key and forwards requests, and have the app call that instead.

## Ideas for next steps

- Barcode scanning for packaged foods
- Favorite/recent meals for one-tap logging
- Weekly charts and streaks
- Sync across devices (would need a backend and accounts)
- A native SwiftUI version with HealthKit integration (needs a Mac with Xcode)
