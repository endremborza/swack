# Swack

Zero-cost swipe surveys. Think Tinder for feedback — respondents swipe in up to four directions to answer each question. No server, no database, no cost. All responses land in a Google Sheet you own.

## How it works

The frontend is a static SPA. The "backend" is a Google Apps Script Web App deployed from a Google Sheet. The creator's sheet stores questions and collects answers; the app is just the UI layer.

```
Creator                        Respondent
  │                                │
  ├─ clone template sheet          │
  ├─ fill in questions/config      │
  ├─ deploy Apps Script            │
  ├─ paste URL → get share link ───┼──▶ /fill#<base64url>
  │                                │
  │                           enter name
  │                           swipe cards
  │                           (each swipe POSTs one answer)
  │                                │
  └─ open Sheet to view answers ◀──┘
```

## Setup

### 1. Clone the template

Click **Get the template** on the app's landing page to copy the Google Sheet with the correct structure and Apps Script pre-installed.

### 2. Configure your form

- **`Questions` tab** — add one question per row (column A, skip the header)
- **`Config` tab** — set `formTitle` and swipe direction labels (`swipeLeftLabel`, `swipeRightLabel`, `swipeUpLabel`, `swipeDownLabel`). Leave a label blank to disable that direction.

### 3. Deploy the Apps Script

1. Open **Extensions → Apps Script** in your sheet
2. Click **Deploy → New deployment**
3. Type: **Web app**, Execute as: **Me**, Access: **Anyone**
4. Copy the Web App URL

### 4. Generate a shareable link

Paste the Web App URL into the generator on the landing page. Share the resulting link — that's it.

## Running locally

```sh
npm install
npm run dev
```

## Building

```sh
npm run build
```

Output goes to `build/`. Deploy anywhere that serves static files (GitHub Pages, Netlify, Cloudflare Pages, etc.). For GitHub Pages set the fallback to `404.html`.

## Anti-abuse

- Each session gets a UUID; answers are tagged with it, making duplicate detection trivial in Sheets
- Partial responses (user drops off mid-survey) are still recorded per-question, so you know exactly where people stopped
