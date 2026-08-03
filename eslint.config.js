// Static guard for the hand-maintained JS: an undefined identifier once
// shipped inside the comments worker (the LIB ReferenceError that silenced
// @merecat mentions) and no default deno tool catches that class. Run via:
//   make jscheck        (part of make check)
// and never deploy the worker except through:  make worker-deploy
const workerGlobals = {
  Response: 'readonly', Request: 'readonly', Headers: 'readonly', URL: 'readonly',
  fetch: 'readonly', caches: 'readonly', crypto: 'readonly', console: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', TransformStream: 'readonly',
  ReadableStream: 'readonly', WritableStream: 'readonly', FormData: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', atob: 'readonly', btoa: 'readonly',
  AbortController: 'readonly', structuredClone: 'readonly', Blob: 'readonly',
  URLSearchParams: 'readonly', CompressionStream: 'readonly',
  WebSocketPair: 'readonly', WebSocketRequestResponsePair: 'readonly', WebSocket: 'readonly',
  HTMLRewriter: 'readonly',
};
const browserGlobals = {
  window: 'readonly', document: 'readonly', location: 'readonly', history: 'readonly',
  navigator: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
  fetch: 'readonly', console: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  FormData: 'readonly', Headers: 'readonly', Request: 'readonly', Response: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', crypto: 'readonly', alert: 'readonly',
  confirm: 'readonly', prompt: 'readonly', FileReader: 'readonly', Image: 'readonly',
  MouseEvent: 'readonly', matchMedia: 'readonly', getComputedStyle: 'readonly',
  requestAnimationFrame: 'readonly', IntersectionObserver: 'readonly', MutationObserver: 'readonly',
  turnstile: 'readonly', Blob: 'readonly', AbortController: 'readonly', CustomEvent: 'readonly',
  atob: 'readonly', btoa: 'readonly', scrollTo: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly',
  Audio: 'readonly', Event: 'readonly', addEventListener: 'readonly',
  WebSocket: 'readonly', removeEventListener: 'readonly',
  nacl: 'readonly',   // vendored tweetnacl.min.js (E2E DM crypto), loaded on demand
  lamejs: 'readonly', // vendored lamejs.min.js (voice-note MP3 encode), loaded on demand
};
export default [
  // Generated PureScript codegen is never linted (see CLAUDE.md). The
  // hand-written barrel app/core.js is covered by the app/**/*.js block below;
  // FFI .js under purescript/src/ gets its own block when the first one lands
  // (Phase 4+).
  { ignores: ['purescript/output/**'] },
  {
    files: ['comments-worker/src/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: workerGlobals },
    rules: { 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error' },
  },
  {
    files: ['docs/comments.js', 'docs/nav.js', 'docs/deeplink.js', 'docs/flash.js', 'docs/contact.js', 'docs/bible-reader.js', 'docs/away.js', 'docs/index.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: browserGlobals },
    rules: { 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error' },
  },
  // The service worker: its own global set.
  {
    files: ['docs/sw.js'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'script',
      globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly', Promise: 'readonly', console: 'readonly', Response: 'readonly', setTimeout: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error' },
  },
  // The app shell and its Lit components: ES modules, bundled by `make bundle`
  // into the committed app.js (which is generated output, never linted).
  {
    files: ['app/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'module',
      globals: { ...browserGlobals, customElements: 'readonly', DOMParser: 'readonly', Map: 'readonly', Promise: 'readonly', Notification: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error' },
  },
];
