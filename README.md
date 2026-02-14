# PageSpeed Tracker

Track Google PageSpeed Insights repeatedly, average the results, and compare multiple URLs side by side.

## Features

- Runs tests on a timer (minimum 60 seconds).
- Runs both **mobile** and **desktop** strategy each cycle.
- Tracks and averages:
  - Performance score
  - First Contentful Paint (FCP)
  - Speed Index (SI)
  - Largest Contentful Paint (LCP)
  - Total Blocking Time (TBT)
  - Cumulative Layout Shift (CLS)
- Computes a **95% confidence interval** for average score as `mean ± points`.
- Compares multiple URLs in a percentile-colored table (higher percentile = greener).
- Shows live per-URL status (waiting for Google response vs waiting for timer).
- Persists API key, URLs, and collected history in browser local storage.
- No signup/auth system. User enters their own Google API key.

## Local Run

1. Ensure Node.js 18+ is installed.
2. Start the local server:

```bash
node server.js
```

3. Open [http://localhost:3000](http://localhost:3000).
4. Enter your Google API key, poll interval (>= 60), and a URL.

## API Endpoint Used

The app calls:

- `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`

Request params used:

- `url`
- `key`
- `strategy` (`mobile` or `desktop`)
- `category=performance`

## Notes

- The confidence interval is based on sample variation and sample count. More samples narrow the interval.
- API quotas/rate limits depend on your Google Cloud project settings.
- This is a static frontend app with a tiny static file server, so deployment to most hosts is straightforward.
