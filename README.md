# magpie

One Toolforge service that moves files from somewhere else to Wikimedia
Commons. It replaces four PHP tools with one Rust/axum backend and one Vue 2
front-end.

The ported tools and their dictionaries are GPL-3.0-or-later; see `COPYING`.

| Old tool | Old source | New path |
|---|---|---|
| Flickr2Commons | `flickr2commons/public_html/` | `/flickr2commons/` |
| Url2Commons | `url2commons/public_html/` | `/url2commons/` |
| Geograph2Commons | `geograph2commons/public_html/` | `/geograph2commons/` |
| CommonsHelper | `commonshelper/public_html/` | `/commonshelper/` |

The old `.php` addresses still resolve: a tool page by a permanent redirect
(308, query string and POST body included), a tool's `api.php` directly to the
shared upload API. The four old subdomains can forward here with Toolforge's
redirect container; see [Deployment](#deployment).

## Why this is feasible, and why it helps

All four PHP tools already share one upload path: `Widar` in the browser
front-ends calls a per-tool `api.php` for OAuth, then
`magnustools/public_html/oauth_uploader.php` (or `upload_from_url.php`) for the
actual `action=upload`. That contract is small and well defined, and the
[`mediawiki_upload`](../mediawiki_upload) crate already implements it in Rust,
including OAuth 1.0a signing, warning/filekey handling, and chunked uploads.
The remaining work is tool-specific input and description generation, not
upload plumbing.

The gain is not only "one language":

* **One login.** One OAuth consumer, one cookie, one login page for all tools.
  Users no longer log in four times.
* **One uploader.** Warnings, duplicates, chunked large files, and errors are
  handled once, with tests.
* **One front-end.** Shared URL parsing, upload queue, progress display, and
  Commons link helpers; the views stay small.
* **Commons-aware checks.** On Toolforge the Flickr duplicate check uses the
  `externallinks` index in the wiki replicas; file-size and SHA-1 checks are
  available through `mediawiki_upload`'s `wikimedia` feature.
* **A maintenance path.** The PHP tools currently carry 50+ open issues between
  them. The Rust implementation is typed, tested, and easy to redeploy.

CommonsHelper is the only substantial port: it translates descriptions and
license templates. Its data is extracted from the PHP tool verbatim
(`data/*.json`) and the text builder follows the PHP control flow closely; see
[CommonsHelper](#commonshelper).

## Running

```sh
cargo run -- --config config.json
```

`config.json` is not committed; start from `config.json.template`. Relative
paths (`oauth`, `replica_credentials`, `flickr_key_file`) are resolved against
the config file's directory.

For local work without credentials the service still starts: OAuth is simply
unavailable, and the front-end says so. A missing `replica.my.cnf` disables the
Flickr "already on Commons" check and makes the file-name check fall back to
the Commons API.

## Architecture

| Module | Responsibility |
|---|---|
| `src/main.rs` | CLI (`--config`, `$PORT`), bind, restart loop, graceful shutdown |
| `src/config.rs` | typed JSON config; see `config.json.template` |
| `src/state.rs` | `AppState`: HTTP clients, OAuth consumer, Commons checker, replicas, parsed data |
| `src/web/` | router, PHP-style request parameters, JSON/JSONP, embedded front-end |
| `src/api/` | shared upload API (`/api.php`), OAuth login, login check, edits, uploads |
| `src/api/flickr.rs` | Flickr API key, existing file names, Flickr-photo→Commons-file mapping |
| `src/geograph.rs` | `g2c.php` proxy: reads the Geograph photo and reuse pages |
| `src/commonshelper/` | source file info, embedded dictionaries, `get_upload_text()` port |
| `src/download.rs` | SSRF-guarded, size-limited source download |
| `assets/` | Vue 2 application, built into the binary |
| `data/` | dictionaries extracted from the PHP tools |

### The upload API

`/api.php` and `/api` are the same handler, kept compatible with
`oauth_uploader.php`. Every old tool's `/api.php` also reaches it.

Request parameters (`GET` or form `POST`):

| Name | Meaning |
|---|---|
| `action` | `checkauth`, `get_rights`, `authorize`, `logout`, `upload`, `upload_from_url`, `setpagetext`, `sdc`, `get_flickr_key`, `check_existing_commons_filenames`, `check_flickr_files_in_commons` |
| `botmode` | any non-empty value asks for a JSON/JSONP answer |
| `callback` | JSONP callback name (validated; dotted paths allowed) |
| `site` | wiki domain, default `commons.wikimedia.org` |
| `url`, `newfile`, `desc`, `comment` | upload source and page text |
| `ignorewarnings`, `blockwarnings` | warning policy, as in the old uploader |
| `page`, `text` | `setpagetext` |
| `params` | JSON object for `sdc` |
| `data`, `filenames` | JSON inputs for the Flickr checks |

The response keeps the old shape:

```json
{"error":"OK|message","data":[],"res":{},"result":{}}
```

`res.upload` is synthesised from `mediawiki_upload`'s result or warning
failure, so old clients that read `res.upload.warnings.duplicate[0]` still work.

Writes (`upload`, `upload_from_url`, `setpagetext`, `sdc`) require a same-origin
request. OAuth is one cookie for the whole service, under `/`.

Uploads are chunked above `chunk_size` (default 5 MiB); the wiki's
`minuploadchunksize` is respected by `mediawiki_upload`. The download limit is
`max_upload_bytes` (default 5 GiB, Commons' current maximum).

### Flickr bookkeeping

* `check_existing_commons_filenames` uses `page` and `logging` in the Commons
  replica. Status: `0` unused, `1` exists, `2` deleted before. Without a
  replica it asks the Commons API, and checks the deletion log per name.
* `check_flickr_files_in_commons` builds `/photo[s]/<owner>/<id>` prefixes from
  the front-end's owner/file map and queries `page` + `externallinks` in one
  set-based statement per batch. It recognises the same reversed domains and
  `LIKE … ESCAPE '!'` patterns as the PHP tool, and takes the photo ID from the
  `/photo(s)/…/<id>` position, not from a trailing set/album number. This one
  needs the replica; without it the API reports that the database is
  unavailable.
* `get_flickr_key` reads `flickr_key_file`, then `$FLICKR_ACCESS_KEY`.

### Geograph

`/geograph2commons/g2c.php` (and `/g2c`) takes `server` and `photo_id`,
checks the server against the four Geograph sites, requires numeric IDs, and
fetches the photo and reuse pages with a Geograph-friendly user agent. A
non-200 (Geograph answers 410 for removed photos) is an error, not content.
The response is `{"main": html, "reuse": html}`; the browser parses it exactly
as the old `main.js` did.

## CommonsHelper

`/commonshelper/translate` takes the old `index.php` parameters (`image`,
`language`/`lang`, `project`, `newname`, `remove_categories`) and returns:

```json
{"error":"OK","text":"…","is_good":true,"warnings":[],
 "image":"…","language":"…","project":"…","newname":"…",
 "source_url":"…","size":"…","exists":true}
```

It reads the source page in one API request (image history, templates,
categories, wikitext), then builds the page in `src/commonshelper/text.rs`: the
`{{Information}}` fields, licenses (translated through `data/transwiki.json`),
self templates, original upload log, category removal, and the "templates that
do not exist on Commons" comment. License existence is checked against Commons
in batches of 50.

The extracted dictionaries are:

* `data/common.json` — license indicators, template aliases, good templates,
  image namespace aliases (from `common_data.php`);
* `data/commonshelper.json` — permission texts, localized `Information` keys,
  category names, bad headings, duplicate/deprecated licenses, transfer
  blockers, self-texts, local-only templates (from `common_data.php`,
  `transwiki_data.php`, and `index.php`);
* `data/transwiki.json` — local template → Commons template per language.

The front-end adds the `{{BotMoveToCommons}}` line when the uploader is not
autopatrolled, offers the `{{NowCommons}}`/`{{subst:ncd}}` snippet and a delete
link, and keeps a manual `Special:Upload` fallback. Interface localisation is
no longer fetched from a wiki page; the front-end is English for now.

## Front-end

One Vue 2.6 application with Vue Router 3 in history mode, no build step.
All code is plain ES6 loaded by `index.html`; nothing runs on the server beyond
serving the files. Bootstrap 4 is loaded from the Toolforge CDN; jQuery is not
used.

| File | Purpose |
|---|---|
| `assets/index.html` | shell, CDN scripts |
| `assets/app.js` | router, shell component, auth state |
| `assets/img/magpie.jpg` | header icon and favicon |
| `assets/js/api.js` | all backend calls |
| `assets/js/upload.js` | sequential upload queue |
| `assets/js/util.js` | file-name/description helpers |
| `assets/js/flickr.js` | Flickr API, license mapping, description |
| `assets/views/*.js` | one view per tool |

The server serves `index.html` for `/` and every tool path. Old `.php` URLs
redirect to the directory, so the SPA's relative assumptions hold.

The header icon is a 330 px thumbnail of
[File:Eurasian magpie iridescence.jpg](https://commons.wikimedia.org/wiki/File:Eurasian_magpie_iridescence.jpg)
by Alexis Lours, licensed CC BY 4.0. It is cropped and desaturated with CSS;
the binary embeds the thumbnail under `assets/img/`.

## Deployment

Toolforge buildservice, as `magnustools_rs`:

1. Create the tool `magpie` and an OAuth consumer on Meta, with the callback
   `https://magpie.toolforge.org/api.php`. The callback must match
   `public_url` + `/api.php` exactly; do not derive it from request headers
   behind Toolforge's TLS proxy.
2. Put `oauth.ini` (`consumerKey`, `consumerSecret`, `agent`), `replica.my.cnf`,
   `flickr_key.txt`, and `magpie.json` (from `config.json.template`) in the
   tool's data directory. Generate `cookie_key` with `openssl rand -hex 64`.
3. `toolforge build start` (or `./build.sh`), then start the web service with
   the `Procfile`.
4. To move each old subdomain, use Toolforge's redirect container (308, so
   query strings and POST bodies survive):

   ```bash
   # as the old tool's account, e.g. flickr2commons
   toolforge envvars create REDIRECT_HOST magpie.toolforge.org
   toolforge envvars create REDIRECT_PATH /flickr2commons/
   cat > "$HOME/service.template" <<'EOF'
   type: buildservice
   buildservice-image: tool-containers/redirect:latest
   health-check-path: /healthz
   mount: none
   cpu: 125m
   mem: 128Mi
   EOF
   toolforge webservice stop
   toolforge webservice start
   ```

   Repeat for `url2commons`, `geograph2commons`, and `commonshelper`. Because
   paths are not preserved (`REDIRECT_PATH` without `%s`), use the tool's own
   directory as above. The absolute callback URLs of the old consumers are no
   longer needed; delete them when the old tools are retired.

**Dependency caveat:** `mediawiki_upload` is a path dependency while both
crates are developed together. A remote buildservice build cannot fetch it.
Publish it (or switch `magpie` to a git dependency) before the first remote
build.

## Status and limitations

**Working today:** the shared upload API with one OAuth login; URL, Geograph
and CommonsHelper transfers; Flickr photo import and the two Commons checks;
chunked uploads; the embedded Vue front-end; the old `.php` addresses and API
aliases.

**Not feature-complete yet:**

* **Flickr license mapping** is intentionally conservative but coarse: Flickr
  license IDs 4/5 map to the 2.0 Commons templates. The old tool's
  `shared.js`/`flickr-file.js` has a much finer version/URL-based mapping and a
  richer description builder; port that next, with the existing tests in
  `flickr2commons/tests/`.
* **Flickr front-end parity.** The new view imports, checks, edits and uploads
  photos, but the old batch helpers (bulk selection, per-photo template
  choices, and so on) are not all ported yet.
* **Flickr API CORS** is assumed to work (the old tool called it from the
  browser). If it does not, proxy the few `flickr.photos.*` calls through
  `/api.php`.
* **CommonsHelper interface localisation** is no longer fetched from
  `User:Magnus_Manske/Commonshelper_interface`; the UI is English. The
  description/license output is independent of this.
* **CommonsHelper fixtures** would make the port easier to trust: capture a set
  of PHP inputs/outputs and compare. Until then, the unit tests cover the
  building blocks, not whole pages.
* **CommonsHelper's empty-language Wikisource case** (`language=` plus
  `project=wikisource`) is not supported; the handler defaults an empty
  language to `en`. Other projects use `Wiki::new`, so the supported set is
  the same as `wikimisc::wiki`.
* **`{{NowCommons}}` on the source wiki** is shown as text plus an edit link;
  the old tool could save it through the uploader's `setpagetext`. A small
  front-end addition can restore that.
* **Usage logging** (`magnustools/logger.php`) is not wired in. Add a
  fire-and-forget call if the dashboard needs the numbers.
* **Replica-backed size/SHA-1 checks** exist in `mediawiki_upload` behind the
  `toolforge-replicas` feature but are not used here; the current checks are
  name/duplicate based. Enable them for a "check before upload" button if the
  extra round-trip is worth it.

**Operational notes:**

* The OAuth consumer's registered callback must be exactly `public_url` +
  `/api.php` (`https://magpie.toolforge.org/api.php` for the default config).
  Never derive it from `Host`/`X-Forwarded-*`.
* The session cookie is `Secure`, so login does not work over plain HTTP. Use
  a TLS-terminating proxy (Toolforge does this) or an HTTPS tunnel for local
  login tests.
* Write actions require a same-origin request. Browser clients send the usual
  `Sec-Fetch-Site`/`Origin`/`Referer` headers; a non-browser client using the
  upload API directly must supply one of them.
* The old subdomains need Toolforge redirect containers; see
  [Deployment](#deployment). A tool page redirects with 308 (method and query
  preserved).
* `mediawiki_upload` is a path dependency today. A remote buildservice build
  cannot fetch it; publish it or use a git dependency before deploying.

**License.** The four source tools are GPL-3.0, so this port and the extracted
dictionaries are GPL-3.0-or-later (`COPYING`). `mediawiki_upload` remains
MIT OR Apache-2.0; the combination follows GPL-3 compatibility.

## Testing

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The route, parameter, data, source-parsing, Flickr-prefix, and front-end
embedding tests run without network access. `mediawiki_upload` contains the
OAuth-signature and upload protocol tests (wiremock), so this crate does not
duplicate them.

## Security notes

* Source URLs go through `wikimisc::http::ssrf`: private, loopback, link-local
  and reserved addresses are refused, including on redirects; downloads are
  size-limited and written to a temporary file.
* Writes are same-origin only; the login cookie is encrypted, `HttpOnly`,
  `SameSite=Lax`, and `Secure`.
* OAuth secrets are only read from files outside the repository; `*.ini`,
  `*.cnf`, and `flickr_key.txt` are git-ignored.
* The old `api.php` callback warning applies: configure `public_url`; never
  derive it from `Host`/`X-Forwarded-*`.
* No `unsafe` code; production paths return `Result` instead of panicking.
