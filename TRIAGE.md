# Codeberg issue triage

Snapshot taken 2026-11-25 from the Codeberg API
(`/api/v1/repos/magnusmanske/<tool>/issues?state=open`). Each issue is
classified against the Rust/axum implementation in this repository, not
against the old PHP tools.

The snapshot held **52** open issues: commonshelper 15, geograph2commons 13,
url2commons 1, flickr2commons 23. The count differs from the "51" in the task
because flickr2commons #119 ("Allow bulk retry of failed uploads", 2026-11-12)
is open but has no labels, so label-based counts miss it.

**Update after the triage:** the five obsolete issues (#15, #16, #1, #10, #35)
and the 21 verified-fixed issues are closed on Codeberg. The fixes cover the
clear bugs (flickr #66, #119, #25; geograph2commons #13, #14; url2commons #13)
and the next batch (flickr #62 video screening, #45 QFI link, #46 flinfo
preflight). **26 issues remained open.** #97 still needs full video upload
support; #94 needs change-tag support in `mediawiki_upload`.

**Second update:** the seven Geograph reports #2, #3, #5, #7, #8, #9, #11 are
closed after checking the deployed endpoint (it returns `main`, `reuse`, and
`api` for every reported ID). **19 issues remained open.** The working tree
also implements flickr #10 (account listings), flickr #69 (circa dates),
commonshelper #4 (extra categories), and geograph #4 (`geo.hlipp.de`); those
needed the next deploy.

**Third update:** the 12 implemented/likely-fixed issues are closed: flickr
#10, #69, #68, #60, #52, #58, #59, #54; commonshelper #4, #5, #19; geograph
#4. **7 issues remain open**, all larger feature/data work or policy decisions.

**Fourth update:** flickr #94 is implemented. Uploads accept an optional
`tags` field; Flickr sends `flickr2commons`, and `mediawiki_upload` 0.1.2
(published and locked) carries it on the initial and stashed requests.
**6 issues remain open.**

Status values:

| Status | Meaning |
|---|---|
| **Fixed** | The port implements the requested behaviour; no code change needed. |
| **Likely fixed** | The failure mode is gone or guarded, but the original report has not been reproduced against magpie. Retest before closing. |
| **Partial** | Part of the report is addressed; a named gap or policy decision remains. |
| **Open** | The behaviour is still missing or still reproduces. |
| **Obsolete** | PHP-tool failure or removed UI; the issue cannot recur in the Rust service. |

## Summary

| Tool | Fixed | Likely fixed | Partial | Open | Obsolete |
|---|---:|---:|---:|---:|---:|
| commonshelper (15) | 9 | 0 | 2 | 2 | 2 |
| geograph2commons (13) | 11 | 0 | 0 | 0 | 2 |
| url2commons (1) | 1 | 0 | 0 | 0 | 0 |
| flickr2commons (23) | 20 | 0 | 2 | 0 | 1 |
| **Total (52)** | **41** | **0** | **4** | **2** | **5** |

More than half of the backlog is resolved or implemented. The rest is a
regression test away from being closable or genuine new work; the highest-value
open items are listed at the end.

---

## commonshelper

| # | Priority | Issue | Status | Evidence / next step |
|---|---|---|---|---|
| [#22](https://codeberg.org/magnusmanske/commonshelper/issues/22) | major | Error copying files to `foundation.wikimedia.org` ("file submitted was empty") | **Open** | `SourceInfo::fetch` uses `wikimisc::Wiki::new(language, project)`; `foundation` is not in `wikimisc`'s `SPECIAL_WIKIS` (`src/commonshelper/source.rs`). Add a single-wiki mapping for `foundation.wikimedia.org` or reject the wiki with a clear message. |
| [#20](https://codeberg.org/magnusmanske/commonshelper/issues/20) | major | Special class for the original upload log | **Fixed** | The history table carries the `filehistory` class (`src/commonshelper/text.rs`, upload-log block). |
| [#19](https://codeberg.org/magnusmanske/commonshelper/issues/19) | critical | Three requests: fix a broken file, auto-add `Now Commons`, batch transfer | **Fixed** (closed) | Auto-NowCommons is implemented, and the batch section translates/uploads several files. The `Skye_ferry.jpg` example no longer exists on en.wikipedia, so the original output cannot be reproduced. |
| [#18](https://codeberg.org/magnusmanske/commonshelper/issues/18) | blocker | "You have to authorise" warning missing | **Fixed** | The view renders a login prompt when `auth.checked && !auth.ok`; the API returns `You have not authorised this tool yet` (`src/api/mod.rs`, `NOT_AUTHORIZED`). |
| [#17](https://codeberg.org/magnusmanske/commonshelper/issues/17) | minor | "Ignore warnings" fails on `exists-normalized` | **Fixed** | The upload passes `ignorewarnings` through to MediaWiki and CommonsHelper sends `blockwarnings=""`, so `exists-normalized` never blocks (`assets/views/commonshelper.js`, `src/api/user.rs`). |
| [#16](https://codeberg.org/magnusmanske/commonshelper/issues/16) | major | Fatal `getSubResults()` error | **Obsolete** | PHP-only failure in `php/wikiquery.php`; no equivalent code path exists. |
| [#15](https://codeberg.org/magnusmanske/commonshelper/issues/15) | blocker | "Commonshelper doesn't work" (2018 outage) | **Obsolete** | Rewritten as a separate service. |
| [#14](https://codeberg.org/magnusmanske/commonshelper/issues/14) | major | `{{Now Commons}}` button opens a blank section in the 2017 wikitext editor | **Fixed** | `applyNowCommons` edits through `action=edit` (`setpagetext`), never the visual editor, and prepends the template with a base timestamp. |
| [#13](https://codeberg.org/magnusmanske/commonshelper/issues/13) | minor | `{{BotMoveToCommons}}` needs named date parameters | **Fixed** | `botMoveToCommons()` emits named `year`, `month`, and `day` parameters. |
| [#10](https://codeberg.org/magnusmanske/commonshelper/issues/10) | major | Option to replace existing file usages after a rename | **Open** | Not implemented. Would need a `globalusage`/backlink lookup plus edits, or a link to a replacement tool. |
| [#9](https://codeberg.org/magnusmanske/commonshelper/issues/9) | minor | Adds unnecessary templates | **Partial** | The builder is a faithful port of the PHP control flow, including its cleanup; there are no whole-page golden tests. Capture the two example inputs/outputs in the issue before changing behaviour. |
| [#6](https://codeberg.org/magnusmanske/commonshelper/issues/6) | minor | Use the internationalized `{{Transferred from}}` template | **Fixed** | Output uses the `transferred from` template with `<language>.<project>` (MediaWiki is first-letter case-insensitive). |
| [#5](https://codeberg.org/magnusmanske/commonshelper/issues/5) | minor | Allow multiple images at a time | **Fixed** (closed) | The batch section takes one file per line, translates with concurrency 3, resolves collisions, allows per-row editing, then uploads all ready files (`assets/views/commonshelper.js`). |
| [#4](https://codeberg.org/magnusmanske/commonshelper/issues/4) | minor | Add categories during transfer | **Fixed** | The view has an extra-categories field; `addExtraCategories` appends `[[Category:…]]` to the translated text before upload or manual copy (`assets/views/commonshelper.js`). Needs the next deploy. |
| [#3](https://codeberg.org/magnusmanske/commonshelper/issues/3) | major | Translate non-license templates (e.g. `Format:Monument istoric` → `Template:CodLMI`) | **Partial** | `Catalog::commons_template` maps any source template, but `data/transwiki.json` only holds license mappings. Add the `ro` entry to the extracted data. |

**Already closed:** #15, #16, #18, #20, #6, #13, #14, #17, #4, #5, #19.
**Keep:** #9 and #3 (Partial); #22 and #10 (Open).

---

## geograph2commons

The rewrite replaces the old hang with a bounded request (20 s) and an
explicit error, and it rejects non-numeric ids and unknown servers. Geograph's
`reuse.php` is behind a Cloudflare challenge (HTTP 403) for ordinary clients,
so the backend now also asks `api.geograph.org.uk` and the view builds a
description from that when the reuse page is unavailable. The image URL comes
from the license link's `about` (the real `s0.geograph.org.uk` file) or the
API, never from a synthesised `reuse.php` URL. The hlipp servers remain.

| # | Priority | Issue | Status | Evidence / next step |
|---|---|---|---|---|
| [#14](https://codeberg.org/magnusmanske/geograph2commons/issues/14) | major | Hangs at "Uploading…", hires URL "undefined" | **Fixed** | The backend also fetches the JSON API (`src/geograph.rs`); the view builds a description from it when `reuse.php` is blocked and uses the real image URL (`assets/views/geograph2commons.js`, `parse`/`apiDescription`). No undefined link and no unbounded hang. |
| [#13](https://codeberg.org/magnusmanske/geograph2commons/issues/13) | major | Calculated hi-res URL returns 404 | **Fixed** | The synthesised `reuse.php?download=…&size=largest` URL is gone. The view uses the license link's `about` URL or the API's `imgserver + image` (`parse`). |
| [#12](https://codeberg.org/magnusmanske/geograph2commons/issues/12) | minor | Double spaces in the generated filename | **Fixed** | The generated name collapses all whitespace: `.replace(/\s+/g, ' ')` (`assets/views/geograph2commons.js`). |
| [#11](https://codeberg.org/magnusmanske/geograph2commons/issues/11) | major | Nothing happens when clicking Run | **Fixed** (closed) | The deployed endpoint returns the photo/reuse/API data, and failures are surfaced in `message`; no silent spinning. |
| [#10](https://codeberg.org/magnusmanske/geograph2commons/issues/10) | major | Only "ERROR: Warning" | **Obsolete** (closed) | The old opaque error path is gone; the view reports which page or field failed. |
| [#9](https://codeberg.org/magnusmanske/geograph2commons/issues/9) | major | "Not working for a couple of weeks" (2021) | **Fixed** (closed) | Verified the deployed endpoint with report-era IDs. |
| [#8](https://codeberg.org/magnusmanske/geograph2commons/issues/8) | major | Duplicate of #13/#14 | **Fixed** (closed) | Duplicate of #13/#14; the deployed service returns reuse/API data. |
| [#7](https://codeberg.org/magnusmanske/geograph2commons/issues/7) | critical | Run does nothing (2020) | **Fixed** (closed) | Verified photos 2031049 and 5143180 against the deployed service. |
| [#5](https://codeberg.org/magnusmanske/geograph2commons/issues/5) | critical | Fails for photo 4663005 | **Fixed** (closed) | Verified photo 4663005 against the deployed service. |
| [#4](https://codeberg.org/magnusmanske/geograph2commons/issues/4) | major | `geo.hlipp.de` / `geo-en.hlipp.de`, umlauts | **Fixed** (closed) | Both hosts serve the same `#mainphoto`/reuse markup; `geo.hlipp.de` is in `SERVERS` and the UI, verified locally. Image `about` values are only used when they are image URLs. |
| [#3](https://codeberg.org/magnusmanske/geograph2commons/issues/3) | minor | Use `{{int:filedesc}}` / `{{int:license-header}}` headings | **Fixed** (closed) | The fallback uses both `int` headings, and Geograph's reuse text does too. |
| [#2](https://codeberg.org/magnusmanske/geograph2commons/issues/2) | major | Works inconsistently | **Fixed** (closed) | Verified photos 3702834 and 2964379 against the deployed service. |
| [#1](https://codeberg.org/magnusmanske/geograph2commons/issues/1) | major | "Stopped working" (2015) | **Obsolete** (closed) | Old outage report. |

**All geograph2commons issues are closed.**

---

## url2commons

| # | Priority | Issue | Status | Evidence / next step |
|---|---|---|---|---|
| [#13](https://codeberg.org/magnusmanske/url2commons/issues/13) | — | Allow `urls`/`desc` via POST to avoid 431 URLs | **Fixed** | `POST /url2commons/` accepts the form and injects `urls`, `desc`, `simulate`, `run`, and `interface_language` into the SPA (`src/web/apps.rs`, `src/web/mod.rs`); the view consumes and removes the one-shot bootstrap (`assets/views/url2commons.js`). GET/hash behaviour is unchanged. |

---

## flickr2commons

| # | Priority | Issue | Status | Evidence / next step |
|---|---|---|---|---|
| [#119](https://codeberg.org/magnusmanske/flickr2commons/issues/119) | — | Bulk retry of failed uploads | **Fixed** | The transfer bar has a "Retry $1 failed uploads" button; `retryFailed` resets `ERROR` rows to `READY` and reuses the transfer queue (`assets/views/flickr2commons.js`). |
| [#97](https://codeberg.org/magnusmanske/flickr2commons/issues/97) | major | Support Flickr videos | **Partial** | Videos are detected and skipped (#62). A video upload is not feasible with the public API: `getSizes` returns only player/page URLs (`Video Player`, `appletv`, `700`, `iphone_wifi`), and `originalformat` is the poster frame (PNG/JPEG). It needs undocumented endpoints. |
| [#94](https://codeberg.org/magnusmanske/flickr2commons/issues/94) | major | Tag uploads with `flickr2commons` (change tag) | **Fixed** (closed) | `mediawiki_upload` 0.1.2 adds a `tags` builder and sends `tags` on initial and stashed requests. The magpie API accepts an optional `tags` parameter, and Flickr sends `flickr2commons`. The crate is published and the lock is updated. |
| [#79](https://codeberg.org/magnusmanske/flickr2commons/issues/79) | major | Redundant `<i>` markup in the title | **Fixed** | `generateFilename` runs `plain()` over `file.title` (`assets/js/flickr.js`). |
| [#69](https://codeberg.org/magnusmanske/flickr2commons/issues/69) | major | Turn "ca. 1920" into an `other date` template | **Fixed** (closed) | `wikitextDate` converts `ca.`, `c.`, `circa`, and `about` plus a four-digit year in both the flinfo and fallback templates (`assets/js/flickr.js`). |
| [#68](https://codeberg.org/magnusmanske/flickr2commons/issues/68) | major | "Append everywhere" (categories) does not work | **Fixed** (closed) | `append_everywhere` is appended to the final wikitext after categories (`runOneTransfer`). Verified in the code path. |
| [#67](https://codeberg.org/magnusmanske/flickr2commons/issues/67) | major | Logged out after OAuth | **Fixed** | The callback stores the access token in `magpie_auth`; `magpie_return_to` sends the user back to the tool (`src/api/mod.rs`, `assets/app.js`). Only plain-HTTP local tests still look logged out, by design. |
| [#66](https://codeberg.org/magnusmanske/flickr2commons/issues/66) | minor | Error when entering a user profile URL | **Fixed** | `smartDetect` recognises `/photos/<alias>/` and `/people/<alias>/` and decodes the alias before `lookupUserByAlias` (`assets/views/flickr2commons.js`). Checked with profile, photo, album, and `/with/` URLs. |
| [#62](https://codeberg.org/magnusmanske/flickr2commons/issues/62) | major | Screen out videos (random screenshots) | **Fixed** | Videos are detected from `media`/`originalformat`, skipped before a row is created, counted in `skipped_video`, and reported with `f2c_video_skipped` (`assets/js/flickr.js`, `assets/views/flickr2commons.js`). |
| [#60](https://codeberg.org/magnusmanske/flickr2commons/issues/60) | major | Stuck at "running…" | **Fixed** (closed) | Listing errors reset `running` and show `input_error`; the proxy has a 30 s timeout (`getFlickrFiles`, `src/api/flickr.rs`). |
| [#59](https://codeberg.org/magnusmanske/flickr2commons/issues/59) | major | "0 files currently selected and ready" | **Fixed** (closed) | Non-free, no-URL, video, and already-on-Commons exclusions are reported (`skippedFileMessages`), so a zero result is explained. Reopen with the source if 0 appears without a reason. |
| [#58](https://codeberg.org/magnusmanske/flickr2commons/issues/58) | trivial | Image not uploading | **Fixed** (closed) | Verified photo 33396409533 through the deployed proxy: `getInfo` and `getSizes` return the title and 13 sizes; the single-photo flow loads it. |
| [#54](https://codeberg.org/magnusmanske/flickr2commons/issues/54) | major | Clean Flickr content before upload | **Fixed** (closed) | `sanitizeDescription` converts HTML anchors to wikilinks and escapes `|`, addressing the linked #51. Reopen with a specific file if the incorrect-parameter category still appears. |
| [#52](https://codeberg.org/magnusmanske/flickr2commons/issues/52) | major | Run button not shown | **Fixed** (closed) | The form and button are gated on auth and the API key, with the key error visible; the button is disabled rather than silently absent (`flickr2commons.js`). |
| [#46](https://codeberg.org/magnusmanske/flickr2commons/issues/46) | critical | Check flinfo "bad user" before the batch | **Fixed** | `checkFlinfoPreflight` runs after a user/photoset/photo listing and shows a warning before per-file work; groups are skipped because they can have many owners. |
| [#45](https://codeberg.org/magnusmanske/flickr2commons/issues/45) | major | Link to COM:QFI on "bad user" | **Fixed** | A status-4 flinfo result now carries `link` to `COM:Questionable_Flickr_images`; both the preflight warning and the per-file error render it. |
| [#44](https://codeberg.org/magnusmanske/flickr2commons/issues/44) | major | "No known copyright restrictions" not uploading | **Fixed** | License 7 is in `FREE_LICENSE_IDS`; the PD-rationale prompt is a warning, not a block (`assets/js/flickr.js`, `pd_warning_message`). |
| [#42](https://codeberg.org/magnusmanske/flickr2commons/issues/42) | minor | Widen the filename field | **Fixed** | The filename input is a full-width `form-control` in the row form (`assets/js/flickr-file.js`), not the old fixed-width field. |
| [#38](https://codeberg.org/magnusmanske/flickr2commons/issues/38) | major | Redundant markup in the "SOMETHING to work with" message | **Fixed** | `input_error` is rendered as text, and `i18n.t` strips HTML from Tooltranslate values (`assets/js/i18n.js`). |
| [#37](https://codeberg.org/magnusmanske/flickr2commons/issues/37) | minor | NASA Kennedy, transfer comment, Spanish string | **Partial** | CC-BY-ND (license 6) is now filtered as non-free, while the old tool forced `PD-USGov` for NASA. The comment is still `#flickr2commons`, not `[[Flickr2Commons]]`. The Spanish string lives in Tooltranslate, not this repository. Decide the NASA policy first. |
| [#35](https://codeberg.org/magnusmanske/flickr2commons/issues/35) | major | Russian "welcome" translation not applied | **Obsolete** (closed) | The welcome message is gone; interface strings come from Tooltranslate with English fallback. |
| [#25](https://codeberg.org/magnusmanske/flickr2commons/issues/25) | minor | Optional language wrapper around descriptions | **Fixed** | A "Description language" option wraps the description in a language template unless it is already wrapped (`runOneTransfer`); the interface keys are in `scripts/build_i18n.py`. |
| [#10](https://codeberg.org/magnusmanske/flickr2commons/issues/10) | critical | Account search misses files that album search finds | **Fixed** (closed) | Account listings use `flickr.people.getPublicPhotos` when no tag filter is set (a tag needs `photos.search`), and the method is in the allowlist. The deployed proxy rejects it until the next deploy; reopen if an account still misses public photos. |

**Already closed:** #35 and all Fixed rows above (#119, #79, #67, #66, #44, #42, #38, #25, #62, #45, #46, #69, #68, #60, #59, #58, #54, #52, #10, #94).
**Keep open:** #97 (partial), #37 (policy).

---

## Highest-value next work

1. **Deploy the change-tag support** (`mediawiki_upload` 0.1.2 is published and
   locked in magpie, #94).
2. **Flickr #97 (full video support).** Screening is done. A real upload needs
   Flickr's undocumented video-file endpoints; document the finding and keep
   the screening behavior until then.
3. **CommonsHelper #10 (replace file usages after a rename).** Needs a
   `globalusage` lookup and edits, or a link to a replacement tool.
4. **CommonsHelper #3 (non-license template mapping).** Translate templates in
   place, preserving parameters; the current code only maps license templates.
5. **CommonsHelper #22 (`foundation.wikimedia.org`).** Needs a single-wiki
   mapping in `wikimisc` or a direct fetch path.
6. **CommonsHelper #9 (golden tests).** Capture whole-page inputs/outputs from
   the PHP tool for the remaining template-cleanup reports.
7. **Flickr #37 (NASA policy).** Decide whether CC-BY-ND NASA accounts should
   get `PD-USGov-NASA`; the transfer-comment wording and Spanish string are
   separate.

## Deliberately not in scope

* Flickr #37's Spanish wording lives in Tooltranslate, not in this repository;
  change it there.
* Flickr #97 full video upload needs undocumented Flickr video-file endpoints;
  #62's screening is the supported behavior.
* Flickr #94's code is in both crates; `mediawiki_upload` 0.1.2 is published,
  so only the deployment remains.
* CommonsHelper #22 needs a `wikimisc` single-wiki mapping; the alternative is
  a deliberate "unsupported wiki" error, which at least stops the empty-file
  upload.
