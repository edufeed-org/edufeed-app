/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Minimal service worker to enable PWA install prompt.
// No offline caching — just satisfies Chrome's installability requirement.
self.addEventListener('fetch', () => {});
