<p align="center">
  <img src="pagespeeder-icon.svg" width="80" height="80" alt="" />
</p>

<h1 align="center">PageSpeeder</h1>

<p align="center">A clearer picture of PageSpeed performance, one run at a time.</p>

PageSpeed scores can vary from run to run. PageSpeeder collects multiple Google PageSpeed Insights reports, averages the results, and helps you compare mobile and desktop performance across URLs—such as staging and production pages.

## Features

- Track multiple URLs and compare their average performance scores and metrics.
- Review individual runs and their First Contentful Paint, Speed Index, Largest Contentful Paint, Total Blocking Time, and Cumulative Layout Shift results.
- Set a baseline to see how other URLs compare, and choose between absolute and relative score colors.
- Run reports approximately once per minute while a site is tracking. Automatically pause when both averages reach your chosen 95% confidence range, or pause manually.
- Export and import your sites, labels, baseline, and run history. The API key is excluded from exports unless you choose to include it.
- Choose light, dark, or system appearance.

## Getting started

You'll need Node.js 18 or later, npm, and a [Google PageSpeed Insights API key](https://developers.google.com/speed/docs/insights/v5/get-started).

```bash
git clone https://github.com/nordrr/pagespeeder.git
cd pagespeeder
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), add your API key, and enter a URL to start tracking. You can manage the key later in **Settings**. Google must be able to access the URLs you want to audit.

## How tracking works

PageSpeeder requests mobile and desktop reports from Google's PageSpeed Insights API. The app schedules each site's next cycle for approximately one minute after the previous cycle starts; if a request takes longer, the next cycle waits for it to finish. Keep the app open while tracking—runs are scheduled in the browser, not on a server.

The default auto-pause target is **±3 points** for the 95% confidence interval of each average, with at least 10 successful samples for both mobile and desktop. In **Settings**, you can choose a target from ±1 to ±5 points or turn auto-pause off. These intervals describe variability in the collected reports; they don't guarantee a site's future score.

Use **Run now** for an additional cycle, or **Start** and **Pause** to control ongoing tracking. Choose a baseline to compare results, and open a score run to inspect its details.

## Data and API key

Your API key, tracked URLs, settings, and run history are stored in this browser's `localStorage`. The key is sent directly to Google's PageSpeed Insights API when an audit runs. Browser data can be cleared, and it isn't shared automatically across browsers or devices.

Use **Settings → Export data** to save a JSON backup. The optional API key is stored in the backup as plain text, so treat backups containing it as sensitive. Importing a backup replaces your current sites and run history; imported sites start paused. Appearance and tracking settings aren't included in backups.

Each report uses the PageSpeed Insights API, so Google's API usage limits and any applicable charges for your account may apply.

## Production build

```bash
npm run build
npm run preview
```

The build is written to `dist/` and can be hosted as a static site.

## Development

Run the focused tests with `npm test`. They cover the PageSpeed response parser, scheduling, scoring and statistics, backup compatibility, and selected view behavior.

`app.js` connects the app's state, event handlers, and view controllers. The main pieces live in `src/`:

- `tracking/` handles PageSpeed requests and report scheduling.
- `metrics.mjs`, `statistics.mjs`, and `lighthouse-scoring.mjs` define metrics and calculations.
- `state.mjs`, `storage.mjs`, and `backup.mjs` manage defaults, browser persistence, and backup files.
- `views/` renders the site list, site details, score runs, run details, and comparison table.
- `ui/` contains navigation, theme transitions, tooltips, and connected pane outlines.

The workspace stylesheets are loaded in order after `styles.css`: `workspace.css`, `workspace-site-interactions.css`, `workspace-components.css`, and `workspace-details.css`. Their order matters because later rules refine earlier styles.
