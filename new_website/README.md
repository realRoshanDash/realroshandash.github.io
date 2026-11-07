# Why is this folder here?

The site used to be a VuePress project in this folder, and Netlify's UI build settings still
use `new_website` as the **base directory**. Netlify reads `netlify.toml` from the base
directory, so `new_website/netlify.toml` builds the real Astro project at the repository root
and publishes the result from here.

To retire the shim: Netlify → **Site configuration → Build & deploy → Build settings** →
clear **Base directory** (leave build command / publish directory empty — the root
`netlify.toml` supplies them), trigger a deploy, then delete this folder.
