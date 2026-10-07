// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  /** package.json version, injected by the `define` in vite.config.js. */
  const __APP_VERSION__: string;

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
