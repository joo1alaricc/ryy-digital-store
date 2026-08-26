const CACHE_NAME = "ryy-store-runtime-v20260826-1";

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
    ])
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Deliberately do not intercept page requests. Cloudflare Pages remains the
// source of truth and the page can update its own live data without a reload.
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return clients.openWindow("/");
    })
  );
});
