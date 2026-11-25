//! Flickr2Commons bookkeeping: the Flickr API key, which Commons file names
//! are taken, and which Flickr photos are already on Commons.
//!
//! The "already on Commons" mapping needs the `externallinks` index, so it
//! uses the Toolforge wiki replicas. The other two checks fall back to the
//! Commons API when no replicas are configured.

use crate::state::AppState;
use crate::web::json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use mediawiki_upload::FileName;
use regex::Regex;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::LazyLock;
use std::time::Duration;
use url::Url;
use wikimisc::mysql_async::prelude::Queryable;
use wikimisc::mysql_async::{Params, Value as DbValue};
use wikimisc::wiki::Wiki;

/// Domains as MediaWiki stores them in `externallinks.el_to_domain_index`: reversed.
const FLICKR_DOMAINS: &[&str] = &[
    "http://com.flickr.",
    "http://com.flickr.www.",
    "http://com.flickr.secure.",
    "https://com.flickr.",
    "https://com.flickr.www.",
    "https://com.flickr.secure.",
];
/// Keeps each replica query's index ranges manageable.
const PREFIX_BATCH: usize = 1000;
/// `IN (…)` lists per query.
const NAME_BATCH: usize = 500;

static PHOTO_PATH: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^/photos?/[^/]+/(\d+)(?:/|$)").ok());

const FLICKR_API: &str = "https://api.flickr.com/services/rest/";
/// The read-only Flickr calls magpie needs. Everything else is refused so the
/// configured API key cannot be used as a general-purpose Flickr proxy.
const FLICKR_METHODS: &[&str] = &[
    "flickr.groups.getInfo",
    "flickr.groups.pools.getPhotos",
    "flickr.people.findByUsername",
    "flickr.people.getInfo",
    "flickr.people.getPublicPhotos",
    "flickr.photos.getInfo",
    "flickr.photos.getSizes",
    "flickr.photos.search",
    "flickr.photosets.getInfo",
    "flickr.photosets.getPhotos",
    "flickr.tags.getListPhoto",
    "flickr.urls.lookupUser",
];
const FLICKR_TIMEOUT: Duration = Duration::from_secs(30);
const THUMBNAIL_TIMEOUT: Duration = Duration::from_secs(15);
const THUMBNAIL_MAX_BYTES: usize = 10 * 1024 * 1024;

fn configured_key(state: &AppState) -> Option<String> {
    let from_file = state
        .config
        .flickr_key_file
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| text.trim().to_string())
        .filter(|key| !key.is_empty());
    from_file
        .or_else(|| {
            std::env::var("FLICKR_ACCESS_KEY")
                .ok()
                .map(|key| key.trim().to_string())
        })
        .filter(|key| !key.is_empty())
}

/// `action=get_flickr_key`: a JSON string, or a status message.
pub fn key(state: &AppState) -> Response {
    match configured_key(state) {
        Some(key) => json(json!({"status": "OK", "data": key})),
        None => json(json!({"status": "Flickr API key is not configured"})),
    }
}

/// `action=flickr_api`: read-only Flickr API proxy. Flickr's API is not in the
/// Toolforge CSP's `connect-src`, and keeping the key server-side also avoids
/// sending it to every browser.
pub async fn proxy(state: &AppState, raw_params: &str, same_origin: bool) -> Response {
    if !same_origin {
        return json(flickr_failure("Requests must come from this site"));
    }
    let Ok(params) = serde_json::from_str::<Value>(raw_params) else {
        return json(flickr_failure("Invalid Flickr parameters"));
    };
    let Some(method) = params.get("method").and_then(Value::as_str) else {
        return json(flickr_failure("No Flickr method given"));
    };
    let Some(key) = configured_key(state) else {
        return json(flickr_failure("Flickr API key is not configured"));
    };
    let url = match flickr_url(method, &key, &params) {
        Ok(url) => url,
        Err(error) => return json(flickr_failure(error)),
    };
    let response = match state.http.get(url).timeout(FLICKR_TIMEOUT).send().await {
        Ok(response) => response,
        Err(error) => return json(flickr_failure(format!("Flickr API failed: {error}"))),
    };
    let status = response.status();
    if !status.is_success() {
        return json(flickr_failure(format!("Flickr API failed ({status})")));
    }
    match response.json::<Value>().await {
        Ok(answer) => json(answer),
        Err(error) => json(flickr_failure(format!("Invalid Flickr answer: {error}"))),
    }
}

/// `action=flickr_thumb`: proxy a Flickr thumbnail, which the CSP would also
/// block. Only HTTPS URLs on Flickr's static image hosts are accepted.
pub async fn thumbnail(state: &AppState, raw_url: &str, same_origin: bool) -> Response {
    if !same_origin {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(url) = flickr_thumbnail_url(raw_url) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let response = match state
        .download
        .get(url)
        .timeout(THUMBNAIL_TIMEOUT)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("thumbnail fetch failed: {error}");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    if !response.status().is_success() {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !content_type.starts_with("image/") {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let mut response = response;
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > THUMBNAIL_MAX_BYTES {
                    return StatusCode::PAYLOAD_TOO_LARGE.into_response();
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(error) => {
                tracing::warn!("thumbnail body failed: {error}");
                return StatusCode::BAD_GATEWAY.into_response();
            }
        }
    }
    let mut out = (StatusCode::OK, body).into_response();
    let headers = out.headers_mut();
    if let Ok(value) = HeaderValue::from_str(&content_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    out
}

fn flickr_thumbnail_url(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return None;
    }
    let host = url.host_str()?;
    host.ends_with(".staticflickr.com").then_some(url)
}

fn flickr_failure(message: impl Into<String>) -> Value {
    json!({"stat": "fail", "message": message.into()})
}

fn flickr_url(method: &str, key: &str, params: &Value) -> Result<Url, String> {
    if !FLICKR_METHODS.contains(&method) {
        return Err("Unknown Flickr method".to_string());
    }
    let object = params
        .as_object()
        .ok_or_else(|| "Invalid Flickr parameters".to_string())?;
    if object.len() > 32 {
        return Err("Too many Flickr parameters".to_string());
    }
    let mut url = Url::parse(FLICKR_API).map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("method", method);
        query.append_pair("api_key", key);
        query.append_pair("format", "json");
        query.append_pair("nojsoncallback", "1");
        for (name, value) in object {
            if matches!(
                name.as_str(),
                "method" | "api_key" | "format" | "nojsoncallback"
            ) {
                continue;
            }
            let text = match value {
                Value::String(text) => text.clone(),
                Value::Number(number) => number.to_string(),
                Value::Bool(flag) => flag.to_string(),
                _ => return Err(format!("Invalid Flickr parameter {name}")),
            };
            if text.len() > 2048 {
                return Err(format!("Flickr parameter {name} is too long"));
            }
            query.append_pair(name, &text);
        }
    }
    Ok(url)
}

/// `action=check_existing_commons_filenames`: `0` unused, `1` exists,
/// `2` deleted before.
pub async fn existing_filenames(state: &AppState, filenames: &str) -> Response {
    let Ok(names) = serde_json::from_str::<Vec<String>>(filenames) else {
        return json(json!({"status": "Invalid filename list"}));
    };
    let mut status: BTreeMap<String, u8> = BTreeMap::new();
    for name in names {
        let name = wiki_file_name(&name);
        if !name.is_empty() {
            status.insert(name, 0);
        }
    }
    if status.is_empty() {
        return json(json!({"status": "OK", "data": {"files": status}}));
    }
    let names: Vec<String> = status.keys().cloned().collect();
    let Some(replicas) = state.replicas.as_ref() else {
        return api_fallback(state, names, status).await;
    };
    let conn = match replicas.conn(&Wiki::commons(), &["page", "logging"]).await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("replica connection failed: {e:#}");
            return json(json!({"status": "The Commons database is unavailable"}));
        }
    };

    let mut conn = conn;
    for chunk in names.chunks(NAME_BATCH) {
        let sql = format!(
            "SELECT DISTINCT page_title FROM page \
             WHERE page_namespace=6 AND page_title IN ({})",
            placeholders_for(chunk.len())
        );
        let params = positional(chunk.iter().cloned());
        if let Ok(rows) = conn
            .exec::<wikimisc::mysql_async::Row, _, _>(sql, params)
            .await
        {
            for row in rows {
                if let Some(title) = row.get::<String, _>("page_title") {
                    status.insert(title, 1);
                }
            }
        } else {
            tracing::warn!("checking existing file names failed");
        }
    }
    let deleted: Vec<String> = status
        .iter()
        .filter(|(_, s)| **s == 0)
        .map(|(name, _)| name.clone())
        .collect();
    for chunk in deleted.chunks(NAME_BATCH) {
        let sql = format!(
            "SELECT DISTINCT log_title FROM logging \
             WHERE log_type='delete' AND log_action='delete' AND log_namespace=6 \
             AND log_title IN ({})",
            placeholders_for(chunk.len())
        );
        let params = positional(chunk.iter().cloned());
        if let Ok(rows) = conn
            .exec::<wikimisc::mysql_async::Row, _, _>(sql, params)
            .await
        {
            for row in rows {
                if let Some(title) = row.get::<String, _>("log_title") {
                    status.insert(title, 2);
                }
            }
        }
    }
    json(json!({"status": "OK", "data": {"files": status}}))
}

/// Without replicas, ask the Commons API instead. The deletion check is one
/// request per name, so it is only done for names that do not exist.
async fn api_fallback(
    state: &AppState,
    names: Vec<String>,
    mut status: BTreeMap<String, u8>,
) -> Response {
    for chunk in names.chunks(50) {
        let titles: Vec<String> = chunk.iter().map(|name| format!("File:{name}")).collect();
        let joined = titles.join("|");
        let params = [("action", "query"), ("titles", joined.as_str())];
        match wikimisc::wiki_api::api_post(&state.http, &Wiki::commons(), &params).await {
            Ok(answer) => {
                for page in answer["query"]["pages"].as_array().into_iter().flatten() {
                    if page.get("missing").is_none()
                        && let Some(title) =
                            page["title"].as_str().and_then(|t| t.strip_prefix("File:"))
                    {
                        status.insert(title.to_string(), 1);
                    }
                }
            }
            Err(e) => tracing::warn!("Commons API check failed: {e}"),
        }
    }
    let missing: Vec<String> = status
        .iter()
        .filter(|(_, s)| **s == 0)
        .map(|(name, _)| name.clone())
        .collect();
    for name in missing {
        let Ok(filename) = FileName::new(&name) else {
            continue;
        };
        match state.commons.was_deleted(&filename).await {
            Ok(true) => {
                status.insert(name, 2);
            }
            Ok(false) => {}
            Err(e) => tracing::warn!("deletion log check failed: {e}"),
        }
    }
    json(json!({"status": "OK", "data": {"files": status}}))
}

/// `action=check_flickr_files_in_commons`: Flickr photo id => Commons file name.
pub async fn files_in_commons(state: &AppState, data: &str) -> Response {
    let Ok(data) = serde_json::from_str::<Value>(data) else {
        return json(json!({"status": "Invalid data"}));
    };
    let Some(replicas) = state.replicas.as_ref() else {
        return json(json!({"status": "The Commons database is unavailable"}));
    };
    let owners = owner_names(&data["owners"]);
    let mut found: BTreeMap<String, String> = BTreeMap::new();
    let conn = match replicas
        .conn(&Wiki::commons(), &["page", "externallinks"])
        .await
    {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("replica connection failed: {e:#}");
            return json(json!({"status": "The Commons database is unavailable"}));
        }
    };
    let mut conn = conn;

    for prefixes in prefixes(&data["files"], &owners) {
        let exact: Vec<String> = prefixes.clone();
        let like: Vec<String> = prefixes
            .iter()
            .map(|p| format!("{}/%", escape_like(p)))
            .collect();
        let domain_count = FLICKR_DOMAINS.len();
        let conditions = vec!["el_to_path LIKE ? ESCAPE '!'"; prefixes.len()].join(" OR ");
        let sql = format!(
            "SELECT DISTINCT page_title,el_to_path FROM page,externallinks \
             WHERE page_id=el_from AND page_namespace=6 \
             AND el_to_domain_index IN ({}) \
             AND (el_to_path IN ({}) OR {})",
            placeholders_for(domain_count),
            placeholders_for(exact.len()),
            conditions,
        );
        let mut values: Vec<DbValue> = FLICKR_DOMAINS
            .iter()
            .map(|d| DbValue::from(d.to_string()))
            .collect();
        values.extend(exact.into_iter().map(DbValue::from));
        values.extend(like.into_iter().map(DbValue::from));
        let params = Params::Positional(values);
        match conn
            .exec::<wikimisc::mysql_async::Row, _, _>(sql, params)
            .await
        {
            Ok(rows) => {
                for row in rows {
                    let (Some(title), Some(path)) = (
                        row.get::<String, _>("page_title"),
                        row.get::<String, _>("el_to_path"),
                    ) else {
                        continue;
                    };
                    let Some(regex) = PHOTO_PATH.as_ref() else {
                        continue;
                    };
                    if let Some(id) = regex.captures(&path).and_then(|c| c.get(1)) {
                        found.insert(id.as_str().to_string(), title);
                    }
                }
            }
            Err(e) => tracing::warn!("Flickr usage query failed: {e:#}"),
        }
    }
    json(json!({"status": "OK", "data": {"files": found}}))
}

/// Every URL name that may stand in for an owner.
fn owner_names(owners: &Value) -> HashMap<String, Vec<String>> {
    let mut names = HashMap::new();
    let Some(owners) = owners.as_object() else {
        return names;
    };
    for (nsid, value) in owners {
        let mut candidates = Vec::new();
        match value {
            Value::String(name) => candidates.push(name.clone()),
            Value::Array(values) => {
                candidates.extend(values.iter().filter_map(Value::as_str).map(str::to_string))
            }
            _ => {}
        }
        candidates.push(nsid.clone());
        let mut unique = BTreeSet::new();
        for name in candidates {
            let name = name.trim();
            if !name.is_empty() && !name.chars().any(|c| c.is_whitespace() || c == '/') {
                unique.insert(name.to_string());
            }
        }
        names.insert(nsid.clone(), unique.into_iter().collect());
    }
    names
}

/// Photo-page path prefixes, in batches.
fn prefixes(files: &Value, owners: &HashMap<String, Vec<String>>) -> Vec<Vec<String>> {
    let mut batches = Vec::new();
    let mut current = Vec::new();
    let Some(files) = files.as_object() else {
        return batches;
    };
    for (nsid, ids) in files {
        let users = owners
            .get(nsid)
            .cloned()
            .unwrap_or_else(|| vec![nsid.clone()]);
        for id in ids.as_array().into_iter().flatten() {
            let id = match id {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };
            if !id.chars().all(|c| c.is_ascii_digit()) || id.is_empty() {
                continue;
            }
            for user in &users {
                for kind in ["photo", "photos"] {
                    current.push(format!("/{kind}/{user}/{id}"));
                    if current.len() >= PREFIX_BATCH {
                        batches.push(std::mem::take(&mut current));
                    }
                }
            }
        }
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

/// PHP's `ucfirst(str_replace(' ', '_', trim($name)))`.
fn wiki_file_name(name: &str) -> String {
    let name = name.trim().replace(' ', "_");
    let mut chars = name.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

fn placeholders_for(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(",")
}

fn positional<I: Iterator<Item = String>>(values: I) -> Params {
    Params::Positional(values.map(DbValue::from).collect())
}

/// Neutralise LIKE wildcards, for use with `ESCAPE '!'`.
fn escape_like(value: &str) -> String {
    value
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flickr_proxy_allows_only_known_methods_and_scalars() {
        let query = |url: Url| {
            url.query_pairs()
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect::<HashMap<_, _>>()
        };
        let params = json!({
            "method": "flickr.photos.getInfo",
            "photo_id": "42",
            "page": 2
        });
        let built = query(flickr_url("flickr.photos.getInfo", "KEY", &params).unwrap());
        assert_eq!(built["method"], "flickr.photos.getInfo");
        assert_eq!(built["api_key"], "KEY");
        assert_eq!(built["photo_id"], "42");
        assert_eq!(built["page"], "2");
        assert_eq!(built["format"], "json");

        assert!(flickr_url("flickr.people.getPublicPhotos", "KEY", &params).is_ok());
        assert!(flickr_url("flickr.test.echo", "KEY", &params).is_err());
        assert!(flickr_url("flickr.photos.getInfo", "KEY", &json!({"photo_id": {}})).is_err());

        // The caller cannot override the key, format, or method.
        let built = query(
            flickr_url(
                "flickr.photos.getInfo",
                "KEY",
                &json!({"api_key": "INJECTED", "format": "xml", "method": "flickr.test.echo"}),
            )
            .unwrap(),
        );
        assert_eq!(built["api_key"], "KEY");
        assert_eq!(built["format"], "json");
        assert_eq!(built["method"], "flickr.photos.getInfo");
    }

    #[test]
    fn thumbnails_must_be_https_flickr_images() {
        assert!(flickr_thumbnail_url("https://live.staticflickr.com/65535/1_2_s.jpg").is_some());
        assert!(flickr_thumbnail_url("https://farm3.staticflickr.com/1/2.jpg").is_some());
        for bad in [
            "http://live.staticflickr.com/1.jpg",
            "https://live.staticflickr.com.evil.example/1.jpg",
            "https://evilstaticflickr.com/1.jpg",
            "https://live.staticflickr.com:8443/1.jpg",
            "https://user:pass@live.staticflickr.com/1.jpg",
            "https://127.0.0.1/1.jpg",
        ] {
            assert!(flickr_thumbnail_url(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn names_are_normalised_like_php() {
        assert_eq!(wiki_file_name("  a b.jpg "), "A_b.jpg");
        assert_eq!(wiki_file_name(""), "");
        assert_eq!(wiki_file_name("ä.jpg"), "Ä.jpg");
    }

    #[test]
    fn owner_names_include_the_nsid_and_drop_impossible_paths() {
        let owners = json!({"123": ["Some Name", "alias", "a/b"], "456": "other"});
        let names = owner_names(&owners);
        assert_eq!(names["123"], ["123", "alias"]);
        assert_eq!(names["456"], ["456", "other"]);
    }

    #[test]
    fn prefixes_are_batched_and_use_both_spellings() {
        let owners = owner_names(&json!({"123": ["me"]}));
        let batches = prefixes(&json!({"123": ["42", "abc"]}), &owners);
        assert_eq!(batches.len(), 1);
        assert!(batches[0].contains(&"/photo/me/42".to_string()));
        assert!(batches[0].contains(&"/photos/123/42".to_string()));
        assert!(!batches[0].iter().any(|p| p.contains("abc")));
    }

    #[test]
    fn wildcards_are_escaped() {
        assert_eq!(escape_like("/photo/a_b%c!d/1"), "/photo/a!_b!%c!!d/1");
    }

    #[test]
    fn photo_paths_yield_the_id_not_suffix_numbers() {
        let regex = PHOTO_PATH.as_ref().unwrap();
        assert_eq!(
            regex.captures("/photos/me/123/in/set-456").unwrap()[1],
            *"123"
        );
        assert_eq!(regex.captures("/photo/me/123").unwrap()[1], *"123");
        assert!(regex.captures("/photo/me/not-a-number").is_none());
    }
}
