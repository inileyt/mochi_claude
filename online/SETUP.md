# Online friends: setting up the server

Mochi's online friends (codes, friend requests, messages, visits, friendship
levels) need a small server so two computers can reach each other. Mochi uses
**Firebase** (Google): free for small use, nothing to run yourself.

Until you do this, online friends stay switched off for everyone using your
copy of Mochi, and Mochi makes no network requests at all.

## 1. Create the project (about 5 minutes)

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. **Add project** → name it (for example `mochi-friends`) → you can turn
   Google Analytics **off** → **Create project**.
3. **Build → Authentication → Get started → Sign-in method → Anonymous →
   Enable → Save.** (Mochi signs people in anonymously: no email, no names
   from Google.)
4. **Build → Firestore Database → Create database** → pick a location near
   your friends → **Start in production mode** → **Create**.

## 2. Put in the security rules

The rules decide who may read and write what (only the two friends see their
messages, a friendship needs an accepted request, and so on). They are in
[`firestore.rules`](firestore.rules).

- Easiest: **Firestore Database → Rules**, replace everything there with the
  contents of `firestore.rules`, then **Publish**.
- Or with the Firebase CLI, from this `online/` folder:

  ```bash
  npx firebase-tools deploy --only firestore:rules --project YOUR-PROJECT-ID
  ```

## 3. Tell Mochi where the server is

**Project settings** (the gear next to *Project Overview*) → **General**:
copy the **Project ID** and the **Web API Key** into
[`../src/online-config.js`](../src/online-config.js):

```js
Mochi.onlineConfig = {
  apiKey: 'AIza…',          // Web API Key
  projectId: 'mochi-friends', // Project ID
};
```

These two values are not secrets (every Firebase web app ships them); the
rules from step 2 are what protect the data. Reload the extension at
`chrome://extensions`, and each person turns online friends on in
**Mochi → Friends → Online friends**.

> No Web API Key shown? Add a web app first: **Project Overview → + Add app →
> Web (`</>`)**, any nickname, no hosting. Then the key appears in
> Project settings.

## 4. Optional: limits and keeping it tidy

- **Budget alert:** the free plan (Spark) can't charge you; it just stops
  when a daily limit is reached. Mochi's use is tiny: a check every 45
  seconds while a tab with Mochi is open and visible, and every 5 seconds
  while a chat is open.
- **Stricter API key:** Google Cloud Console → APIs & Services → Credentials →
  your Browser key → restrict it to the *Identity Toolkit API*, *Token
  Service API* and *Cloud Firestore API*.

## Test it locally (no Google account needed)

With [Firebase CLI](https://firebase.google.com/docs/cli) and Java installed:

```bash
cd online
npx firebase-tools emulators:exec --project demo-mochi "node ../test/online-rules.emulator.js"
```

This runs the rules and the client against local emulators: three users,
requests, friendships, messages, cheating attempts, blocking and
"delete everything".
