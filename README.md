# roshandash.com

Source for [roshandash.com](https://roshandash.com), the personal site of Roshan Dash, a software
engineer in Singapore. It has long-form writing, short notes, and a contact card that is only
shown after a quick proof-of-work captcha.

[![CI](https://github.com/roshandash411/roshandash411.github.io/actions/workflows/ci.yml/badge.svg)](https://github.com/roshandash411/roshandash411.github.io/actions/workflows/ci.yml)

## Stack

- **Astro 7**, static output. Markdown goes through Sätteri, Astro's built-in pipeline, with
  callouts, Expressive Code for code blocks, and MDX.
- **Content collections** (`src/content.config.ts`): `blog` and `notes` (plus a dormant
  `trades` collection, see below). The build checks every entry against its schema and fails if
  one doesn't match.
- **Pagefind** search, RSS feeds and a sitemap.
- **Sveltia CMS** at [`/admin/`](https://roshandash.com/admin/), which commits to this repo.
- **Hosting**: GitHub Pages, deployed by GitHub Actions on every push to `master`. DNS is at
  Cloudflare.
- **Node 24 LTS** (see `.nvmrc`). The minimum is Node 22.23.4.

## Local development

```sh
nvm use            # Node 24, from .nvmrc
npm ci
npm run dev        # http://localhost:4321  (CMS: /admin/index.html)
npm run build      # astro build, the Pagefind index → dist/, then the content guard
npm run preview    # serve dist/
npm test           # unit tests (node --test)
npm run check      # astro check: types and content
```

## Publishing

Every route ends in the same place: a Markdown file under `src/content/` committed to `master`.
GitHub Actions builds and deploys each commit to roshandash.com within a couple of minutes.

### A. The CMS at /admin

1. Create a token on GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
   - Resource owner: `roshandash411`
   - Repository access: **Only select repositories** → `roshandash411/roshandash411.github.io`
   - Repository permissions: **Contents → Read and write**. GitHub adds *Metadata → Read-only*
     on its own. Grant nothing else.
   - Expiration: 90 days is a sensible default. Make a new token when it expires.
2. Open <https://roshandash.com/admin/>, choose **Sign In Using Access Token** and paste it.
3. New entries start as drafts. To publish, switch **Draft** off and save. Each save is a commit.

The token is kept in that browser's local storage, so sign out on shared computers. Images
uploaded to an entry are saved in the entry's folder. JPEG and HEIC uploads are converted to
WebP (2400 px max); PNGs are kept as they are. Works from a phone too.

**Updating the CMS.** `public/admin/index.html` loads one exact Sveltia CMS version from unpkg,
with a Subresource Integrity hash, so browsers refuse the script if unpkg ever serves different
bytes. To upgrade ([release notes](https://github.com/sveltia/sveltia-cms/releases)), put the new
version in the `src` URL and the new file's hash in `integrity`:

```sh
v=$(npm view @sveltia/cms version)   # the latest version, e.g. 0.261.0
curl -fsSL "https://unpkg.com/@sveltia/cms@$v/dist/sveltia-cms.js" | openssl dgst -sha384 -binary | openssl base64 -A
# → integrity="sha384-<that output>"
```

Then run `npm run build && npm run preview` and check that `/admin/` still shows the sign-in
screen. A hash that doesn't match leaves the page blank, with an integrity error in the browser
console.

### B. Scaffold from the terminal

```sh
npm run new:post -- "Why I moved this site to Astro"
npm run new:note -- "Optional title"
```

Each command creates `src/content/<collection>/<slug>/index.md` as a draft, with today's date
(Singapore time) and a unique slug. Replace every `TODO`, put images in the same folder, set
`draft: false`, then:

```sh
git add src/content && git commit -m "content: …" && git push
```

### C. Write the file yourself

Use `src/content/<collection>/<slug>/index.md`, with images next to it, or a single
`<slug>.md` / `.mdx` file. The folder or file name becomes the URL slug. The CMS only lists
folder entries, so edit single files and MDX in git.

## Front matter

Dates are `YYYY-MM-DD`; a note's `published` can include a time. Images are file names in the
entry's folder (`cover: cover.webp`).

### Writing: `src/content/blog/`

| Field | Type | Notes |
| --- | --- | --- |
| `title` | text, ≤ 140 | Required. |
| `description` | text, ≤ 300 | Required. Shown in lists, the feed and link previews. |
| `published` | date | Required. |
| `updated` | date | Optional. |
| `tags` | list | Defaults to `[]`. |
| `cover`, `coverAlt` | image, text | Optional cover image and its alt text. |
| `featured` | boolean | Defaults to `false`. |
| `archived` | boolean | Optional. Marks a post restored from the old site (“From the archive”). Unset, posts published before 2025 count as archived. |
| `draft` | boolean | Defaults to `false`. New entries from the CMS and the scaffolds start as `true`. |

```yaml
---
title: Designing idempotent consumers
description: Exactly-once is a lie; idempotency keys and a dedupe table are the truth.
published: 2026-11-07
tags: [distributed-systems, kafka]
cover: cover.webp
coverAlt: Sequence diagram of a retried message
draft: false
---
```

### Notes: `src/content/notes/`

| Field | Type | Notes |
| --- | --- | --- |
| `title` | text, ≤ 140 | Optional. |
| `published` | date or date-time | Required, e.g. `2026-11-07T15:32:00+08:00`. Keep the offset. |
| `tags` | list | Defaults to `[]`. |
| `image`, `imageAlt` | image, text | Optional. |
| `link` | URL | The page the note is about, if any. |
| `draft` | boolean | As for posts. |

Sections without published entries (notes, trade ideas) generate no pages until the first entry
is published. Even then neither joins the header: notes get a "Notes" chip in the Writing index,
trade ideas a link in the footer index.

<details>
<summary><strong>Trade ideas (dormant): <code>src/content/trades/</code></strong></summary>

Hidden on the site unless entries are published. Scaffold with `npm run new:trade -- TICKER long|short`.
The CMS doesn't list them: `public/admin/config.yml` is served publicly, so the collection stays out
of it (and the content guard below fails the build on trading words) until you decide to publish trades.
Prices are per share, in the instrument's quote currency.

| Field | Type | Notes |
| --- | --- | --- |
| `title`, `summary` | text, ≤ 140 / ≤ 300 | Required. |
| `ticker` | 1–15 of `A–Z 0–9 . - ^ = !` | Required. Upper-cased automatically. |
| `exchange`, `tvSymbol` | text | `EXCHANGE:TICKER` is the chart symbol unless `tvSymbol` overrides it. |
| `direction` | `long` or `short` | Required. |
| `setup`, `timeframe`, `status` | text / enum | `status`: watching → active → closed / stopped, or invalidated. |
| `published`, `updated`, `triggered`, `closed` | date | `published` is required. |
| `entry`, `stop`, `targets` | numbers > 0 | Long: stop below entry, targets above. Short: the reverse. |
| `exit` | number | Required once `closed` or `stopped`. |
| `conviction`, `tags`, `chart`, `chartAlt`, `updates`, `draft` | — | Optional. |

Results are in R: long `(exit − entry) / (entry − stop)`, short `(entry − exit) / (stop − entry)`.

</details>

## Markdown extras

**Callouts** use Obsidian's syntax, and GitHub-style `> [!NOTE]` works too. The types are note,
tip, info, warning, danger, success, question, failure, bug, example, quote, abstract and todo.
Aliases such as `important` and `caution` also work.

```md
> [!TIP] Optional custom title
> Text of the callout.

> [!WARNING]- Collapsed until clicked (use + to start it open)
> Hidden text.
```

**Code blocks** are rendered by Expressive Code. Add a title with `` ```ts title="example.ts" ``.

**Images** go in the entry's folder and are referenced by file name: `![Alt text](photo.webp)`.
Astro resizes them at build time. Convert HEIC photos before you commit them, because the build
can't read HEIC (the CMS converts them on upload).

## Drafts

Entries with `draft: true` are left out of production builds: no page, and no place in lists,
the feed, the sitemap or search. `npm run dev` always shows them. To check drafts in a built
site, build with `SHOW_DRAFTS=1 npm run build` (or put `SHOW_DRAFTS=1` in `.env`, see
`.env.example`), then run `npm run preview`. Never set it in CI.

## Contact card

Private contact details are never committed in plain text. They live in `contact.local.json`,
which is gitignored, and are sealed into `src/data/contact.sealed.json`. That file is decrypted
in the browser only after the visitor's browser solves a short proof-of-work (about a second).

```json
{
  "email": "…",
  "phone": "…",
  "telegram": "…",
  "whatsapp": "…",
  "signal": "…",
  "calendar": "…",
  "note": "…"
}
```

```sh
npm run seal-contact     # reads contact.local.json, rewrites src/data/contact.sealed.json
git add src/data/contact.sealed.json && git commit -m "contact: update card" && git push
```

`scripts/seal-contact.mjs` documents the format of each field and the difficulty calibration.

## Deployment

- **GitHub Actions** (`.github/workflows/ci.yml`) runs the tests, `astro check` and the build on
  every push and pull request. On `master` it deploys `dist/` to **GitHub Pages**
  (*Settings → Pages → Source: GitHub Actions*, custom domain `roshandash.com`, HTTPS enforced).
  Rerun a deploy from the Actions tab if needed.
- **DNS** (Cloudflare): `roshandash.com` and `www` are CNAMEs to `roshandash411.github.io`.
  Leave the MX/TXT records alone — they carry email.
- **Old URLs** from the 2021 site redirect via small static pages in `public/blog/`.

`public/.well-known/security.txt` expires after a year. CI starts warning 30 days before
the date, so move `Expires` ahead when that happens.

**Content-Security-Policy.** GitHub Pages can't send response headers, so every page Astro
builds carries its policy as a `<meta http-equiv="Content-Security-Policy">`, placed straight after
`<meta charset>` so it covers everything after it. `src/integrations/csp.ts` adds it at the end of
`astro build`: it hashes exactly the inline scripts (the theme bootstrap among them), `<style>`
elements and `style=""` attributes each page has, so no directive needs `'unsafe-inline'`, and the
hashes can't go stale. The rest is fixed: `default-src 'self'`, `script-src 'self'
'wasm-unsafe-eval'` (Pagefind), `img-src 'self' data:`, `font-src`/`connect-src`/`worker-src
'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self' mailto:`. A component that
needs more declares it with a `data-csp` attribute, which only widens the pages it is on (the
dormant trade pages' click-to-load chart). Files in `public/` (the CMS, old-URL redirects) are
left alone. `npm run dev` has no policy; check changes with `npm run build && npm run preview`.
A meta tag can't set `frame-ancestors` or reporting, so those need a host that sends headers.

**Content guard.** `npm run build` ends with `scripts/content-guard.mjs`, which scans every text
file in `dist/` and `public/` (HTML, feeds, YAML, JSON, JS…) and fails the build on trading or
market words, the private project, a plaintext address on the domain, or a `mailto:` link in markup.
Run it alone with `npm run guard`. To publish something it blocks, change its rules in the same commit.

## Repository layout

```text
src/content/            blog/, notes/ (and dormant trades/): one folder per entry, images alongside
src/content.config.ts   schemas for the collections
src/data/site.ts        name, URL, socials, navigation
src/pages/              routes (including robots.txt.ts and the RSS feeds)
public/                 copied as-is: admin/ (CMS), .well-known/, old-URL redirects
src/integrations/       build steps: csp.ts (per-page Content-Security-Policy), prune-unused-css.ts
scripts/                new-entry.mjs (scaffolds), seal-contact.mjs (contact card), content-guard.mjs
```

## History

The 2021 VuePress site is kept at the tag `legacy-vuepress` (`git checkout legacy-vuepress`).
Its three posts were restored as drafts in `src/content/blog/`. Hosting moved from Netlify to
GitHub Pages in November 2026.
