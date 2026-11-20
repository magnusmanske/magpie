//! `magpie`: one Toolforge service for moving files to Wikimedia Commons.
//!
//! The four former PHP tools (Flickr2Commons, Url2Commons, Geograph2Commons,
//! CommonsHelper) are views in one Vue application; their upload APIs are
//! merged into `/api.php`, which keeps the request and response shape the old
//! front-ends used. See `AGENTS.md` and `README.md`.

#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
#![cfg_attr(
    not(test),
    warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

mod api;
mod commonshelper;
mod config;
mod download;
mod geograph;
mod state;
mod web;

use anyhow::Result;
use clap::Parser;
use config::Config;
use state::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// How often a stopped web server is restarted before the process gives up.
const MAX_SERVER_FAILURES: u8 = 5;

#[derive(Debug, Parser)]
#[command(version, about)]
struct Cli {
    /// Path to the JSON configuration file.
    #[arg(long, default_value = "config.json")]
    config: PathBuf,
    /// Port to listen on. Toolforge sets `PORT`.
    #[arg(long, env = "PORT", default_value_t = 8000)]
    port: u16,
}

#[tokio::main]
async fn main() -> Result<()> {
    wikimisc::logging::init();
    // `server::serve` drains requests on SIGTERM, then sends the final push.
    wikimisc::telemetry::install_web(env!("CARGO_PKG_VERSION"), None);
    let cli = Cli::parse();
    let config = Config::load(&cli.config)?;
    let state = Arc::new(AppState::new(config)?);
    let router = web::router(state);
    let mut failures = 0u8;
    loop {
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", cli.port)).await {
            Ok(listener) => listener,
            Err(error) => {
                tracing::error!("cannot listen on port {}: {error}", cli.port);
                return Err(error.into());
            }
        };
        match listener.local_addr() {
            Ok(address) => tracing::info!("listening on http://{address}"),
            Err(error) => tracing::warn!("cannot report the listen address: {error}"),
        }
        match wikimisc::server::serve(listener, router.clone()).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                failures += 1;
                wikimisc::telemetry::event(wikimisc::telemetry::Level::Error, "web server stopped");
                tracing::error!("web server stopped ({failures}): {error:#}");
                if failures >= MAX_SERVER_FAILURES {
                    wikimisc::telemetry::shutdown(wikimisc::telemetry::ExitReason::Other(
                        "web server stopped too often".to_string(),
                    ))
                    .await;
                    return Err(error.into());
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}
