//! JSON/JSONP responses, in the shapes the old tool scripts expect.

use axum::response::{IntoResponse, Response};
use serde::Serialize;
use wikimisc::server::jsonp::{CallbackRules, Jsonp};

/// `value` as JSON, or as JSONP if there is a callback. Callers of the old
/// tools use jQuery-style names (`jQuery123_456`) and dotted paths.
pub fn jsonp<T: Serialize>(value: T, callback: Option<String>) -> Jsonp<T> {
    Jsonp::new(value, callback).rules(CallbackRules {
        allow_dotted: true,
        max_len: 128,
    })
}

/// A JSON body, for the newer endpoints.
pub fn json<T: Serialize>(value: T) -> Response {
    let body = match serde_json::to_string(&value) {
        Ok(body) => body,
        Err(_) => return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    async fn body_of(response: Response) -> (StatusCode, String) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    #[tokio::test]
    async fn jsonp_accepts_dotted_callbacks_and_refuses_code() {
        let (status, body) = body_of(
            jsonp(serde_json::json!({"a": 1}), Some("jQuery123_456.cb".into())).into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "jQuery123_456.cb({\"a\":1});");

        for callback in ["a-b", "a..b", "alert(1)", "1abc"] {
            let (status, _) =
                body_of(jsonp(serde_json::json!(1), Some(callback.into())).into_response()).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{callback}");
        }
    }

    #[tokio::test]
    async fn plain_json_has_the_right_content_type() {
        let response = json(serde_json::json!({"a": 1}));
        assert_eq!(response.headers()["content-type"], "application/json");
        assert_eq!(body_of(response).await.1, "{\"a\":1}");
    }
}
