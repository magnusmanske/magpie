//! CommonsHelper: reading a file page from another wiki and building the
//! Commons description page.
//!
//! The front-end calls `/commonshelper/translate` with the same parameters
//! the PHP tool took, then uploads the result through the shared API.

pub mod data;
mod source;
mod text;

pub use data::Catalog;

use crate::state::AppState;
use crate::web::{Params, json};
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/commonshelper/translate", get(handler).post(handler))
        .route("/commonshelper/translate.php", get(handler).post(handler))
}

#[derive(Debug, Default, Deserialize)]
struct Request {
    #[serde(default)]
    image: String,
    #[serde(default)]
    language: String,
    #[serde(default)]
    lang: String,
    #[serde(default)]
    project: String,
    #[serde(default)]
    newname: String,
    #[serde(default)]
    interface: String,
    #[serde(default)]
    remove_categories: String,
}

async fn handler(State(state): State<Arc<AppState>>, Params(request): Params<Request>) -> Response {
    let image = request.image.trim().to_string();
    let language = if request.language.trim().is_empty() {
        request.lang.trim().to_lowercase()
    } else {
        request.language.trim().to_lowercase()
    };
    let language = if language.is_empty() {
        "en".to_string()
    } else {
        language
    };
    let project = match request.project.trim() {
        "" => "wikipedia".to_string(),
        project => project.to_lowercase(),
    };
    if image.is_empty() {
        return bad_request("No image name given");
    }
    if !language
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || !project.chars().all(|c| c.is_ascii_lowercase())
    {
        return bad_request("Invalid language or project");
    }
    let remove_categories = request.remove_categories.trim();
    let remove_categories = !remove_categories.is_empty() && remove_categories != "0";

    let source = match source::fetch(&state.http, &image, &language, &project).await {
        Ok(source) => source,
        Err(e) => {
            tracing::warn!("reading {image} from {language}.{project} failed: {e}");
            return bad_request("Could not read the file page from the source wiki");
        }
    };
    if !source.exists {
        return json(json!({
            "error": format!("Image \"{image}\" does not exist on {language}.{project}!"),
            "exists": false,
        }))
        .into_response();
    }
    let newname = match request.newname.trim() {
        "" => image.clone(),
        newname => newname.to_string(),
    };
    let built = match text::build(
        &state.http,
        &state.helper,
        &source,
        &image,
        &language,
        &project,
        remove_categories,
    )
    .await
    {
        Ok(built) => built,
        Err(error) => return bad_request(&error),
    };
    let _ = request.interface; // Interface localisation is the front-end's job.
    json(json!({
        "error": "OK",
        "text": built.text,
        "is_good": built.is_good,
        "warnings": built.warnings,
        "image": image,
        "language": language,
        "project": project,
        "newname": newname,
        "source_url": source.source_url(),
        "size": source.size_description(),
        "exists": true,
    }))
    .into_response()
}

fn bad_request(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, json(json!({"error": message}))).into_response()
}

#[cfg(test)]
mod tests {
    use crate::web::test_support::get;

    #[tokio::test]
    async fn rejects_missing_images_and_bad_wikis() {
        assert_eq!(get("/commonshelper/translate").await.status.as_u16(), 400);
        let bad = get("/commonshelper/translate?image=X.jpg&language=en&project=evil1").await;
        assert_eq!(bad.status.as_u16(), 400);
        assert!(bad.body.contains("Invalid language or project"));
    }
}
