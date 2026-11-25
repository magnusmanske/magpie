//! `geograph2commons/g2c.php`: the photo page and the reuse page of a
//! Geograph image, so the front-end can read the image URL and description.
//!
//! Geograph's Cloudflare turns away requests without a user agent, and answers
//! 410 for photos that are gone. Both pages must be 200 to be used.

use crate::web::{Params, json};
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use wikimisc::wiki::encode_component;

/// The Geograph sites the tool supports.
const SERVERS: &[&str] = &[
    "www.geograph.org.uk",
    "www.geograph.ie",
    "www.geograph.org.gg",
    "geo.hlipp.de",
    "geo-en.hlipp.de",
];
const TIMEOUT: Duration = Duration::from_secs(20);
/// The main site has a JSON API; the other hosts do not resolve an API host.
const API_HOST: &str = "api.geograph.org.uk";
/// Geograph's Cloudflare wants a recognizable agent.
const USER_AGENT: &str = "geograph2commons (https://magpie.toolforge.org/)";

pub fn routes() -> Router<Arc<crate::state::AppState>> {
    Router::new()
        .route("/geograph2commons/g2c", get(handler).post(handler))
        .route("/geograph2commons/g2c.php", get(handler).post(handler))
}

/// Geograph's Cloudflare wants a recognizable agent; keep the old one.
pub fn client() -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()?)
}

#[derive(Debug, Default, Deserialize)]
struct Request {
    server: Option<String>,
    photo_id: Option<String>,
}

async fn handler(
    State(state): State<Arc<crate::state::AppState>>,
    Params(request): Params<Request>,
) -> Response {
    let server = request.server.as_deref().unwrap_or_default();
    let photo_id = request.photo_id.as_deref().unwrap_or_default();
    if !SERVERS.contains(&server)
        || photo_id.is_empty()
        || !photo_id.chars().all(|c| c.is_ascii_digit())
    {
        return (
            StatusCode::BAD_REQUEST,
            json(json!({
                "main": false,
                "reuse": false,
                "error": format!(
                    "Server must be one of {}; photo ID a number",
                    SERVERS.join(", ")
                ),
            })),
        )
            .into_response();
    }
    let id = encode_component(photo_id);
    let main = fetch(&state.geograph, &format!("https://{server}/photo/{id}")).await;
    let reuse = fetch(
        &state.geograph,
        &format!("https://{server}/reuse.php?id={id}"),
    )
    .await;
    // `reuse.php` is behind a Cloudflare challenge for many clients, so also
    // ask the JSON API. The front-end uses it when the reuse page is missing.
    let api = match api_host(server) {
        Some(host) => {
            fetch_json(
                &state.geograph,
                &format!("https://{host}/api/photo/{id}?format=json"),
            )
            .await
        }
        None => None,
    };
    json(json!({"main": main, "reuse": reuse, "api": api})).into_response()
}

/// The JSON API exists for the main Geograph site; the other servers either
/// have no API host or redirect away from it.
fn api_host(server: &str) -> Option<&'static str> {
    (server == "www.geograph.org.uk").then_some(API_HOST)
}

async fn fetch(client: &reqwest::Client, url: &str) -> Option<String> {
    let response = client.get(url).send().await.ok()?;
    if response.status() != StatusCode::OK {
        return None;
    }
    response.text().await.ok()
}

async fn fetch_json(client: &reqwest::Client, url: &str) -> Option<Value> {
    serde_json::from_str(&fetch(client, url).await?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::web::test_support::request;

    #[tokio::test]
    async fn rejects_unknown_servers_and_bad_ids() {
        for query in [
            "",
            "?server=evil.example&photo_id=1",
            "?server=www.geograph.org.uk&photo_id=abc",
            "?server=www.geograph.org.uk&photo_id=",
        ] {
            let response = request("GET", &format!("/geograph2commons/g2c{query}")).await;
            assert_eq!(response.status.as_u16(), 400, "{query}");
            assert!(response.body.contains("\"main\":false"), "{query}");
        }
    }

    #[test]
    fn server_list_contains_the_supported_sites() {
        assert_eq!(SERVERS.len(), 5);
        assert!(SERVERS.contains(&"geo.hlipp.de"));
        assert!(SERVERS.contains(&"geo-en.hlipp.de"));
    }

    #[test]
    fn only_the_main_site_has_a_json_api() {
        assert_eq!(api_host("www.geograph.org.uk"), Some("api.geograph.org.uk"));
        assert_eq!(api_host("www.geograph.ie"), None);
        assert_eq!(api_host("geo-en.hlipp.de"), None);
    }
}
