import { defineApp } from "kitshn";

// kitshn 2 (https://kit.yarden-zamir.com): a static site from the built `site` folder, public like before.
// The trip-log uploader of KitSHn 1 is not part of it.
export default defineApp({
  static: { output: "site" },
  deploy: [
    { on: "push", branch: "main", name: "prod", startsIn: "Everyone" },
    { on: "pull_request", name: "pr-{pr}", ephemeral: true },
  ],
});
