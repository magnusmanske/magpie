//! Typed configuration, loaded from a JSON file that is never committed.
//! See `config.json.template` for the shape.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// The largest file the upload API downloads, in bytes.
///
/// Wikimedia Commons currently accepts 5 GiB; a transfer stops at the same
/// limit. Files above the chunk threshold are uploaded in chunks.
const DEFAULT_MAX_UPLOAD_BYTES: u64 = 5 * 1024 * 1024 * 1024;
/// Chunk size for large uploads; MediaWiki requires at least 1 KiB.
const DEFAULT_CHUNK_SIZE: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Where this service is reachable, for OAuth callbacks. Must match the
    /// consumer's registered callback prefix exactly.
    #[serde(default = "default_public_url")]
    pub public_url: String,
    /// Encrypts the login cookies: 64 bytes, hex. Without one, a random key
    /// is used, so logins last only until a restart, and only on one replica.
    #[serde(default)]
    pub cookie_key: Option<String>,
    /// OAuth consumer (`consumerKey`, `consumerSecret`, `agent`); without the
    /// file, uploading is unavailable.
    #[serde(default = "default_oauth")]
    pub oauth: PathBuf,
    /// Database credentials (`replica.my.cnf`, as Toolforge provides it).
    /// Without them, the Flickr duplicate checks fall back to the API.
    #[serde(default = "default_replica_credentials")]
    pub replica_credentials: PathBuf,
    /// The Flickr API key, alone in a file. `$FLICKR_ACCESS_KEY` is the
    /// fallback. Without either, `flickr2commons` cannot load photo data.
    #[serde(default)]
    pub flickr_key_file: Option<PathBuf>,
    /// The largest file the upload API downloads.
    #[serde(default = "default_max_upload_bytes")]
    pub max_upload_bytes: u64,
    /// Chunk size, and the threshold above which uploads are chunked.
    #[serde(default = "default_chunk_size")]
    pub chunk_size: u64,
}

fn default_public_url() -> String {
    "https://magpie.toolforge.org".to_string()
}

fn default_oauth() -> PathBuf {
    "oauth.ini".into()
}

fn default_replica_credentials() -> PathBuf {
    "replica.my.cnf".into()
}

fn default_max_upload_bytes() -> u64 {
    DEFAULT_MAX_UPLOAD_BYTES
}

fn default_chunk_size() -> u64 {
    DEFAULT_CHUNK_SIZE
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("cannot read config file {}", path.display()))?;
        let mut config: Self = serde_json::from_str(&text)
            .with_context(|| format!("invalid config file {}", path.display()))?;
        // Relative paths are relative to the config file, not the working directory.
        let dir = path.parent().unwrap_or(Path::new("."));
        config.oauth = dir.join(&config.oauth);
        config.replica_credentials = dir.join(&config.replica_credentials);
        config.flickr_key_file = config.flickr_key_file.map(|f| dir.join(f));
        config.public_url = config.public_url.trim_end_matches('/').to_string();
        Ok(config)
    }

    /// The OAuth callback address, which the consumer must be registered with.
    pub fn oauth_callback(&self) -> String {
        format!("{}/api.php", self.public_url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(json: &str) -> (Result<Config>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, json).unwrap();
        (Config::load(&path), dir)
    }

    #[test]
    fn defaults_are_usable() {
        let (config, dir) = load("{}");
        let config = config.unwrap();
        assert_eq!(config.public_url, "https://magpie.toolforge.org");
        assert_eq!(
            config.oauth_callback(),
            "https://magpie.toolforge.org/api.php"
        );
        assert_eq!(config.max_upload_bytes, DEFAULT_MAX_UPLOAD_BYTES);
        assert_eq!(config.chunk_size, DEFAULT_CHUNK_SIZE);
        assert_eq!(
            config.replica_credentials,
            dir.path().join("replica.my.cnf")
        );
    }

    #[test]
    fn relative_paths_follow_the_config_file() {
        let (config, dir) = load(r#"{"oauth": "keys/oauth.ini", "replica_credentials": "db.cnf"}"#);
        let config = config.unwrap();
        assert_eq!(config.oauth, dir.path().join("keys/oauth.ini"));
        assert_eq!(config.replica_credentials, dir.path().join("db.cnf"));
    }

    #[test]
    fn absolute_paths_stay() {
        let (config, _dir) = load(r#"{"oauth": "/data/project/magpie/oauth.ini"}"#);
        assert_eq!(
            config.unwrap().oauth,
            Path::new("/data/project/magpie/oauth.ini")
        );
    }

    #[test]
    fn public_url_trailing_slash_is_trimmed() {
        let (config, _dir) = load(r#"{"public_url": "https://example.org/"}"#);
        assert_eq!(config.unwrap().public_url, "https://example.org");
    }

    #[test]
    fn typos_are_errors() {
        assert!(load(r#"{"cookey_key": "x"}"#).0.is_err());
    }
}
