//! HTTP layer: the front-end, the shared upload API, and the tools' own
//! endpoints at their old addresses.

mod apps;
mod error;
mod page;
mod params;

pub use error::AppError;
pub use page::{json, jsonp};
pub use params::Params;

use crate::state::AppState;
use axum::Router;
use axum::http::{HeaderValue, StatusCode, header};
use axum::routing::get;
use std::sync::Arc;
use std::time::Duration;
use tower_http::set_header::SetResponseHeaderLayer;

pub use wikimisc::server::{is_same_origin, moved};

/// Large downloads and uploads may legitimately take minutes.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const HEALTH_PATH: &str = "/healthz";

/// The tools with a page of their own; each is a route in the Vue app.
pub const TOOLS: &[&str] = &[
    "flickr2commons",
    "url2commons",
    "geograph2commons",
    "commonshelper",
];

pub fn router(state: Arc<AppState>) -> Router {
    // Everything that needs the state is merged first; `with_state` then makes
    // the router independent of it for the fallback and the layers.
    let router = Router::new()
        .route("/", get(apps::index))
        .route("/index.html", get(apps::index))
        .merge(crate::api::routes())
        .merge(crate::commonshelper::routes())
        .merge(crate::geograph::routes())
        .route(HEALTH_PATH, get(health));

    let router = TOOLS.iter().fold(router, |router, tool| {
        // The tool page itself is the SPA; the old addresses lead there.
        let page = format!("/{tool}/");
        router
            .route(&page, get(apps::index))
            .route(&format!("/{tool}"), moved(&page))
            .route(&format!("/{tool}.php"), moved(&page))
            .route(&format!("/{tool}/index.php"), moved(&page))
            .route(&format!("/{tool}/index.html"), moved(&page))
            // The OAuth wrapper of every old tool is now the shared API.
            .route(
                &format!("/{tool}/api.php"),
                get(crate::api::handler).post(crate::api::handler),
            )
            .route(
                &format!("/{tool}/api"),
                get(crate::api::handler).post(crate::api::handler),
            )
    });

    let router = router
        .with_state(state)
        .fallback_service(apps::service())
        .layer(header_layer(header::X_CONTENT_TYPE_OPTIONS, "nosniff"))
        .layer(header_layer(
            header::REFERRER_POLICY,
            "strict-origin-when-cross-origin",
        ));
    let router = wikimisc::server::timeout(router, REQUEST_TIMEOUT, StatusCode::GATEWAY_TIMEOUT);
    wikimisc::server::request_metrics(wikimisc::server::standard_layers(router), &[HEALTH_PATH])
}

async fn health() -> impl axum::response::IntoResponse {
    (StatusCode::OK, "ok")
}

fn header_layer(
    name: header::HeaderName,
    value: &'static str,
) -> SetResponseHeaderLayer<HeaderValue> {
    SetResponseHeaderLayer::if_not_present(name, HeaderValue::from_static(value))
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    pub struct TestResponse {
        pub status: StatusCode,
        pub headers: axum::http::HeaderMap,
        pub body: String,
    }

    /// The full router, without OAuth or replicas configured.
    pub async fn request(method: &str, uri: &str) -> TestResponse {
        let dir = tempfile::tempdir().unwrap();
        let config: crate::config::Config = serde_json::from_value(serde_json::json!({
            "oauth": dir.path().join("none.ini"),
            "replica_credentials": dir.path().join("none.cnf"),
        }))
        .unwrap();
        let state = AppState::new(config).unwrap();
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        let response = router(Arc::new(state)).oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        TestResponse {
            status,
            headers,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        }
    }

    pub async fn get(uri: &str) -> TestResponse {
        request("GET", uri).await
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::get;
    use super::*;

    #[tokio::test]
    async fn health_and_front_end() {
        let health = get("/healthz").await;
        assert_eq!((health.status.as_u16(), health.body.as_str()), (200, "ok"));
        let index = get("/").await;
        assert_eq!(index.status.as_u16(), 200);
        assert!(index.body.contains("id=\"app\""));
        assert_eq!(index.headers["x-content-type-options"], "nosniff");
    }

    #[tokio::test]
    async fn assets_are_served() {
        let css = get("/assets/style.css").await;
        assert_eq!(css.status.as_u16(), 200);
        assert!(
            css.headers["content-type"]
                .to_str()
                .unwrap()
                .starts_with("text/css")
        );
        assert!(get("/assets/app.js").await.body.contains("Vue"));
        let icon = get("/assets/img/magpie.jpg").await;
        assert_eq!(icon.status.as_u16(), 200);
        assert_eq!(icon.headers["content-type"], "image/jpeg");
    }

    #[tokio::test]
    async fn every_tool_has_a_page_and_its_old_address_redirects() {
        for tool in TOOLS {
            let page = get(&format!("/{tool}/")).await;
            assert_eq!(page.status.as_u16(), 200, "{tool}");
            assert!(page.body.contains("id=\"app\""), "{tool}");
            let old = get(&format!("/{tool}.php?image=X")).await;
            assert_eq!(old.status.as_u16(), 308, "{tool}");
            assert_eq!(
                old.headers["location"],
                format!("/{tool}/?image=X"),
                "{tool}"
            );
            assert_eq!(
                get(&format!("/{tool}")).await.headers["location"],
                format!("/{tool}/")
            );
            let old_index = get(&format!("/{tool}/index.html?image=X")).await;
            assert_eq!(old_index.status.as_u16(), 308, "{tool}");
            assert_eq!(
                old_index.headers["location"],
                format!("/{tool}/?image=X"),
                "{tool}"
            );
        }
    }

    #[tokio::test]
    async fn unknown_paths_are_not_found() {
        let response = get("/no_such_tool.php").await;
        assert_eq!(response.status.as_u16(), 404);
        assert!(!response.body.contains("Cargo.toml"));
    }
}
