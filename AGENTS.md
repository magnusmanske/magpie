
# Hard rules
- **Do not mention AI agents in commit messages.**
- **`git commit` is pre-authorized; `git push` is not.** Use sensible commit groupings for larger changes.
- ** Keep security in mind**, especially if this is a web-facing product.
- Always keep **code readability and long-term maintenance** in mind. Humans work on this code as well, so keep code and comments succinct and clear.
- **Keep the code simple** and elegant.
- **Aim to keep code small** where possible.
- Adhere to **SOLID and DRY principles**.
- Use **best practices** and **language standards**.
- **Take advantage of the Rust language**. "Parse, don't validate" etc.
- **No unsafe code**. Only use safe Rust.
- **Write code that does not panic**. Avoid panics in production code. Return proper `Result` errors instead.
- Prefer a **parse, don't validate** approach. A `struct` should always be valid, ideally.
- **Write tests** where it makes sense. Aim to keep test coverage high and tests simple.
- **Warn me if you think what I ask of you is a bad idea.** Or just window dressing, with no improvement of functionality, UX, or code readability. Be honest.
- **Fix clippy warnings**, even pre-existing ones.

# Continuation notes

This file is also the hand-off document for the next person (or model) working
on `magpie`. Read `README.md` first; this section records what is done, what is
deliberately not, and where the sharp edges are.

## What exists

A working Rust/axum service that replaces the four PHP transfer tools:

- `src/main.rs` — CLI, bind, restart loop, graceful shutdown.
- `src/config.rs` — JSON config; `config.json.template` is the shape.
- `src/state.rs` — shared state: Wikimedia client, SSRF-guarded download
  client, Geograph client, OAuth consumer, `CommonsClient`, optional replicas,
  cookie key, parsed CommonsHelper data.
- `src/web/` — router, PHP-style `$_REQUEST` merging, JSONP, embedded assets.
- `src/api/` — one OAuth login and the legacy upload API. Actions:
  `authorize`, `logout`, `checkauth`, `get_rights`, `upload`,
  `upload_from_url`, `setpagetext`, `sdc`, `get_flickr_key`, `flickr_api`,
  `flickr_thumb`, `check_existing_commons_filenames`,
  `check_flickr_files_in_commons`.
  The write guard, warning policy, and response shape mirror
  `magnustools/public_html/oauth_uploader.php`.
- `src/api/flickr.rs` — replica SQL for `page`, `logging`, `externallinks`;
  API fallback for the name checks.
- `src/geograph.rs` — allowlisted fetch of the Geograph photo/reuse pages.
- `src/commonshelper/` — source page fetch, embedded data, and a close port of
  `get_upload_text()`.
- `src/download.rs` — SSRF guard + size limit + temporary file.
- `assets/` — Vue 2.6 + Vue Router 3, no build step, plain ES6. Views:
  `home`, `flickr2commons`, `url2commons`, `geograph2commons`,
  `commonshelper`. Flickr support lives in `assets/js/flickr.js` (API and
  flinfo), `assets/js/commons.js` (filename/TitleBlacklist checks),
  `assets/js/flickr-file.js` (per-photo row) and
  `assets/flickr2commons.css`.

`mediawiki_upload` (the sibling crate) must be published or switched to a git
dependency before a remote Toolforge build; it is a path dependency today.

## Contracts to preserve

* `/api.php` and `/api` are the same handler. `/{tool}/api.php` and
  `/{tool}/api` reach it too, because old front-ends call `api.php` relative to
  their own directory.
* `botmode=1` means "answer as JSON/JSONP". `callback=…` is validated by
  `wikimisc::server::jsonp`; dotted jQuery names are allowed.
* Upload responses keep `{error, data, res, result, jle, j}`. `res.upload` is
  synthesised from `mediawiki_upload` (old clients read
  `res.upload.warnings.duplicate[0]`).
* `checkauth` uses `data`; `get_rights` uses `result`. Both call the same
  `meta=userinfo&uiprop=blockinfo|groups|rights` query and require
  autoconfirmed.
* The OAuth callback is `{public_url}/api.php` and must match the consumer
  registration exactly. Never derive it from request headers.
* The login cookie is one encrypted cookie, `magpie_auth`, path `/`.
* Writes require `is_same_origin` (the browser sends `sec-fetch-site`).
* Tool addresses: `/{tool}/` serves the SPA; `/{tool}`, `/{tool}.php`, and
  `/{tool}/index.php` permanently redirect there, preserving the query.
* Geograph's `g2c` alias is served directly, not redirected: the old
  `main.js` calls `g2c.php` and expects JSON.
* CommonsHelper's `{{BotMoveToCommons}}` insertion, the
  `{{NowCommons}}`/`{{subst:ncd}}` snippets, and the delete link are in the
  front-end, because they depend on the user's groups. Keep the same strings.

## Data provenance

`data/*.json` is extracted from the PHP sources; do not hand-edit without
checking the originals:

* `data/common.json` ← `commonshelper/public_html/common_data.php`.
  Keys: `license_indicators`, `language_image_licenses`, `image_aliases`,
  `ignore_templates`, `good_templates`, `disambigs`, `evil_templates`,
  `language_codes`, `ansi2ascii`.
* `data/commonshelper.json` ← `common_data.php`, `transwiki_data.php`, and
  `index.php` (the runtime value of `$info_templates` is the small de/fi map,
  not the list from `transwiki_data.php`; the file stores
  `["Information","Tiedoston tiedot"]` accordingly).
* `data/transwiki.json` ← `transwiki_data.php`, as
  `{language: {local template: Commons template}}`.

`Catalog::load()` parses all three at start-up and fails the process on a bad
file, so a broken dictionary cannot become a per-request error.

## Port decisions and quirks

* The CommonsHelper text builder follows the PHP control flow, including
  questionable bits (`first_date`/`last_date` order, `&times;&times;` in the
  history table, `str_ireplace` semantics). Tests pin the building blocks,
  not whole pages yet. If the PHP tool is still live, capture real
  input/output pairs before changing behaviour.
* `get_commons_template` preserves the PHP fallback: try the lower-case first
  letter, then the upper-case one, then return the upper-first name. This is
  why `commons_template("en","pd-self")` is `Pd-self`, not `PD-self`; the
  good-template check is case-insensitive and still works.
* License templates are checked for existence on Commons in batches of 50;
  only existing templates appear in the license section. Missing ones become
  the HTML comment listing them.
* The service caps downloads at `max_upload_bytes` (5 GiB) and chunks uploads
  over `chunk_size` (5 MiB). `mediawiki_upload` adds the wiki's minimum chunk
  size concerns.
* The download client is SSRF-guarded; the upload client is
  `mediawiki_upload`'s own (no redirects, no overall timeout). Do not reuse the
  download client for uploads: its 300 s timeout would abort large files.
* The Flickr "on Commons" check needs the replica; without one it reports the
  database as unavailable. Do not silently return "not on Commons" — that
  would encourage duplicate uploads.
* The Flickr batch view is a port of the old `main-page.js` / `flickr-file.js`:
  listings, filename and TitleBlacklist warnings, bulk selection, prefix and
  suffix, find/replace, category suggestions, PD rationale and the concurrent
  transfer queue. Licence IDs 4–5 and 7–12 are accepted; names and templates
  match the old `LICENSE_NAMES`/`LICENSE_TEMPLATES`.
* Legacy Flickr deep links are query parameters (`photoid`, `userid`,
  `photoset`, `group`, `tags`, `maxpics`) on `/flickr2commons/`, and the
  hash routes (`#/photo/…`, `#/user/…`, `#/photoset/…`, `#/group/…`,
  `#/url/…`) with `tag`/`max_pictures` are parsed too. Tool translation and
  `logger.php` pings are not ported.
* URL2Commons keeps the PHP flow: `urls`/`desc`/`simulate`/`run` can seed the
  page (query or fragment), Simulate validates extensions, duplicate URLs and
  filenames, and Commons existence, and the rendered description preview is
  available before uploading.
* The interface is English-only. CommonsHelper's `interface=` localisation
  and Flickr2Commons' translatewiki language selector are deliberately not
  ported.
* Information templates and category suggestions come from FLinfo in the
  browser, with a local Information-template fallback. The per-file name check
  uses the Commons API directly; the bulk filename check uses `/api.php`.
* Flickr reads go through `action=flickr_api`, because Toolforge's CSP does
  not allow `api.flickr.com`. The proxy allows only the read methods the
  interface uses and supplies the key server-side; `get_flickr_key` remains
  for old clients. Thumbnails use `action=flickr_thumb`, which only fetches
  HTTPS images from `*.staticflickr.com`. Do not call Flickr from the browser.
* The login cookie is `Secure` and built by `wikimisc::oauth1::Session`. Local
  login tests therefore need HTTPS (a tunnel is enough); plain HTTP will
  appear logged out no matter how successful the OAuth handshake was.
* Write actions use `is_same_origin`. Browser `fetch` is fine; a script or bot
  calling `/api.php` directly must send `Sec-Fetch-Site`, `Origin`, or
  `Referer`, as the old uploader also required.
* CommonsHelper defaults an empty `language` to `en`, so the old
  `language=`/`project=wikisource` case is not supported. Other wikis are
  limited to what `wikimisc::Wiki` knows (Wikimedia projects and the special
  wikis).
* License: the four PHP tools are GPL-3.0, so the port and its extracted data
  are GPL-3.0-or-later (`COPYING`). Do not relicense the extracted dictionaries
  as MIT/Apache just because `mediawiki_upload` is permissively licensed.

## Likely next work

1. Add front-end tests for the ported Flickr helpers (`commons.js` filename
   states, `flickr.js` listing/description) and capture a flinfo response as a
   fixture.
2. Capture CommonsHelper PHP output for representative files and add golden
   tests; fix discrepancies that are real bugs rather than quirks.
3. Add usage logging if the dashboard needs it.
4. Wire `mediawiki_upload`'s `toolforge-replicas` feature for size/SHA-1
   pre-checks, if a "check before upload" control is added.
5. Publish `mediawiki_upload` or switch the dependency to git before the remote
   build.

## Environment / tooling pitfalls

* The development checkout lives at `~/rust/magpie`; the sibling crate at
  `~/rust/mediawiki_upload`. `mediawiki_upload` is the only workspace root the
  editor tools accept, so during development it contains untracked symlinks
  (`.magpie_link`, `.ref_*`) for reading and writing. Remove them before
  committing `mediawiki_upload`.
* Build from the repository root or pass an **absolute**
  `--manifest-path /Users/…/magpie/Cargo.toml`; a relative manifest path
  through the symlink resolves the path dependency wrongly.
* `include_dir!`/`include_str!` need a rebuild after adding files under
  `assets/` or `data/`; `build.rs` prints `rerun-if-changed` for both, and
  `touch src/main.rs` is a reliable nudge.
* Vue templates cannot see globals: helper calls must be methods or computed
  properties, not `Magpie.x(...)` inside the template.
* The front-end has no build step. Keep it ES6 that runs in current browsers;
  do not introduce JSX, TypeScript, or a bundler without a strong reason.
* Do not add an HTML parser crate for Geograph. The browser's `DOMParser`
  handles it; the Rust side only proxies the pages.
* The old PHP checkout is not runnable locally (`require 'php/common.php'`
  depends on a symlink that is not in the checkout). Use the files as
  reference only.
