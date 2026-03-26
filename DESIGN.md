initial idea:

I want to create a super _super_ low resource form-like app. The goal is for any user to be able to create a form, with any number of questions, with 2-4 labels per question. the labels would be applied by people filling out the form by swiping one of 4 ways on their screen. users could fill out a form by just getting a link, and the responses should be recorded _somewhere_ for the creator to check. now I want to explore all possible ways for this to work with basically zero server costs, and still somehow filtering out bots and ddos or any weirdness, so somehow putting the burden on the creator of forms. I'm unsure how to do this, some peer to peer data sharing, some blockchain like ledger (again, to require effort from posters), I'm unsure, we are at the ideation phase, how do I do this absolute zero cost?


### Part 1: The Human Plan (Creating the Master Template)

Open a new Google Sheet and follow these exact steps to create the template your users will clone.

**1. Create the Three Tabs**
Create three tabs at the bottom and name them exactly this:
* `Questions`
* `Config`
* `Answers`

**2. Set Up the Columns**
* **In the `Questions` tab:** * Cell A1: `Question Text`
    * *(Fill in 2-3 dummy questions in column A so the template isn't empty).*
* **In the `Config` tab:**
    * Cell A1: `Key`
    * Cell B1: `Value`
    * Row 2: `formTitle` | `My Awesome Swipe Form`
    * Row 3: `swipeLeftLabel` | `Nope`
    * Row 4: `swipeRightLabel` | `Yep`
    * Row 5: `swipeUpLabel` | `Maybe`
    * Row 6: `swipeDownLabel` | `Skip`
* **In the `Answers` tab:**
    * Cell A1: `Timestamp`
    * Cell B1: `Session ID`
    * Cell C1: `Answers JSON` *(We will dump the raw JSON here to handle any number of dynamic questions easily).*

**3. Inject the Apps Script (The "Backend")**
* Go to **Extensions > Apps Script**.
* Delete any code there and paste this exact script:

```javascript
const SCRIPT_VERSION = "1.0";

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Get Config
  const configTab = sheet.getSheetByName("Config");
  const configData = configTab.getDataRange().getValues();
  let config = {};
  // Skip header row, map Key to Value
  for (let i = 1; i < configData.length; i++) {
    if (configData[i][0]) config[configData[i][0]] = configData[i][1];
  }

  // 2. Get Questions
  const questionsTab = sheet.getSheetByName("Questions");
  const questionsData = questionsTab.getDataRange().getValues();
  let questions = [];
  // Skip header row
  for (let i = 1; i < questionsData.length; i++) {
    if (questionsData[i][0]) questions.push(questionsData[i][0]);
  }

  // 3. Return as JSON
  const response = { config: config, questions: questions };
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Answers");
    // Parse the plain text body sent by the Svelte app to bypass CORS
    const data = JSON.parse(e.postData.contents);
    
    const timestamp = new Date();
    const sessionId = data.sessionId || "unknown";
    const answersJson = JSON.stringify(data.answers || {});

    sheet.appendRow([timestamp, sessionId, answersJson]);

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```
* Click the **Save** icon (floppy disk).
* Go back to your Google Sheet URL. Replace everything after the last `/` (which is usually `/edit#gid=0`) with `/copy`. **This is your Master Template Link.** Save it.

---

### Part 2: The Coding Plan

**Context & Architecture:**
I am building a completely serverless, zero-cost form application. The database is a Google Sheet owned by the user, accessed via a Google Apps Script Web App. The frontend is a static single-page application. 
Please build the frontend using **Svelte (Vite, pure SPA, no SSR)**. We will use standard CSS or Tailwind (your choice) for styling.

**Core Mechanics:**
The app has two main routes/views:
1.  **The Creator View (Landing Page):** * Explains how it works.
    * Provides a button with an `href` to a Google Sheet `/copy` link (use a placeholder link for now).
    * Has an input field where the creator pastes their deployed Google Apps Script Web App URL.
    * A "Generate Form Link" button that takes that URL, encodes it (e.g., base64 encoding the URL), and generates a shareable link that looks like `yoursite.com/fill#[BASE64_ENCODED_WEB_APP_URL]`.
2.  **The Responder View (`/fill` route):**
    * Reads the base64 string from the URL hash fragment and decodes it to get the Google Apps Script Web App URL.
    * On mount, sends a `GET` request to that URL. It will return JSON like: `{ config: { formTitle: "...", swipeLeftLabel: "No", etc }, questions: ["Q1", "Q2"] }`.
    * Displays a Tinder-style swipe interface. It shows one question at a time as a card.
    * The user can swipe in 4 directions. The config dictates the labels for Up, Down, Left, Right.
    * Records the direction swiped for each question.
    * When the last question is swiped, generate a random alphanumeric `sessionId`.
    * Run a simple "Client-Side Proof of Work" function to deter bots (e.g., a simple loop finding a SHA-256 hash with 3 leading zeros based on the `sessionId`). Show a "Verifying..." spinner while this runs.
    * Send a `POST` request to the Web App URL. **Crucial:** To avoid CORS preflight failures, send this `POST` request with the `Content-Type` header set to `text/plain`, and `JSON.stringify` the payload in the body. The payload should look like: `{ sessionId: "xyz123", answers: { "Question 1": "Left", "Question 2": "Up" } }`.
    * Show a success screen.

**Key Requirements for the Agent:**
* Implement smooth touch/swipe physics for the cards. You can use an existing Svelte swipe/tinder card library or implement native touch event listeners (`touchstart`, `touchmove`, `touchend`).
* Ensure the state management handles the loading state (fetching config), the active swiping state, the PoW calculation state, and the final success state.
* Make it mobile-first and responsive. The swipe UI should take up the majority of the viewport.
