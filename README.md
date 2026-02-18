# PageSpeed Tracker

Track Google PageSpeed Insights repeatedly, average results over time, and compare multiple URLs side by side.

## What It Does

- Runs PageSpeed Insights continuously for each tracked URL.
- Runs both **mobile** and **desktop** each cycle.
- Uses a fixed **60-second poll interval** (Google PSI minimum).
- Tracks:
  - Performance score
  - FCP, SI, LCP, TBT, CLS
- Computes 95% confidence intervals (`mean ± points`) for score stability.
- Stores app state in local storage (API key, tracked URLs, run history, UI settings).
- Provides card view + comparison table with sortable columns and color-coded values.

## Quick Start (Local)

### 1) Clone and enter the project

```bash
git clone <your-repo-url>
cd pagespeeder
```

### 2) Start the local server

```bash
node server.js
```

### 3) Open the app

Go to [http://localhost:3000](http://localhost:3000).

### 4) Add your API key and first URL

1. Paste your Google API key in **Settings**.
2. Click **Save Settings**.
3. Add a URL in **Add URL**.

API key setup docs:
- [PageSpeed Insights API v5: Get Started](https://developers.google.com/speed/docs/insights/v5/get-started)

## Usage Notes

- Polling is fixed at 60 seconds (otherwise, Google returns a cached result).
- Clicking **Run once** on a paused card submits one cycle only.
- Clicking **Resume** enables continuous polling again.
- If auto-pause conditions are met, status will show that it paused at stat-sig threshold.

## API Endpoint

The app calls:
- `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`

Request parameters:
- `url`
- `key`
- `strategy` (`mobile` or `desktop`)
- `category=performance`

## Deployment

This is a static frontend plus a tiny Node static server (`server.js`), so it can be run locally or hosted behind any static-serving setup.
