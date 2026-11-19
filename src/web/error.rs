//! Errors a request can end in.

use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use wikimisc::wiki::UnknownWiki;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// The message is shown to the user.
    #[error("{0}")]
    BadRequest(String),
    #[error("not found")]
    NotFound,
    /// A wiki or other service failed us. Details are logged, not shown.
    #[error(transparent)]
    Upstream(#[from] anyhow::Error),
    #[error("{0}")]
    Internal(String),
}

impl From<UnknownWiki> for AppError {
    fn from(e: UnknownWiki) -> Self {
        Self::BadRequest(e.to_string())
    }
}

impl From<wikimisc::oauth1::OAuthError> for AppError {
    fn from(e: wikimisc::oauth1::OAuthError) -> Self {
        Self::Upstream(anyhow::Error::new(e))
    }
}

impl From<wikimisc::wiki_api::WikiApiError> for AppError {
    fn from(e: wikimisc::wiki_api::WikiApiError) -> Self {
        Self::Upstream(anyhow::Error::new(e))
    }
}

impl From<wikimisc::replicas::ReplicasError> for AppError {
    fn from(e: wikimisc::replicas::ReplicasError) -> Self {
        Self::Upstream(anyhow::Error::new(e))
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message.as_str()),
            Self::NotFound => (StatusCode::NOT_FOUND, "There is nothing at this address."),
            Self::Upstream(e) => {
                tracing::warn!("upstream failure: {e:#}");
                (
                    StatusCode::BAD_GATEWAY,
                    "A server this tool relies on did not answer as expected. Please try again later.",
                )
            }
            Self::Internal(e) => {
                tracing::error!("internal error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong on our side.",
                )
            }
        };
        let title = status.canonical_reason().unwrap_or("Error");
        (status, Html(error_page(title, message))).into_response()
    }
}

fn error_page(title: &str, message: &str) -> String {
    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>{title}</title><link rel=\"stylesheet\" href=\"/assets/style.css\"></head>\
         <body><main class=\"container\"><h1>{title}</h1><p>{message}</p>\
         <p><a href=\"/\">Back to the tools</a></p></main></body></html>",
        title = escape(title),
        message = escape(message),
    )
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn parts(error: AppError) -> (StatusCode, String) {
        let response = error.into_response();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&body).into_owned())
    }

    #[tokio::test]
    async fn each_kind_has_its_status_and_message() {
        let (status, body) = parts(AppError::BadRequest("bad <input>".into())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body.contains("bad &lt;input&gt;"), "{body}");

        let (status, body) = parts(AppError::NotFound).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(body.contains("nothing at this address"));
    }

    #[tokio::test]
    async fn internals_are_logged_but_not_shown() {
        for error in [
            AppError::Upstream(anyhow::anyhow!("database password in here")),
            AppError::Internal("secret path /etc/passwd".into()),
        ] {
            let (status, body) = parts(error).await;
            assert!(
                body.contains("Something went wrong")
                    || body.contains("did not answer as expected"),
                "{body}"
            );
            assert!(
                !body.contains("password") && !body.contains("passwd"),
                "{body}"
            );
            assert!(
                status == StatusCode::BAD_GATEWAY || status == StatusCode::INTERNAL_SERVER_ERROR
            );
        }
    }
}
