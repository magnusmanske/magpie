//! The logged-in user, acting on one wiki: checks, edits, and uploads.

use super::{NOT_AUTHORIZED, Request};
use crate::state::AppState;
use mediawiki_upload::{Credentials, FileName, UploadError, UploadRequest, Uploader};
use serde_json::{Value, json};
use std::time::Duration;
use wikimisc::oauth1::{OAuth, Token};

/// A pause after each edit or upload, as the old tools made.
const EDIT_DELAY: Duration = Duration::from_secs(1);

pub(super) struct User<'a> {
    pub oauth: &'a OAuth,
    pub token: Option<Token>,
    pub api_url: String,
    pub state: &'a AppState,
}

impl User<'_> {
    async fn api(&self, params: &[(&str, &str)]) -> Result<Value, String> {
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| NOT_AUTHORIZED.to_string())?;
        self.oauth
            .api(&self.api_url, Some(token), params)
            .await
            .map_err(|e| format!("{e:#}"))
    }

    /// The user's rights, if they may use this tool: logged in and autoconfirmed.
    pub async fn check(&self) -> Result<Value, String> {
        let rights = self
            .api(&[
                ("action", "query"),
                ("meta", "userinfo"),
                ("uiprop", "blockinfo|groups|rights"),
            ])
            .await?;
        if rights["error"]["code"] == "mwoauth-invalid-authorization" || rights["error"].is_string()
        {
            return Err(NOT_AUTHORIZED.to_string());
        }
        let userinfo = &rights["query"]["userinfo"];
        if userinfo.is_null() || userinfo.get("anon").is_some() {
            return Err("Auth not OK: not logged in".to_string());
        }
        let groups = userinfo["groups"].as_array().into_iter().flatten();
        if !groups
            .filter_map(Value::as_str)
            .any(|g| g == "autoconfirmed")
        {
            return Err("Auth not OK: your account needs to be autoconfirmed".to_string());
        }
        Ok(rights)
    }

    async fn csrf_token(&self) -> Result<String, String> {
        let answer = self.api(&[("action", "query"), ("meta", "tokens")]).await?;
        answer["query"]["tokens"]["csrftoken"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("Bad API response: {answer}"))
    }

    pub async fn edit_page(&self, page: &str, text: &str) -> Result<(), String> {
        self.check().await?;
        let text = text.trim();
        if text.is_empty() {
            return Err("No text given".to_string());
        }
        let token = self.csrf_token().await?;
        let answer = self
            .api(&[
                ("action", "edit"),
                ("title", page.trim()),
                ("text", text),
                ("minor", ""),
                ("token", &token),
            ])
            .await?;
        api_error(&answer).map_or(Ok(()), Err)?;
        tokio::time::sleep(EDIT_DELAY).await;
        Ok(())
    }

    /// Any API action given as JSON, e.g. `wbeditentity` for structured data.
    pub async fn generic_action(&self, params: Value) -> Result<(), String> {
        self.check().await?;
        let Value::Object(params) = params else {
            return Err("params must be a JSON object".to_string());
        };
        if !params.contains_key("action") {
            return Err(format!("No action in {}", Value::Object(params)));
        }
        let token = self.csrf_token().await?;
        let mut fields: Vec<(String, String)> = params
            .into_iter()
            .map(|(k, v)| {
                (
                    k,
                    if let Value::String(s) = v {
                        s
                    } else {
                        v.to_string()
                    },
                )
            })
            .collect();
        fields.extend([
            ("token".to_string(), token),
            ("bot".to_string(), "1".to_string()),
        ]);
        let fields: Vec<(&str, &str)> = fields
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let answer = self.api(&fields).await?;
        api_error(&answer).map_or(Ok(()), Err)?;
        tokio::time::sleep(EDIT_DELAY).await;
        Ok(())
    }

    /// Downloads the file from the request's URL and uploads it. Also returns
    /// the API's last answer, which callers read (`res.upload.warnings`).
    pub async fn upload(&self, request: &Request) -> (Result<(), String>, Option<Value>) {
        match self.try_upload(request).await {
            Ok(answer) => (Ok(()), answer),
            Err((error, answer)) => (Err(error), answer),
        }
    }

    async fn try_upload(
        &self,
        request: &Request,
    ) -> Result<Option<Value>, (String, Option<Value>)> {
        self.check().await.map_err(|e| (e, None))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| (NOT_AUTHORIZED.to_string(), None))?;
        let url = request.url.trim();
        if url.is_empty() {
            return Err(("No URL given".to_string(), None));
        }
        let name = match request.newfile.trim() {
            "" => FileName::from_url(url),
            name => FileName::new(name),
        }
        .map_err(|e| (format!("Invalid file name: {e}"), None))?;

        let (file, _size) = crate::download::download(
            &self.state.download,
            url,
            self.state.config.max_upload_bytes,
        )
        .await
        .map_err(|e| {
            (
                format!("Could not download the source URL: {e:#} ({url})"),
                None,
            )
        })?;

        let upload_request = UploadRequest::new(name)
            .text(request.desc.trim())
            .comment(request.comment.trim())
            .ignore_warnings(request.ignore_warnings())
            .blocking_warnings(request.blocking_warnings())
            .chunk_size(self.state.config.chunk_size);
        let uploader = Uploader::new(
            &self.api_url,
            crate::state::USER_AGENT,
            Credentials::oauth1(
                self.oauth.consumer().key(),
                self.oauth.consumer().secret(),
                token.key.clone(),
                token.secret.clone(),
            ),
        )
        .map_err(|e| (format!("Cannot set up the upload: {e}"), None))?;

        match uploader.upload_file(file.path(), upload_request).await {
            Ok(success) => {
                tokio::time::sleep(EDIT_DELAY).await;
                let answer = json!({"upload": {
                    "result": "Success",
                    "filename": success.filename,
                    "warnings": success.warnings,
                }});
                Ok(Some(answer))
            }
            Err(UploadError::Upload(failure)) => {
                let answer = json!({"upload": {
                    "result": failure.result,
                    "warnings": failure.warnings,
                    "filekey": failure.file_key,
                }});
                Err((failure.to_string(), Some(answer)))
            }
            Err(error) => Err((format!("{error}"), None)),
        }
    }
}

fn api_error(answer: &Value) -> Option<String> {
    let error = &answer["error"];
    if error.is_null() {
        return None;
    }
    let info = error["info"]
        .as_str()
        .or_else(|| error["code"].as_str())
        .or_else(|| error.as_str());
    Some(info.unwrap_or("unknown API error").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_errors_become_messages() {
        assert_eq!(api_error(&json!({})), None);
        assert_eq!(
            api_error(&json!({"error": {"code": "badtoken"}})).as_deref(),
            Some("badtoken")
        );
        assert_eq!(
            api_error(&json!({"error": {"code": "x", "info": "Bad token"}})).as_deref(),
            Some("Bad token")
        );
        assert_eq!(
            api_error(&json!({"error": "plain"})).as_deref(),
            Some("plain")
        );
    }
}
