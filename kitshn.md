# kitshn

This repository deploys with [kitshn 2](https://kit.yarden-zamir.com).

- `kitshn.config.ts` names the app and its deploys: a static site from the committed `site/` folder.
- `.github/workflows/kitshn.yml` calls `kitshn2-deploy.yml`. It signs in to kitshn with GitHub OIDC, so the repo needs no deploy secrets.
- A push to `main` deploys `prod` at `yam2yam.yarden-zamir.com`. Each pull request deploys a `pr-<number>` preview at `yam2yam-pr-<number>.yarden-zamir.com`, and kitshn removes it when the pull request closes.

## This app

- Run `src/build.py` after you change `trek.json`, and commit `site/`. kitshn does not run the build.
- The uploader and `compose.yml` do not run on kitshn 2. `trek.json` has no `"editors"` and no `"auth"`.
