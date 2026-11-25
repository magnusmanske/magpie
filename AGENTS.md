
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

`mediawiki_upload` (the sibling crate) is a published dependency (0.1.2), so a
remote buildservice build works; bump its version in `Cargo.toml` after changing
it locally, then publish it before deploying.

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
* Uploads accept an optional `tags` field (`|`- or `,`-separated). Flickr sends
  `flickr2commons`; `mediawiki_upload` adds the tag to both the initial and
  stashed upload requests.
* Tool addresses: `/{tool}/` serves the SPA; `/{tool}`, `/{tool}.php`, and
  `/{tool}/index.php` permanently redirect there, preserving the query.
* Geograph's `g2c` alias is served directly, not redirected: the old
  `main.js` calls `g2c.php` and expects JSON.
* `/url2commons/` also accepts a form POST for `urls`, `desc`, `simulate`,
  `run`, and `interface_language`. The values reach the SPA through the
  one-shot, HTML-escaped `window.__MAGPIE_BOOTSTRAP__`; keep the GET/hash path.
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
* `data/*.json` does not contain translations. Interface strings live only
  in the Tooltranslate `magpie` tool; `scripts/build_i18n.py` reads the
  published data, adds new keys, and emits import SQL. Do not copy translation
  snapshots into the repository.

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
* The CommonsHelper view has an extra-categories field; `addExtraCategories`
  appends `[[Category:…]]` to the translated description before upload or
  manual copy. It runs on translation, so it does not duplicate on upload.
* The CommonsHelper batch section translates one file per line with
  concurrency 3, resolves collisions with `freeCommonsName`, allows per-row
  editing, then uploads ready rows. It reuses `translateFile` and
  `upload_from_url`; keep the single-file flow working.
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
  `#/url/…`) with `tag`/`max_pictures` are parsed too. `logger.php` pings are
  replaced by `wikimisc` telemetry. `smartDetect` also accepts a bare
  `/photos/<alias>/` or `/people/<alias>/` URL as a user.
* The Flickr transfer bar has a bulk "retry failed" action (`retryFailed`
  resets `ERROR` rows to `READY`), and the description can be wrapped in
  `{{<language>|1=…}}`; both run through the same queue in `runOneTransfer`.
* Videos are detected from `media`/`originalformat` and skipped before a
  transfer row is created; `skipped_video` feeds `f2c_video_skipped`. Full
  video upload is not implemented: Flickr's public API exposes only player/page
  URLs for videos (`getSizes` entries with `media=video` are not files), and
  `originalformat` is the poster frame. It would need undocumented endpoints.
* `checkFlinfoPreflight` runs flinfo for user/photoset/photo sources and shows
  a warning with the COM:QFI link before per-file work; groups are skipped
  because they can have many owners.
* Account listings use `flickr.people.getPublicPhotos` unless a tag filter is
  set (then `flickr.photos.search`); both methods are in the proxy allowlist.
* `wikitextDate` turns `ca.`/`c.`/`circa`/`about` plus a four-digit year into
  `{{other date|ca|YYYY}}` in both the flinfo and fallback templates.
* Geograph's `reuse.php` is behind a Cloudflare challenge (HTTP 403) for normal
  clients. The proxy also fetches
  `api.geograph.org.uk/api/photo/<id>?format=json`; the view builds an
  `{{Information}}`/`{{geograph}}` description from it when the reuse page is
  missing. Image URLs come from an `about` value that is actually an image,
  the API (`imgserver` + `image`), or the displayed `#mainphoto` image, never
  from a synthesised `reuse.php` URL. `geo.hlipp.de` and `geo-en.hlipp.de`
  serve the same photo/reuse markup and are both supported.
* URL2Commons keeps the PHP flow: `urls`/`desc`/`simulate`/`run` can seed the
  page (query, fragment, or form POST), Simulate validates extensions,
  duplicate URLs and filenames, and Commons existence, and the rendered
  description preview is available before uploading.
* The interface is translated through Tooltranslate. The `magpie` tool holds
  all strings; the browser fetches the published snapshots, and missing keys
  fall back to English. `scripts/build_i18n.py` documents how the import SQL
  is made. `interface_language=…` and the `interface_language` cookie select
  the language. No translation data is stored in this repository.
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

## Deployment

`magpie` runs from the buildservice `Procfile`; `wikimisc` telemetry reads
`$DASHBOARD_TOKEN`. The four old subdomains are Toolforge redirect containers
(`scripts/redirect_tool.sh`, `REDIRECT_HOST=magpie.toolforge.org`,
`REDIRECT_PATH=/<tool>%s`).

`%s` keeps the request path on purpose: `/api.php`, `/index.php` and
`g2c.php` must still resolve under `/{tool}/`. A fixed `REDIRECT_PATH` folds
them into the tool page, which silently breaks the API on the old domains.

Use `toolforge envvars create` to change a value; it also updates. Never call
`toolforge envvars delete` from a script that arrives on stdin — it asks for
confirmation and swallows the rest of the script.

Tooltranslate updates: `scripts/build_i18n.py` emits SQL. Import it with the
`tooltranslate` tool account (`become tooltranslate`; database
`s53069__tooltranslate_p`). The web `update_json` mode requires OAuth and CSRF,
so regenerate the published JSON from a pod with a small CLI script that reuses
`generateJSON`/`generateToolinfo` from `public_html/api.php`; the bastion has no
PHP, so use `kubectl exec` into one of the tool's pods.

## Likely next work

1. Deploy the change-tag support (`mediawiki_upload` 0.1.2 is published and
   locked). Full video upload (#97) needs Flickr's undocumented video-file
   endpoints; keep screening until then.
2. CommonsHelper #10 (replace file usages after a rename) and #3 (non-license
   template mapping).
3. Verify the deployed `flickr.people.getPublicPhotos` path for #10 and reopen
   if accounts still miss files.
4. Add front-end tests for the ported Flickr helpers (`commons.js` filename
   states, `flickr.js` listing/description) and capture a flinfo response as a
   fixture.
5. Capture CommonsHelper PHP output for representative files and add golden
   tests; fix discrepancies that are real bugs rather than quirks.
6. Add usage logging if the dashboard needs it.
7. Wire `mediawiki_upload`'s `toolforge-replicas` feature for size/SHA-1
   pre-checks, if a "check before upload" control is added.

## Environment / tooling pitfalls

* The development checkout lives at `~/rust/magpie`; the sibling crate at
  `~/rust/mediawiki_upload`. Only `magpie` is a workspace root for the editor
  tools, so during development the sibling crate holds an untracked
  `.magpie_link` symlink. Remove it before committing `mediawiki_upload`.
* To test magpie against an unpublished sibling version, use a temporary cargo
  patch, e.g.
  `cargo test --config 'patch.crates-io.mediawiki_upload.path="/abs/path"'`,
  and restore `Cargo.lock` afterwards. The buildservice needs the crates.io
  release.
* Build from the repository root or pass an **absolute**
  `--manifest-path /Users/…/magpie/Cargo.toml`; a relative manifest path
  through the symlink confuses cargo.
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
