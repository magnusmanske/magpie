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
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use wikimisc::wiki::encode_component;

/// The Geograph sites the tool supports.
const SERVERS: &[&str] = &[
    "www.geograph.org.uk",
    "www.geograph.ie",
    "www.geograph.org.gg",
    "geo-en.hlipp.de",
];
const TIMEOUT: Duration = Duration::from_secs(20);
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
    json(json!({"main": main, "reuse": reuse})).into_response()
}

async fn fetch(client: &reqwest::Client, url: &str) -> Option<String> {
    let response = client.get(url).send().await.ok()?;
    if response.status() != StatusCode::OK {
        return None;
    }
    response.text().await.ok()
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
    fn server_list_matches_the_php_tool() {
        assert_eq!(SERVERS.len(), 4);
        assert!(SERVERS.contains(&"geo-en.hlipp.de"));
    }
}
