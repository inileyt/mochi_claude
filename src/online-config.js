/*
 * Mochi — where online friends live: your Firebase project.
 *
 * Empty = online friends are off for everyone using this build (Mochi then
 * makes no network requests at all). To turn them on, create a Firebase
 * project (see online/SETUP.md) and paste its two public values here.
 * They are not secrets: Firebase's security rules (online/firestore.rules)
 * are what protect the data.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.onlineConfig = {
    apiKey: '',      // Project settings → General → Web API key
    projectId: '',   // Project settings → General → Project ID
  };
})();
