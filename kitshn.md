# KitSHn Recipe

This repository deploys a trek dossier site with KitSHn. The public hostname comes from
`trek.json` (`hostname`); `src/build.py` renders `Caddyfile.j2` from it.

- Pushes to `main` deploy `prod`. Pull requests deploy to `pr.<number>.<hostname>`.
- The site is static. A Caddy container serves `site/` and listens on the KitSHn Unix socket
  (`container/Caddyfile`). The host Caddy routes the hostname to that socket (`Caddyfile.j2`).
- No persistent data, no secrets beyond `KITSHN_VPS_HOST` and `KITSHN_SSH_KEY`.

## Files

- `site/`: the built page, `map.js`, the generated `sw.js`, the GPX, `maps/` and `vendor/`.
- `.kitshn.yaml`, `.github/workflows/kitshn.yml`, `compose.yml`, `Caddyfile.j2`, `Dockerfile`.
