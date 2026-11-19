//! The front-end, built into the binary: one Vue 2 application with a view
//! per tool. `index.html` is served for every tool path so that the router can
//! take over; everything under `/assets/` comes from the same directory.

use crate::web::AppError;
use axum::Router;
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use include_dir::{Dir, include_dir};
use percent_encoding::percent_decode_str;

static PUBLIC: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/assets");

/// The single-page application's shell.
pub async fn index() -> Response {
    match PUBLIC.get_file("index.html") {
        Some(file) => page(file.contents()),
        None => {
            AppError::Internal("the front-end is missing from the binary".into()).into_response()
        }
    }
}

/// Serves an embedded file at its URI path; a directory serves its
/// `index.html`. Everything else is a 404.
pub async fn serve(uri: Uri) -> Response {
    match lookup(uri.path()) {
        Some((path, contents)) => file(path, contents),
        None => AppError::NotFound.into_response(),
    }
}

fn lookup(uri_path: &str) -> Option<(&'static str, &'static [u8])> {
    let path = percent_decode_str(uri_path).decode_utf8().ok()?;
    let relative = path.trim_start_matches('/');
    // The binary embeds the contents of `assets/`; URLs address them under `/assets/`.
    let relative = relative.strip_prefix("assets/").unwrap_or(relative);
    if relative.is_empty() || relative.split('/').any(|s| s.starts_with('.')) {
        return None;
    }
    let wanted = match relative.strip_suffix('/') {
        Some(dir) => format!("{dir}/index.html"),
        None => relative.to_string(),
    };
    let file = PUBLIC.get_file(&wanted)?;
    Some((file.path().to_str()?, file.contents()))
}

fn page(contents: &'static [u8]) -> Response {
    let mut response = (StatusCode::OK, contents).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    // Deployments restart the service, so a short cache is enough.
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

fn file(path: &'static str, contents: &'static [u8]) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = (StatusCode::OK, contents).into_response();
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=600"),
    );
    response
}

/// The embedded files, as the router's fallback.
pub fn service() -> Router {
    Router::new().fallback(serve)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_resolved_safely() {
        assert!(lookup("/assets/style.css").is_some());
        assert!(lookup("/assets/").is_none());
        assert!(lookup("/assets/../Cargo.toml").is_none());
        assert!(lookup("/%2e%2e/Cargo.toml").is_none());
        assert!(lookup("/no_such_file.js").is_none());
    }
}
