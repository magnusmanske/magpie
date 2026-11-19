//! Fetching the source file for an upload.
//!
//! The URL comes from the caller, so the request goes through the SSRF guard
//! in [`wikimisc::http::ssrf`], is size-limited, and is written to a temporary
//! file rather than held in memory. Downloads and uploads are separate steps:
//! [`mediawiki_upload`] only needs a path.

use anyhow::{Context, Result, anyhow, bail};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// A large download may take minutes; the caller bounds it further.
const TIMEOUT: Duration = Duration::from_secs(300);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// A client for fetching user-supplied URLs.
pub fn client(user_agent: &str) -> Result<reqwest::Client> {
    wikimisc::http::ssrf::client_builder_for(wikimisc::http::ssrf::Target::Untrusted, user_agent)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TIMEOUT)
        .build()
        .context("cannot build the download client")
}

/// Downloads `url` into a temporary file of at most `max_bytes`.
///
/// Returns the file and its size. The temporary file is deleted when dropped.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    max_bytes: u64,
) -> Result<(tempfile::NamedTempFile, u64)> {
    let parsed = wikimisc::http::ssrf::guard_url(url).map_err(|e| anyhow!("{e}"))?;
    let mut response = client
        .get(parsed)
        .send()
        .await
        .context("could not download the source URL")?
        .error_for_status()
        .context("the source URL did not answer successfully")?;
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        bail!("the file is larger than {} MB", max_bytes >> 20);
    }
    let file = tempfile::NamedTempFile::new().context("no temporary file")?;
    let mut writer = tokio::fs::File::from_std(file.reopen()?);
    let mut size = 0u64;
    while let Some(chunk) = response.chunk().await.context("the download broke off")? {
        size += chunk.len() as u64;
        if size > max_bytes {
            bail!("the file is larger than {} MB", max_bytes >> 20);
        }
        writer.write_all(&chunk).await?;
    }
    writer.flush().await?;
    if size == 0 {
        bail!("the source URL returned an empty file");
    }
    Ok((file, size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn refuses_internal_urls() {
        let client = client("magpie-test/1.0").unwrap();
        for url in [
            "http://127.0.0.1/x",
            "http://[::1]/x",
            "ftp://example.org/x",
            "http://169.254.169.254/latest",
            "not a url",
        ] {
            assert!(download(&client, url, 1000).await.is_err(), "{url}");
        }
    }
}
