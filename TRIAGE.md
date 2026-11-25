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
are closed on Codeberg, and the clear bugs are fixed in this repository
(flickr #66, #119, #25; geograph2commons #13, #14; url2commons #13). The
tables below show the post-fix status; **47 issues remain open**.

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
| commonshelper (15) | 6 | 0 | 3 | 4 | 2 |
| geograph2commons (13) | 3 | 6 | 1 | 1 | 2 |
| url2commons (1) | 1 | 0 | 0 | 0 | 0 |
| flickr2commons (23) | 8 | 3 | 4 | 7 | 1 |
| **Total (52)** | **18** | **9** | **8** | **12** | **5** |

Roughly a third of the backlog is already resolved by the rewrite, a third is
a regression test away from being closable, and a third is genuine work. The
highest-value open items are listed at the end.

---

## commonshelper

| # | Priority | Issue | Status | Evidence / next step |
|---|---|---|---|---|
| [#22](https://codeberg.org/magnusmanske/commonshelper/issues/22) | major | Error copying files to `foundation.wikimedia.org` ("file submitted was empty") | **Open** | `SourceInfo::fetch` uses `wikimisc::Wiki::new(language, project)`; `foundation` is not in `wikimisc`'s `SPECIAL_WIKIS` (`src/commonshelper/source.rs`). Add a single-wiki mapping for `foundation.wikimedia.org` or reject the wiki with a clear message. |
| [#20](https://codeberg.org/magnusmanske/commonshelper/issues/20) | major | Special class for the original upload log | **Fixed** | The history table is emitted as `{| class="wikitable filehistory"` (`src/commonshelper/text.rs`, upload-log block). |
| [#19](https://codeberg.org/magnusmanske/commonshelper/issues/19) | critical | Three requests: fix a broken file, auto-add `Now Commons`, batch transfer | **Partial** | Auto-tagging is implemented (`applyNowCommons` prepends `{{subst:ncd}}`/`{{NowCommons}}` in `assets/views/commonshelper.js`). Batch transfer is still missing. The `File:Skye_ferry.jpg` example needs a golden input/output pair to verify. |
| [#18](https://codeberg.org/magnusmanske/commonshelper/issues/18) | blocker | "You have to authorise" warning missing | **Fixed** | The view renders a login prompt when `auth.checked && !auth.ok`; the API returns `You have not authorised this tool yet` (`src/api/mod.rs`, `NOT_AUTHORIZED`). |
| [#17](https://codeberg.org/magnusmanske/commonshelper/issues/17) | minor | "Ignore warnings" fails on `exists-normalized` | **Fixed** | The upload passes `ignorewarnings` through to MediaWiki and CommonsHelper sends `blockwarnings=""`, so `exists-normalized` never blocks (`assets/views/commonshelper.js`, `src/api/user.rs`). |
| [#16](https://codeberg.org/magnusmanske/commonshelper/issues/16) | major | Fatal `getSubResults()` error | **Obsolete** | PHP-only failure in `php/wikiquery.php`; no equivalent code path exists. |
| [#15](https://codeberg.org/magnusmanske/commonshelper/issues/15) | blocker | "Commonshelper doesn't work" (2018 outage) | **Obsolete** | Rewritten as a separate service. |
| [#14](https://codeberg.org/magnusmanske/commonshelper/issues/14) | major | `{{Now Commons}}` button opens a blank section in the 2017 wikitext editor | **Fixed** | `applyNowCommons` edits through `action=edit` (`setpagetext`), never the visual editor, and prepends the template with a base timestamp. |
| [#13](https://codeberg.org/magnusmanske/commonshelper/issues/13) | minor | `{{BotMoveToCommons}}` needs named date parameters | **Fixed** | `botMoveToCommons()` emits `|year=…|month=…|day=…`. |
| [#10](https://codeberg.org/magnusmanske/commonshelper/issues/10) | major | Option to replace existing file usages after a rename | **Open** | Not implemented. Would need a `globalusage`/backlink lookup plus edits, or a link to a replacement tool. |
| [#9](https://codeberg.org/magnusmanske/commonshelper/issues/9) | minor | Adds unnecessary templates | **Partial** | The builder is a faithful port of the PHP control flow, including its cleanup; there are no whole-page golden tests. Capture the two example inputs/outputs in the issue before changing behaviour. |
| [#6](https://codeberg.org/magnusmanske/commonshelper/issues/6) | minor | Use the internationalized `{{Transferred from}}` template | **Fixed** | Output contains `{{transferred from|<language>.<project>}}` (MediaWiki is first-letter case-insensitive). |
| [#5](https://codeberg.org/magnusmanske/commonshelper/issues/5) | minor | Allow multiple images at a time | **Open** | The view translates and uploads one file. Reuse the Flickr queue pattern if this is wanted. |
| [#4](https://codeberg.org/magnusmanske/commonshelper/issues/4) | minor | Add categories during transfer | **Open** | Only source categories are carried or removed (`removeCategories`); there is no "add categories" input. |
| [#3](https://codeberg.org/magnusmanske/commonshelper/issues/3) | major | Translate non-license templates (e.g. `Format:Monument istoric` → `Template:CodLMI`) | **Partial** | `Catalog::commons_template` maps any source template, but `data/transwiki.json` only holds license mappings. Add the `ro` entry to the extracted data. |

**Already closed:** #15, #16 (PHP-only).
**Fixed, closable:** #18, #20, #6, #13, #14, #17.
**Verify then close:** #19 (except batch), #9 after capturing fixtures.

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
| [#11](https://codeberg.org/magnusmanske/geograph2commons/issues/11) | major | Nothing happens when clicking Run | **Likely fixed** | Load and upload are separate, both surfaced in `message`; failures no longer leave the button spinning. Retest with the reported ids. |
| [#10](https://codeberg.org/magnusmanske/geograph2commons/issues/10) | major | Only "ERROR: Warning" | **Obsolete** | The old opaque error path is gone; the view reports which page or field failed. |
| [#9](https://codeberg.org/magnusmanske/geograph2commons/issues/9) | major | "Not working for a couple of weeks" (2021) | **Likely fixed** | Same root cause as #14; retest now that the reuse fallback and real image URL are in place. |
| [#8](https://codeberg.org/magnusmanske/geograph2commons/issues/8) | major | Duplicate of #13/#14 | **Likely fixed** | Duplicate of #13/#14; consolidate on Codeberg. |
| [#7](https://codeberg.org/magnusmanske/geograph2commons/issues/7) | critical | Run does nothing (2020) | **Likely fixed** | Same flow as #11; retest. |
| [#5](https://codeberg.org/magnusmanske/geograph2commons/issues/5) | critical | Fails for photo 4663005 | **Likely fixed** | Parsing failures are visible and no longer depend on `reuse.php`; retest the reported id. |
| [#4](https://codeberg.org/magnusmanske/geograph2commons/issues/4) | major | `geo.hlipp.de` / `geo-en.hlipp.de`, umlauts | **Partial** | `geo-en.hlipp.de` is allowed, `geo.hlipp.de` is not (`SERVERS` in `src/geograph.rs`). Add it only if its markup matches the parser; umlauts should survive `DOMParser`. |
| [#3](https://codeberg.org/magnusmanske/geograph2commons/issues/3) | minor | Use `{{int:filedesc}}` / `{{int:license-header}}` headings | **Open** | The description is taken verbatim from Geograph's reuse textarea; headings are not rewritten. |
| [#2](https://codeberg.org/magnusmanske/geograph2commons/issues/2) | major | Works inconsistently | **Likely fixed** | Retest the two ids; the reuse-page dependency that caused the intermittent failures is gone. |
| [#1](https://codeberg.org/magnusmanske/geograph2commons/issues/1) | major | "Stopped working" (2015) | **Obsolete** (closed) | Old outage report. |

**Already closed:** #1, #10.
**Fixed, closable:** #12, #13, #14 (and #8/#9 as duplicates after a retest).
**Keep:** #4, #3.

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
| [#97](https://codeberg.org/magnusmanske/flickr2commons/issues/97) | major | Support Flickr videos | **Open** | Search/rewrite assume still images (`url_o`/`url_l`/`url_m`, `rewritePhotoProperties`). No video size selection or video-aware description. |
| [#94](https://codeberg.org/magnusmanske/flickr2commons/issues/94) | major | Tag uploads with `flickr2commons` (change tag) | **Open** | Uploads use the comment `#flickr2commons`; no `tags=` change tag, so the abuse-log noise remains. |
| [#79](https://codeberg.org/magnusmanske/flickr2commons/issues/79) | major | Redundant `<i>` markup in the title | **Fixed** | `generateFilename` runs `plain()` over `file.title` (`assets/js/flickr.js`). |
| [#69](https://codeberg.org/magnusmanske/flickr2commons/issues/69) | major | Turn "ca. 1920" into `{{other date|ca|1920}}` | **Open** | The date is passed through from flinfo/Flickr (`informationTemplate`, `fallbackTemplate`); no `ca` detection. |
| [#68](https://codeberg.org/magnusmanske/flickr2commons/issues/68) | major | "Append everywhere" (categories) does not work | **Likely fixed** | `append_everywhere` is appended to the final wikitext after categories (`runOneTransfer`). Retest a multi-file batch. |
| [#67](https://codeberg.org/magnusmanske/flickr2commons/issues/67) | major | Logged out after OAuth | **Fixed** | The callback stores the access token in `magpie_auth`; `magpie_return_to` sends the user back to the tool (`src/api/mod.rs`, `assets/app.js`). Only plain-HTTP local tests still look logged out, by design. |
| [#66](https://codeberg.org/magnusmanske/flickr2commons/issues/66) | minor | Error when entering a user profile URL | **Fixed** | `smartDetect` recognises `/photos/<alias>/` and `/people/<alias>/` and decodes the alias before `lookupUserByAlias` (`assets/views/flickr2commons.js`). Checked with profile, photo, album, and `/with/` URLs. |
| [#62](https://codeberg.org/magnusmanske/flickr2commons/issues/62) | major | Screen out videos (random screenshots) | **Open** | No video detection; same gap as #97. A cheap fix is to skip `originalformat` values that are video containers until video support exists. |
| [#60](https://codeberg.org/magnusmanske/flickr2commons/issues/60) | major | Stuck at "running…" | **Likely fixed** | Listing errors reset `running` and show `input_error`; the proxy has a 30 s timeout (`getFlickrFiles`, `src/api/flickr.rs`). Retest. |
| [#59](https://codeberg.org/magnusmanske/flickr2commons/issues/59) | major | "0 files currently selected and ready" | **Partial** | Non-free and no-URL skips are now reported (`skippedFileMessages`), and existing-on-Commons rows are shown. Still a legitimate 0 when every file is filtered; needs the original query to confirm. |
| [#58](https://codeberg.org/magnusmanske/flickr2commons/issues/58) | trivial | Image not uploading | **Partial** | Needs a retest with photo 33396409533; the current flow no longer produces a blank page for an id. |
| [#54](https://codeberg.org/magnusmanske/flickr2commons/issues/54) | major | Clean Flickr content before upload | **Partial** | `sanitizeDescription` converts `<a>` to wikilinks and escapes `|`, but other HTML/parameters from flinfo are not normalised. Extend the sanitiser or normalise the flinfo fields. |
| [#52](https://codeberg.org/magnusmanske/flickr2commons/issues/52) | major | Run button not shown | **Likely fixed** | The form and button are gated on auth and API key, with the key error visible; the button is disabled rather than silently absent (`flickr2commons.js` template). |
| [#46](https://codeberg.org/magnusmanske/flickr2commons/issues/46) | critical | Check flinfo "bad user" before the batch | **Open** | flinfo is queried per file at upload time. Early validation would need a pre-flight on the source owner before listing/transfer. |
| [#45](https://codeberg.org/magnusmanske/flickr2commons/issues/45) | major | Link to COM:QFI on "bad user" | **Open** | Status 4 maps to a message only (`informationTemplate`); add the link to `COM:QFI`. |
| [#44](https://codeberg.org/magnusmanske/flickr2commons/issues/44) | major | "No known copyright restrictions" not uploading | **Fixed** | License 7 is in `FREE_LICENSE_IDS`; the PD-rationale prompt is a warning, not a block (`assets/js/flickr.js`, `pd_warning_message`). |
| [#42](https://codeberg.org/magnusmanske/flickr2commons/issues/42) | minor | Widen the filename field | **Fixed** | The filename input is a full-width `form-control` in the row form (`assets/js/flickr-file.js`), not the old fixed-width field. |
| [#38](https://codeberg.org/magnusmanske/flickr2commons/issues/38) | major | Redundant markup in the "SOMETHING to work with" message | **Fixed** | `input_error` is rendered as text, and `i18n.t` strips HTML from Tooltranslate values (`assets/js/i18n.js`). |
| [#37](https://codeberg.org/magnusmanske/flickr2commons/issues/37) | minor | NASA Kennedy, transfer comment, Spanish string | **Partial** | CC-BY-ND (license 6) is now filtered as non-free, while the old tool forced `PD-USGov` for NASA. The comment is still `#flickr2commons`, not `[[Flickr2Commons]]`. The Spanish string lives in Tooltranslate, not this repository. Decide the NASA policy first. |
| [#35](https://codeberg.org/magnusmanske/flickr2commons/issues/35) | major | Russian "welcome" translation not applied | **Obsolete** (closed) | The welcome message is gone; interface strings come from Tooltranslate with English fallback. |
| [#25](https://codeberg.org/magnusmanske/flickr2commons/issues/25) | minor | Optional `{{en|…}}` wrapper around descriptions | **Fixed** | A "Description language" option wraps the description in `{{xx|1=…}}` unless it is already wrapped (`runOneTransfer`); the interface keys are in `scripts/build_i18n.py`. |
| [#10](https://codeberg.org/magnusmanske/flickr2commons/issues/10) | critical | Account search misses files that album search finds | **Open** | User listings use `flickr.photos.search` with `user_id`; album listings use `flickr.photosets.getPhotos`. Reproduce with `https://www.flickr.com/photos/dfid/` and decide whether to use `flickr.people.getPublicPhotos` or merge photoset results. |

**Already closed:** #35.
**Fixed, closable:** #38, #42, #44, #79, #67, #66, #119, #25.
**Verify then close:** #68, #52, #60, #59, #58.

---

## Highest-value next work

1. **Flickr #97/#62 (videos).** Decide whether to support video files or, as a
   first step, skip video `originalformat` values so random stills stop arriving
   in "Images needing human review".
2. **Flickr #94 (change tag).** Add `tags=flickr2commons` to the upload when the
   OAuth grant allows it; this removes the AbuseFilter noise.
3. **Flickr #46/#45 (flinfo preflight).** Check the source owner with flinfo
   before listing/transfer and link status 4 to `COM:QFI`.
4. **CommonsHelper #4 and #5 (categories, batch).** An add-categories field and
   a small transfer queue; reuse the Flickr queue and `upload_from_url`.
5. **Flickr #10 (account listing).** Reproduce the `dfid` account case and
   compare `flickr.photos.search` with `flickr.people.getPublicPhotos` or a
   merge of photoset results.
6. **Geograph #4 and #3 (hlipp servers, headings).** Add `geo.hlipp.de` only if
   its markup matches; rewrite headings only if the reuse fallback becomes the
   normal path.

## Deliberately not in scope

* Flickr #37's Spanish wording lives in Tooltranslate, not in this repository;
  change it there.
* Flickr #97/#62 video support and CommonsHelper #5 batch upload are features,
  not regressions; treat them as roadmap items rather than triage gaps.
* CommonsHelper #22 needs a `wikimisc` single-wiki mapping; the alternative is
  a deliberate "unsupported wiki" error, which at least stops the empty-file
  upload.
