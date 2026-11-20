//! The shared upload API, at `/api.php` and `/api`.
//!
//! It keeps the request and response shape of `magnustools/public_html/oauth_uploader.php`,
//! which all four PHP transfer tools call, and adds the Flickr2Commons
//! bookkeeping actions. Authentication is one OAuth login for the whole
//! service, kept in an encrypted cookie under `/`.

mod flickr;
mod user;

use crate::state::AppState;
use crate::web::{AppError, Params, is_same_origin, jsonp};
use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum_extra::extract::PrivateCookieJar;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use wikimisc::oauth1::Session;

/// One login for every tool; the cookie is sent with each tool's requests.
const SESSION: Session = Session {
    name: "magpie_auth",
    path: "/",
};
const NOT_AUTHORIZED: &str = "You have not authorised this tool yet; log in at /";
/// Upload warnings refused with `blockwarnings=1`: the identical file is
/// already on Commons, or was deleted before.
const DEFAULT_BLOCKING_WARNINGS: &[&str] = &["duplicate", "duplicate-archive"];

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api.php", get(handler).post(handler))
        .route("/api", get(handler).post(handler))
}

#[derive(Debug, Default, Deserialize)]
pub struct Request {
    action: Option<String>,
    botmode: Option<String>,
    callback: Option<String>,
    site: Option<String>,
    #[serde(default)]
    page: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    newfile: String,
    #[serde(default)]
    desc: String,
    #[serde(default)]
    comment: String,
    ignorewarnings: Option<String>,
    blockwarnings: Option<String>,
    #[serde(default)]
    params: String,
    oauth_verifier: Option<String>,
    oauth_token: Option<String>,
    /// Flickr bookkeeping: a JSON object of owners and file ids.
    #[serde(default)]
    data: String,
    /// Flickr bookkeeping: a JSON array of file names.
    #[serde(default)]
    filenames: String,
}

impl Request {
    fn botmode(&self) -> bool {
        self.botmode
            .as_deref()
            .is_some_and(|value| !value.is_empty() && value != "0")
    }

    fn blocking_warnings(&self) -> Vec<String> {
        blocking_warnings(self.blockwarnings.as_deref())
    }

    fn ignore_warnings(&self) -> bool {
        self.ignorewarnings
            .as_deref()
            .is_some_and(|value| !value.is_empty() && value != "0")
    }
}

pub async fn handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Params(request): Params<Request>,
) -> Result<Response, AppError> {
    // The OAuth handshake and the bookkeeping actions need no logged-in user.
    if let (Some(verifier), Some(token)) = (&request.oauth_verifier, &request.oauth_token) {
        return Ok(login_callback(&state, state.cookies(&headers), verifier, token).await);
    }
    let action = request.action.clone().unwrap_or_default();
    if action == "logout" {
        return Ok((
            SESSION.without_tokens(state.cookies(&headers)),
            Redirect::to("/"),
        )
            .into_response());
    }
    if action == "authorize" {
        let Some(oauth) = state.oauth.as_ref() else {
            return Ok(api_failure("OAuth is not configured"));
        };
        let (request_token, url) = oauth.initiate(&state.config.oauth_callback()).await?;
        let jar = SESSION.with_request_token(state.cookies(&headers), &request_token);
        return Ok((jar, Redirect::to(&url)).into_response());
    }
    if action == "get_flickr_key" {
        return Ok(flickr::key(&state));
    }
    if action == "flickr_api" {
        return Ok(flickr::proxy(&state, &request.params, is_same_origin(&headers)).await);
    }
    if action == "flickr_thumb" {
        return Ok(flickr::thumbnail(&state, &request.url, is_same_origin(&headers)).await);
    }
    if action == "check_existing_commons_filenames" {
        return Ok(flickr::existing_filenames(&state, &request.filenames).await);
    }
    if action == "check_flickr_files_in_commons" {
        return Ok(flickr::files_in_commons(&state, &request.data).await);
    }

    let Some(oauth) = state.oauth.as_ref() else {
        return Ok(api_failure("OAuth is not configured"));
    };
    let site = request.site.as_deref().unwrap_or("commons.wikimedia.org");
    let wiki = match wikimisc::wiki::Wiki::from_domain_prefix(site.trim().trim_end_matches(".org"))
    {
        Ok(wiki) => wiki,
        Err(error) if request.botmode() => return Ok(api_failure(&error.to_string())),
        Err(error) => return Err(error.into()),
    };
    let user = user::User {
        oauth,
        token: SESSION.access_token(&state.cookies(&headers)),
        api_url: wiki.api_url(),
        state: &state,
    };

    let mut out = Map::from_iter([
        ("error".to_string(), json!("OK")),
        ("data".to_string(), json!([])),
    ]);
    let writes = ["setpagetext", "upload", "upload_from_url", "sdc"];
    let same_origin = is_same_origin(&headers);
    let result: Result<(), String> = match action.as_str() {
        "checkauth" | "get_rights" => user.check().await.map(|rights| {
            let key = if action == "checkauth" {
                "data"
            } else {
                "result"
            };
            out.insert(key.to_string(), rights);
        }),
        // Changes only from this site: other sites could otherwise act in the user's name.
        a if writes.contains(&a) && !same_origin => {
            Err("Requests must come from this site".to_string())
        }
        "setpagetext" => user.edit_page(&request.page, &request.text).await,
        "upload" | "upload_from_url" => {
            let (result, response) = user.upload(&request).await;
            out.insert("res".to_string(), response.unwrap_or(Value::Null));
            result
        }
        "sdc" => {
            let params: Value = serde_json::from_str(&request.params).unwrap_or(Value::Null);
            out.insert(
                "jle".to_string(),
                json!(if params.is_null() { 4 } else { 0 }),
            );
            out.insert("j".to_string(), params.clone());
            user.generic_action(params).await
        }
        _ if request.botmode() => Err("Unknown action".to_string()),
        _ => Ok(()),
    };

    if request.botmode() {
        if let Err(error) = result {
            out.insert("error".to_string(), error.into());
        }
        return Ok(jsonp(Value::Object(out), request.callback).into_response());
    }
    if let Err(error) = result {
        return Ok(api_failure(&error));
    }
    Ok(api_success())
}

async fn login_callback(
    state: &AppState,
    jar: PrivateCookieJar,
    verifier: &str,
    token: &str,
) -> Response {
    let Some(oauth) = state.oauth.as_ref() else {
        return api_failure("OAuth is not configured");
    };
    let Some(request) = SESSION.request_token(&jar).filter(|t| t.key == token) else {
        return Redirect::to("/").into_response();
    };
    match oauth.access_token(&request, verifier).await {
        Ok(access) => (SESSION.with_access_token(jar, &access), Redirect::to("/")).into_response(),
        Err(e) => {
            tracing::warn!("OAuth login failed: {e:#}");
            (
                StatusCode::BAD_GATEWAY,
                "The login failed; please try again.",
            )
                .into_response()
        }
    }
}

fn api_failure(message: &str) -> Response {
    jsonp(json!({"error": message, "data": []}), None).into_response()
}

fn api_success() -> Response {
    jsonp(json!({"error": "OK", "data": []}), None).into_response()
}

/// From `blockwarnings`: absent, empty, `0` or `false` blocks nothing; `1` or
/// `true` the defaults; otherwise a `|`- or `,`-separated list of warning keys.
fn blocking_warnings(raw: Option<&str>) -> Vec<String> {
    let raw = raw.unwrap_or_default().trim();
    match raw.to_lowercase().as_str() {
        "" | "0" | "false" => vec![],
        "1" | "true" => DEFAULT_BLOCKING_WARNINGS
            .iter()
            .map(|w| (*w).to_string())
            .collect(),
        _ => {
            let mut keys: Vec<String> = raw
                .split(['|', ','])
                .map(str::trim)
                .filter(|k| {
                    !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                })
                .map(str::to_string)
                .collect();
            keys.dedup();
            keys
        }
    }
}

/// The file name on the wiki: as given, or the URL's last part.
#[cfg(test)]
fn upload_name(newfile: &str, url: &str) -> String {
    match newfile.trim() {
        "" => url.rsplit('/').next().unwrap_or_default().to_string(),
        name => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warning_lists() {
        assert!(blocking_warnings(None).is_empty());
        assert!(blocking_warnings(Some("0")).is_empty());
        assert_eq!(
            blocking_warnings(Some("1")),
            ["duplicate", "duplicate-archive"]
        );
        assert_eq!(
            blocking_warnings(Some("exists|duplicate")),
            ["exists", "duplicate"]
        );
        assert!(blocking_warnings(Some("bad key!")).is_empty());
    }

    #[test]
    fn names_come_from_the_parameter_or_the_url() {
        assert_eq!(
            upload_name("New name.jpg", "https://x/a.jpg"),
            "New name.jpg"
        );
        assert_eq!(upload_name("", "https://x/a/b.jpg?x=1"), "b.jpg?x=1");
    }
}
