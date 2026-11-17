//! Writing a file so that a crash or a power loss leaves the old version or the new one, whole.
//!
//! A rename alone is atomic for the NAME, not for the bytes: the OS may put the rename on disk
//! before the data it points at, and a power cut in between leaves a zero-length file under the
//! real name. So the temporary sibling is flushed to the disk (`sync_all`) before it is renamed.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The one temporary sibling a file is written through. One name per file, so a crash leaves at
/// most one behind, and the next write of that file reuses and consumes it.
fn sibling(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

/// Write `bytes` to `path`: to a flushed sibling first, then over the old file by rename.
pub fn write_durable(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let fresh = sibling(path);
    let written = File::create(&fresh)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&fresh, path));
    if written.is_err() {
        // best-effort: the write's own error is the one worth reporting
        let _ = fs::remove_file(&fresh);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_the_file_whole_and_leaves_no_sibling() {
        let dir = std::env::temp_dir().join(format!("charnik-durable-{}", std::process::id()));
        let path = dir.join("character.json");
        write_durable(&path, b"first").unwrap();
        write_durable(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert!(!sibling(&path).exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
