# RYY STORE — Manus Visual Merge

This package uses the original Cloudflare RYY STORE as the application engine.
The Manus project is used as the visual/design source only.

- Cloudflare worker/API/KV/config/handlers are retained.
- Existing application JavaScript is not replaced by Manus React logic.
- Manus design CSS and UI source are bundled under assets/manus-design/ for the presentation layer.
- ryy-manus-adapter.css maps the Manus visual language onto the existing Cloudflare HTML selectors.
