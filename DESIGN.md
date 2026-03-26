# Swack — Design Notes

Zero-cost swipe surveys backed by Google Sheets. The database is a Google Sheet owned by the form creator, accessed via a Google Apps Script Web App. The frontend is a static SPA (SvelteKit + adapter-static) deployed anywhere.

---

## Google Sheet Setup (creator does this once)

### 1. Create three tabs

| Tab name    | Purpose                        |
|-------------|-------------------------------|
| `Questions` | One question per row           |
| `Config`    | Key/value form settings        |
| `Answers`   | One row per recorded answer    |

### 2. Tab schemas

**`Questions`** — Column A: `Question Text` (header), then one question per row below.

**`Config`** — Columns A/B: `Key` / `Value`

| Key               | Example value        | Notes                            |
|-------------------|----------------------|----------------------------------|
| `formTitle`       | `Team Retro Q2`      |                                  |
| `swipeLeftLabel`  | `Disagree`           | Leave blank to disable direction |
| `swipeRightLabel` | `Agree`              |                                  |
| `swipeUpLabel`    | `Neutral`            |                                  |
| `swipeDownLabel`  | `Skip`               |                                  |

**`Answers`** — Columns: `Timestamp` | `Session ID` | `User Name` | `Question` | `Answer`

Each swipe records one row immediately (not batched at the end).

### 3. Apps Script

Open **Extensions → Apps Script**, paste this, and save:

```javascript
function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();

  const configData = sheet.getSheetByName('Config').getDataRange().getValues();
  const config = {};
  for (let i = 1; i < configData.length; i++) {
    if (configData[i][0]) config[configData[i][0]] = configData[i][1];
  }

  const questionsData = sheet.getSheetByName('Questions').getDataRange().getValues();
  const questions = [];
  for (let i = 1; i < questionsData.length; i++) {
    if (questionsData[i][0]) questions.push(questionsData[i][0]);
  }

  return ContentService.createTextOutput(JSON.stringify({ config, questions }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Answers').appendRow([
      new Date(),
      data.sessionId || '',
      data.userName || '',
      data.question || '',
      data.answer || ''
    ]);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

### 4. Deploy

**Deploy → New deployment → Web app**
- Execute as: **Me**
- Who has access: **Anyone**

Copy the Web App URL. Paste it into the Swack generator at `/` to produce a shareable form link.

---

## Architecture

```
/                creator view — explains setup, generates shareable links
/fill#<base64>   responder view — decodes URL, loads form, collects swipes
```

The base64 payload in the hash is just `btoa(gasWebAppUrl)`. No server involved at any point.

### Responder flow

1. Decode hash → `gasUrl`
2. `GET gasUrl` → `{ config, questions }`
3. Name screen (typed or random)
4. Swipe cards — each swipe fires `POST gasUrl` with `{ sessionId, userName, question, answer }`
5. Done screen
