/*
 * Mochi — where online friends live: your Firebase project.
 *
 * Empty = online friends are unavailable in this build. Either way, Mochi
 * makes no network requests until a person turns online friends on.
 * To use your own server, create a Firebase project (see online/SETUP.md)
 * and paste its two public values here.
 * They are not secrets: Firebase's security rules (online/firestore.rules)
 * are what protect the data.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.onlineConfig = {
    apiKey: 'AIzaSyAB8ZeEVTsHSTPB7iyv-0XMxAig1CSJqVU', // Project settings → General → Web API key
    projectId: 'mochi-f60b2',                       // Project settings → General → Project ID
  };
})();
