# KitSHn Recipe

This repository deploys the Sea to Sea site to `yam2yam.yarden-zamir.com` with KitSHn. The hostname comes from `trek.json` (`hostname`), and `src/build.py` renders `Caddyfile.j2` from it.

- Pushes to `main` deploy `prod`. Pull requests deploy to `pr-<number>.yam2yam.yarden-zamir.com`.
- A Caddy container serves `site/` and listens on the KitSHn Unix socket (`container/Caddyfile`). The host Caddy routes the hostname to that socket (`Caddyfile.j2`).
- The `uploader` container from the template also runs, with its `logdata` volume. It stays empty until the trek has a trip log.
- There are no secrets beyond `KITSHN_VPS_HOST` and `KITSHN_SSH_KEY`. `trek.json` has no `"editors"`, so the editing routes are closed.

## Files

- `site/`: the built page, the scripts, the generated `sw.js`, the GPX, `maps/` and `vendor/`.
- `.kitshn.yaml`, `.github/workflows/kitshn.yml`, `compose.yml`, `compose.override.yml`, `Caddyfile.j2`, `Dockerfile`: the recipe.
