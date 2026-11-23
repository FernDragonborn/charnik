//! The window a table's question is asked in — open a table, join one, let a player in, return to
//! one (`docs/internals/table-link.md` ▸ Going online is a question the page cannot answer).
//!
//! Rust opens it, words it from the catalog compiled into the binary, and believes an answer only
//! from it: the command that answers checks the label of the webview that called it, which Tauri
//! sets and the caller cannot, and only this window's capability allows that command at all. The
//! app's page has no permission to close, hide, move or open a window, so it cannot press, cover
//! or forge this one; and the window loads one static page that renders the words as text.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;

/// The question window's label: what the answer command checks, and what its capability names.
pub const LABEL: &str = "table-question";
const PAGE: &str = "table-question.html";
const WIDTH: f64 = 480.0;
/// The height it opens at, before its page has measured its words.
const HEIGHT: f64 = 300.0;
/// The heights its page may ask for: enough for a title and two buttons, and no taller than a
/// small laptop's screen.
const HEIGHT_MIN: f64 = 200.0;
const HEIGHT_MAX: f64 = 640.0;

/// What the window shows: every word composed in Rust. The question is said small (`ask`), the
/// thing the person has to recognise large (`fact`), a code to compare larger still, then what
/// follows from the answer (`body`).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Words {
    /// The window's own title, for the taskbar and the title bar.
    pub title: String,
    pub ask: String,
    pub fact: String,
    /// A code to compare with what is said aloud, and the words over it — only where one is asked.
    pub code: Option<Code>,
    pub body: String,
    pub allow: String,
    pub deny: String,
    pub locale: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Code {
    pub label: String,
    pub value: String,
}

struct Pending {
    words: Words,
    answer: oneshot::Sender<bool>,
}

/// The question on screen, if any. One at a time: `ASKING` holds the rest back.
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static ASKING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn pending() -> std::sync::MutexGuard<'static, Option<Pending>> {
    PENDING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Answer the question on screen, once. Anything after the first answer is nobody's.
fn settle(allow: bool) {
    if let Some(asked) = pending().take() {
        let _ = asked.answer.send(allow);
    }
}

/// Is this the question window speaking? Tauri sets a webview's label; a caller cannot.
fn is_question(label: &str) -> bool {
    label == LABEL
}

/// Ask, and wait for the person's answer. A window that could not be opened, or was closed
/// without an answer, is a no.
pub async fn ask(app: &tauri::AppHandle, words: Words) -> bool {
    let _one_at_a_time = ASKING.lock().await;
    let (answer, answered) = oneshot::channel();
    *pending() = Some(Pending { words, answer });
    let window = match open(app) {
        Ok(window) => window,
        Err(e) => {
            log::warn!("table link: the question window did not open: {e}");
            pending().take();
            return false;
        }
    };
    let allow = answered.await.unwrap_or(false);
    // best-effort: a window already gone has nothing left to close
    let _ = window.destroy();
    allow
}

fn open(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let title = pending()
        .as_ref()
        .map(|asked| asked.words.title.clone())
        .unwrap_or_default();
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(PAGE.into()))
        .title(title)
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .focused(true)
        .center()
        // the one page it shows, and no other: no link, no form, no script takes it elsewhere
        .on_navigation(|url| url.path().trim_start_matches('/') == PAGE)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    if let Some(main) = app.get_webview_window(super::MAIN_WINDOW) {
        builder = builder.parent(&main)?;
    }
    let window = builder.build()?;
    window.on_window_event(|event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            settle(false);
        }
    });
    Ok(window)
}

/// The words of the question on screen, for the question window and nobody else.
#[tauri::command]
pub fn table_question_words(webview: tauri::Webview) -> Option<Words> {
    if !is_question(webview.label()) {
        return None;
    }
    pending().as_ref().map(|asked| asked.words.clone())
}

/// Size the question window to its words: the page measures them, in whichever locale they are.
/// Only the question window may, and only within bounds.
#[tauri::command]
pub fn table_question_fit(webview: tauri::Webview, height: f64) {
    if !is_question(webview.label()) || !height.is_finite() {
        return;
    }
    let size = tauri::LogicalSize::new(WIDTH, height.clamp(HEIGHT_MIN, HEIGHT_MAX));
    // best-effort: a window that keeps its first size still shows every word, with a scrollbar
    let _ = webview.window().set_size(size);
}

/// The person's answer, believed only from the question window.
#[tauri::command]
pub fn table_question_answer(webview: tauri::Webview, allow: bool) {
    if is_question(webview.label()) {
        settle(allow);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words() -> Words {
        Words {
            title: "t".into(),
            ask: "a".into(),
            fact: "f".into(),
            code: None,
            body: "b".into(),
            allow: "a".into(),
            deny: "d".into(),
            locale: "en".into(),
        }
    }

    #[tokio::test]
    async fn an_answer_is_believed_once_and_only_from_the_question_window() {
        let _one = ASKING.lock().await;
        let (answer, answered) = oneshot::channel();
        *pending() = Some(Pending {
            words: words(),
            answer,
        });
        // the app's own page is not the question window
        assert!(!is_question("main"));
        assert!(is_question(LABEL));
        settle(true);
        settle(false);
        assert_eq!(answered.await, Ok(true));
        assert!(pending().is_none());
    }

    #[tokio::test]
    async fn a_question_closed_without_an_answer_is_a_no() {
        let _one = ASKING.lock().await;
        let (answer, answered) = oneshot::channel();
        *pending() = Some(Pending {
            words: words(),
            answer,
        });
        // what closing the window does
        settle(false);
        assert_eq!(answered.await, Ok(false));
    }
}
