//! Reading a file page from the source wiki: its wikitext, templates,
//! categories, and upload history, in one API request.

use serde::Deserialize;
use serde_json::Value;
use wikimisc::wiki::Wiki;
use wikimisc::wiki_api;

/// One upload, newest first as the API returns them.
#[derive(Debug, Clone, Deserialize)]
pub struct Revision {
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub width: u64,
    #[serde(default)]
    pub height: u64,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Default)]
pub struct SourceInfo {
    pub exists: bool,
    pub history: Vec<Revision>,
    pub templates: Vec<String>,
    pub categories: Vec<String>,
    pub text: String,
}

impl SourceInfo {
    /// The current file, as the source wiki serves it.
    pub fn source_url(&self) -> Option<&str> {
        self.history
            .first()
            .map(|revision| revision.url.as_str())
            .filter(|url| !url.is_empty())
    }

    /// "width × height px" of the newest version, or empty.
    pub fn size_description(&self) -> String {
        match self.history.first() {
            Some(revision) if revision.width > 0 => {
                format!("{} × {} px", revision.width, revision.height)
            }
            _ => String::new(),
        }
    }
}

/// Reads `File:<image>` from `language.project`.
pub async fn fetch(
    http: &reqwest::Client,
    image: &str,
    language: &str,
    project: &str,
) -> Result<SourceInfo, wikimisc::wiki_api::WikiApiError> {
    let wiki = match Wiki::new(language, project) {
        Ok(wiki) => wiki,
        Err(e) => return Ok(missing(e.to_string())),
    };
    let title = format!("File:{image}");
    let params = [
        ("action", "query"),
        ("prop", "imageinfo|templates|categories|revisions"),
        ("titles", title.as_str()),
        (
            "iiprop",
            "timestamp|user|comment|url|sha1|size|mime|archivename",
        ),
        ("iilimit", "50"),
        ("tlnamespace", "10"),
        ("tllimit", "500"),
        ("cllimit", "500"),
        ("rvprop", "content"),
        ("rvslots", "main"),
    ];
    let answer = wiki_api::api(http, &wiki, &params).await?;
    Ok(parse(&answer))
}

fn missing(message: String) -> SourceInfo {
    // The caller reports a missing image itself; keep the result shape.
    let _ = message;
    SourceInfo::default()
}

fn parse(answer: &Value) -> SourceInfo {
    let Some(page) = answer["query"]["pages"]
        .as_array()
        .and_then(|pages| pages.first())
    else {
        return SourceInfo::default();
    };
    if page.get("missing").is_some() || page.get("invalid").is_some() {
        return SourceInfo::default();
    }
    let history = page["imageinfo"]
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| serde_json::from_value(entry.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    let titles = |key: &str| -> Vec<String> {
        page[key]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|entry| entry["title"].as_str())
            .map(namespace_stripped)
            .collect()
    };
    let text = page["revisions"][0]["slots"]["main"]["content"]
        .as_str()
        .or_else(|| page["revisions"][0]["slots"]["main"]["*"].as_str())
        .unwrap_or_default();
    SourceInfo {
        exists: true,
        history,
        templates: titles("templates"),
        categories: titles("categories"),
        text: strip_html_comments(text).trim().to_string(),
    }
}

/// `Template:Foo` => `Foo`, as the PHP tool did.
fn namespace_stripped(title: &str) -> String {
    title
        .split_once(':')
        .map_or(title, |(_, rest)| rest)
        .to_string()
}

/// Removes `<!-- … -->` blocks.
pub fn strip_html_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        match rest[start + 4..].find("-->") {
            Some(end) => rest = &rest[start + 4 + end + 3..],
            None => {
                // An unterminated comment: keep it, as the PHP helper does.
                out.push_str(&rest[start..]);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strips_comments() {
        assert_eq!(strip_html_comments("a<!-- x -->b"), "ab");
        assert_eq!(
            strip_html_comments("a<!-- unterminated"),
            "a<!-- unterminated"
        );
        assert_eq!(strip_html_comments("plain"), "plain");
    }

    #[test]
    fn reads_the_v2_shape() {
        let answer = json!({"query": {"pages": [{
            "title": "File:X.jpg",
            "imageinfo": [{"timestamp": "2020-01-02T03:04:05Z", "user": "U", "width": 10, "height": 20, "size": 30, "url": "https://x/y.jpg"}],
            "templates": [{"title": "Template:Foo"}],
            "categories": [{"title": "Category:Bar"}],
            "revisions": [{"slots": {"main": {"content": " {{Information}} <!-- c --> "}}}]
        }]}});
        let info = parse(&answer);
        assert!(info.exists);
        assert_eq!(info.history[0].user, "U");
        assert_eq!(info.templates, ["Foo"]);
        assert_eq!(info.categories, ["Bar"]);
        assert_eq!(info.text, "{{Information}}");
        assert_eq!(info.size_description(), "10 × 20 px");
        assert_eq!(info.source_url(), Some("https://x/y.jpg"));
    }

    #[test]
    fn missing_pages_are_not_errors() {
        assert!(!parse(&json!({"query": {"pages": [{"missing": true}]}})).exists);
        assert!(!parse(&json!({})).exists);
    }
}
