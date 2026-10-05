//! The one HTTPS client the page can reach, and all it can do with it: `GET` a content pack from
//! the hosts Charnik fetches packs from.
//!
//! The http plugin's own `fetch` command is not exposed. Its scope is a URL pattern and nothing
//! else — the method is the caller's, and so is every header the fetch spec does not forbid — so a
//! capability that allowed a `GET` of `api.github.com/repos/*` allowed a `POST` there with
//! somebody's token just the same: a write channel out of the app that the CSP never sees, because
//! the client is here and not in the webview. These two commands send `GET`, with the one header a
//! pack check needs, and say no to everything else before a socket is opened.

use std::time::Duration;
use tauri_plugin_http::reqwest::{self, header, redirect::Policy, Url};

/// One response is refused past this (`MAX_REMOTE_BYTES` in `content/remote/types.ts`): a content
/// file is hundreds of kilobytes, and an unbounded read of a remote body is a memory blow-up.
const MAX_BYTES: usize = 8 * 1024 * 1024;
/// Reaching the host, and the whole exchange. The second matters as much: a server that accepts
/// the connection and then says nothing would otherwise never settle, and every pack operation
/// waits in one queue behind it.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_REDIRECTS: usize = 5;

/// May this URL be fetched? `https` only, and only where a pack can live: a repository's API under
/// `api.github.com/repos/`, or a file on `raw.githubusercontent.com`. Compiled in, like the
/// capability it stands in for — no config, pasted URL or bug in the page widens it.
fn is_pack_host(url: &Url) -> bool {
    url.scheme() == "https"
        && match url.host_str() {
            Some("api.github.com") => url.path().starts_with("/repos/"),
            Some("raw.githubusercontent.com") => true,
            _ => false,
        }
}

/// `GET url`, following a redirect only to another address this module would fetch itself.
async fn get(url: &str, etag: Option<&str>) -> Result<reqwest::Response, String> {
    let url = Url::parse(url).map_err(|e| e.to_string())?;
    if !is_pack_host(&url) {
        return Err("not an address Charnik fetches packs from".into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() > MAX_REDIRECTS || !is_pack_host(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(url).header(
        header::USER_AGENT,
        concat!("charnik/", env!("CARGO_PKG_VERSION")),
    );
    if let Some(etag) = etag {
        // a conditional request: a 304 costs no rate-limit quota
        request = request.header(header::IF_NONE_MATCH, etag);
    }
    request.send().await.map_err(|e| e.to_string())
}

/// Read a body with a hard ceiling. `Content-Length` is a courtesy — it can be absent or a lie —
/// so the bytes are counted as they arrive and the transfer is dropped when the ceiling is crossed.
async fn read_capped(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return Err("response too large".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > MAX_BYTES {
            return Err("response too large".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// What a text fetch answers: the status, the `ETag` to replay, and the body when there is one to
/// read (a 304 and an error status carry none).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextReply {
    status: u16,
    etag: Option<String>,
    body: Option<String>,
}

/// Conditional `GET` of a text resource — a repository's tree listing.
#[tauri::command]
pub async fn fetch_pack_text(url: String, etag: Option<String>) -> Result<TextReply, String> {
    let response = get(&url, etag.as_deref()).await?;
    let status = response.status();
    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = if status.is_success() {
        Some(String::from_utf8(read_capped(response).await?).map_err(|e| e.to_string())?)
    } else {
        None
    };
    Ok(TextReply {
        status: status.as_u16(),
        etag,
        body,
    })
}

/// `GET` one file's exact bytes, handed over raw: a content file is stored byte for byte, and eight
/// megabytes as a JSON array of numbers is a different transfer altogether.
#[tauri::command]
pub async fn fetch_pack_bytes(url: String) -> Result<tauri::ipc::Response, String> {
    let response = get(&url, None).await?;
    let status = response.status();
    if !status.is_success() {
        return Err(status.to_string());
    }
    Ok(tauri::ipc::Response::new(read_capped(response).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(url: &str) -> bool {
        is_pack_host(&Url::parse(url).unwrap())
    }

    /// A response as the client would hand it over, with no network behind it.
    fn response(body: Vec<u8>) -> reqwest::Response {
        reqwest::Response::from(http::Response::new(body))
    }

    #[tokio::test]
    async fn a_body_is_read_through_up_to_the_ceiling_and_refused_past_it() {
        assert_eq!(read_capped(response(vec![7; 16])).await, Ok(vec![7; 16]));
        assert_eq!(
            read_capped(response(vec![0; MAX_BYTES]))
                .await
                .map(|b| b.len()),
            Ok(MAX_BYTES)
        );
        assert_eq!(
            read_capped(response(vec![0; MAX_BYTES + 1])).await,
            Err("response too large".into())
        );
    }

    #[test]
    fn a_pack_lives_on_two_hosts_and_nowhere_else() {
        assert!(allowed(
            "https://api.github.com/repos/owner/repo/git/trees/main?recursive=1"
        ));
        assert!(allowed(
            "https://raw.githubusercontent.com/owner/repo/main/pack/items.csv"
        ));
        // the API outside a repository: gists, the user, a search
        assert!(!allowed("https://api.github.com/gists"));
        assert!(!allowed("https://api.github.com/user"));
        // plain http, a look-alike host, a host that merely ends the same way
        assert!(!allowed("http://api.github.com/repos/owner/repo"));
        assert!(!allowed(
            "https://api.github.com.evil.example/repos/owner/repo"
        ));
        assert!(!allowed("https://evil.example/raw.githubusercontent.com/x"));
        // credentials in the address do not change which host it is
        assert!(!allowed(
            "https://api.github.com@evil.example/repos/owner/repo"
        ));
    }
}
