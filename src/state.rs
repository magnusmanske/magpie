//! What every request handler can use. Shared via `Arc`.

use crate::config::Config;
use anyhow::{Context, Result};
use axum::http::HeaderMap;
use axum_extra::extract::PrivateCookieJar;
use axum_extra::extract::cookie::Key;
use mediawiki_upload::wikimedia::CommonsClient;
use std::path::Path;
use wikimisc::oauth1::{Consumer, OAuth};
use wikimisc::replicas::Replicas;

/// Sent with every outbound request, per the Wikimedia User-Agent policy.
pub const USER_AGENT: &str = wikimisc::user_agent!(
    name = "magpie",
    description = "https://magpie.toolforge.org/"
);

pub struct AppState {
    pub config: Config,
    /// For Wikimedia API reads.
    pub http: reqwest::Client,
    /// For fetching the source file: no redirects, so an authenticated upload
    /// cannot be turned into something else.
    pub download: reqwest::Client,
    /// Commons pre-upload checks and site info.
    pub commons: CommonsClient,
    /// Geograph's pages, with the user agent its Cloudflare expects.
    pub geograph: reqwest::Client,
    /// The wiki replicas, when `replica.my.cnf` is present.
    pub replicas: Option<Replicas>,
    pub cookie_key: Key,
    pub oauth: Option<OAuth>,
    /// The CommonsHelper dictionaries, parsed once at start-up.
    pub helper: crate::commonshelper::Catalog,
}

impl AppState {
    pub fn new(config: Config) -> Result<Self> {
        let http = wikimisc::http::client(USER_AGENT)?;
        // Source URLs come from users, so this client refuses private and
        // loopback destinations, including on redirects.
        let download = crate::download::client(USER_AGENT)?;
        let geograph = crate::geograph::client()?;
        let cookie_key = match &config.cookie_key {
            Some(hex) => {
                Key::try_from(decode_hex(hex)?.as_slice()).context("cookie_key must be 64 bytes")?
            }
            None => {
                tracing::warn!("no cookie_key configured: logins last until the next restart");
                Key::generate()
            }
        };
        let replicas = match Replicas::new(&config.replica_credentials) {
            Ok(replicas) => Some(replicas),
            Err(e) => {
                tracing::warn!("wiki replicas unavailable: {e:#}");
                None
            }
        };
        Ok(Self {
            commons: CommonsClient::with_client(http.clone())?,
            helper: crate::commonshelper::Catalog::load()?,
            geograph,
            oauth: oauth(&config.oauth, &http),
            cookie_key,
            replicas,
            download,
            http,
            config,
        })
    }

    /// The request's encrypted cookies.
    pub fn cookies(&self, headers: &HeaderMap) -> PrivateCookieJar {
        PrivateCookieJar::from_headers(headers, self.cookie_key.clone())
    }
}

fn oauth(ini: &Path, http: &reqwest::Client) -> Option<OAuth> {
    match Consumer::from_ini(ini) {
        Ok(consumer) => Some(OAuth::new(consumer, http.clone())),
        Err(e) => {
            tracing::warn!("OAuth unavailable: {e:#}");
            None
        }
    }
}

fn decode_hex(hex: &str) -> Result<Vec<u8>> {
    let hex = hex.trim();
    (0..hex.len())
        .step_by(2)
        .map(|i| {
            hex.get(i..i + 2)
                .and_then(|b| u8::from_str_radix(b, 16).ok())
                .context("cookie_key is not hex")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_keys_are_decoded_strictly() {
        assert_eq!(decode_hex("00ff10").unwrap(), [0, 255, 16]);
        assert_eq!(decode_hex(" 00FF ").unwrap(), [0, 255]);
        assert!(decode_hex("").unwrap().is_empty());
        for bad in ["0", "0g", "not hex"] {
            assert!(decode_hex(bad).is_err(), "{bad}");
        }
    }
}
