Context & Architecture:
I am building a completely serverless, zero-cost, decentralized form application using Svelte (Vite, pure SPA, no SSR). The application uses the Nostr network (via nostr-tools v2) as a pub/sub message broker and database. There is no traditional backend.

Core Mechanics & Cryptography:
We use a two-part URL fragment for sharing forms: #[SERVER_PUB_KEY]_[CONFIG_AES_KEY].

    Form Identity: The Server generates a Nostr keypair (SERVER_PRIV_KEY, SERVER_PUB_KEY).

    Config Privacy: The Form Config (questions, labels) is encrypted symmetrically using CONFIG_AES_KEY before being published to Nostr, ensuring only people with the link can read the questions.

    Answer Privacy: Client responses are E2EE using Nostr's NIP-44 standard. Clients generate ephemeral keypairs and encrypt answers targeting the SERVER_PUB_KEY.

Route 1: The Admin View (/admin)

    Initialization: On load, check IndexedDB (use localforage or native idb) for an existing SERVER_PRIV_KEY. If none exists, generate one and save it. Generate a random 16-character CONFIG_AES_KEY.

    UI: * A simple config editor (Key/Value pairs for labels like "Swipe Left = No").

        A dynamic list editor to add/remove/edit an unlimited number of questions.

        A display showing the shareable link: window.location.origin + '/fill#' + SERVER_PUB_KEY + '_' + CONFIG_AES_KEY.

        A real-time dashboard showing incoming answers.

    Network Logic:

        When the Config changes, JSON.stringify it, encrypt it with CONFIG_AES_KEY (using standard Web Crypto AES-GCM), and publish it as a Nostr Event (e.g., kind: 33333 replaceable event) signed by SERVER_PRIV_KEY.

        Subscribe to the relay pool listening for kind: 4 or NIP-44 kind: 1059 (Direct Messages) sent to the SERVER_PUB_KEY.

        When an answer arrives, decrypt it using the SERVER_PRIV_KEY, and save the decrypted JSON to IndexedDB. Update the dashboard UI reactively.

Route 2: The Responder View (/fill)

    Initialization: Parse the SERVER_PUB_KEY and CONFIG_AES_KEY from the URL hash. Generate a temporary, ephemeral Nostr keypair in memory.

    Network Logic (Config):

        Connect to the relay pool. Subscribe to kind: 33333 events authored by SERVER_PUB_KEY.

        When received, decrypt the content using CONFIG_AES_KEY. Parse the JSON to get the questions and labels. (Keep this subscription open so live updates to the config update the UI).

    UI: Implement a Tinder-style swipe interface (one card at a time) matching the fetched config.

    Network Logic (Answers):

        On every swipe, create a JSON payload: { sessionId: "[RANDOM_ID]", qIndex: 0, answer: "Left", timestamp: Date.now() }.

        Encrypt this payload using NIP-44, targeting the SERVER_PUB_KEY, signed by the ephemeral client private key.

        Publish to the relay pool.

        Show a completion screen when the question array is exhausted.

Relay Pool Management Requirement:
Implement a robust relay pool connection manager. Hardcode an array of at least 15 public Nostr relays (e.g., wss://relay.damus.io, wss://nos.lol, wss://relay.nostr.band, wss://offchain.pub, etc.). The app should attempt to connect to all, proceed as soon as at least 3 are connected, and broadcast events to all connected relays for maximum redundancy.

Tech Stack Requirements:

    Svelte (Vite)

    nostr-tools (latest v2) for all Nostr key generation, NIP-44 encryption, and relay pooling (SimplePool).
