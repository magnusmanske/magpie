//! The front-end, built into the binary: one Vue 2 application with a view
//! per tool. `index.html` is served for every tool path so that the router can
//! take over; everything under `/assets/` comes from the same directory.

use super::Params;
use crate::web::AppError;
use axum::Router;
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use include_dir::{Dir, include_dir};
use percent_encoding::percent_decode_str;
use serde::Deserialize;
use serde_json::Value;

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

/// `url2commons` accepts `urls`/`desc`/`simulate`/`run` as a form POST, so a
/// long URL list does not have to fit in the request line. The values reach
/// the SPA through an inline bootstrap script.
#[derive(Debug, Default, Deserialize)]
pub struct Url2CommonsForm {
    urls: Option<String>,
    desc: Option<String>,
    simulate: Option<String>,
    run: Option<String>,
    interface_language: Option<String>,
}

pub async fn url2commons_form(Params(form): Params<Url2CommonsForm>) -> Response {
    let flag = |value: Option<String>| {
        value.is_some_and(|value| {
            let value = value.trim().to_ascii_lowercase();
            !value.is_empty() && value != "0" && value != "false"
        })
    };
    let simulate = flag(form.simulate);
    let run = flag(form.run);
    let mut bootstrap = serde_json::Map::new();
    if let Some(urls) = form.urls {
        bootstrap.insert("urls".into(), urls.into());
    }
    if let Some(desc) = form.desc {
        bootstrap.insert("desc".into(), desc.into());
    }
    if let Some(language) = form
        .interface_language
        .filter(|value| !value.trim().is_empty())
    {
        bootstrap.insert("interface_language".into(), language.into());
    }
    if simulate {
        bootstrap.insert("simulate".into(), true.into());
    }
    if run {
        bootstrap.insert("run".into(), true.into());
    }
    index_with_bootstrap(&Value::Object(bootstrap))
}

fn index_with_bootstrap(value: &Value) -> Response {
    let Some(file) = PUBLIC.get_file("index.html") else {
        return AppError::Internal("the front-end is missing from the binary".into())
            .into_response();
    };
    let mut html = String::from_utf8_lossy(file.contents()).into_owned();
    if let Some(index) = html.find("</head>") {
        html.insert_str(index, &bootstrap_script(value));
    }
    page(html.into_bytes())
}

fn bootstrap_script(value: &Value) -> String {
    let json = serde_json::to_string(value).unwrap_or_else(|_| "null".to_string());
    // Keep the embedded value from closing the script element or opening markup.
    let json = json
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    format!("<script>window.__MAGPIE_BOOTSTRAP__={json};</script>")
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

fn page(contents: impl Into<Vec<u8>>) -> Response {
    let mut response = (StatusCode::OK, contents.into()).into_response();
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
    fn bootstrap_script_cannot_close_its_element() {
        let script = bootstrap_script(&serde_json::json!({"urls": "</script><b>"}));
        assert!(script.contains("\\u003c/script\\u003e"));
        assert!(!script.contains("</script><b>"));
    }

    #[test]
    fn paths_are_resolved_safely() {
        assert!(lookup("/assets/style.css").is_some());
        assert!(lookup("/assets/").is_none());
        assert!(lookup("/assets/../Cargo.toml").is_none());
        assert!(lookup("/%2e%2e/Cargo.toml").is_none());
        assert!(lookup("/no_such_file.js").is_none());
    }
}
