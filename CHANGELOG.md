# Changelog

## 0.2.2

- **Automatic updates (desktop).** Charnik now checks for a new version on launch. When one is
  available, a gold **Update** button appears in the top bar; click it to download and install the
  new version and restart — no need to visit the releases page or reinstall by hand. Updates are
  cryptographically signed, so only genuine Charnik releases can be installed. The check is quiet and
  never blocks you: if you're offline or no update exists, nothing changes.
- **One-time cleanup for older installs.** Because the app's internal identifier changed, a build
  installed before this identifier switch won't be replaced in place — uninstall the old Charnik once
  by hand, then install this version. From here on, updates apply over the top automatically.

## 0.2.1

- **Editor mode.** From **Edit compendium → Editor**, edit every field of a selected entry in a
  two-panel view: the current article on the left, your changes on the right. Editing an entry that
  ships with the app saves a homebrew copy (the original is untouched and your version sorts above it);
  your own entries edit in place.
- **Drafts.** Unfinished translations and new/edited entries now auto-save and can be picked up later
  from **Edit compendium → Drafts**. If a saved draft points at an entry that no longer exists, a
  dialog helps you reassign it to another entry, keep it as new, or delete it. Drafts from an older
  version are flagged before they're discarded.
- **Delete or shelve your homebrew.** A homebrew entry's page has, at the bottom, **Delete entry**
  (with a confirmation) and **Move to drafts** (park a not-yet-ready entry back as a draft).
- **Content management in Settings.** A new Settings page with three tabs: **Content health**
  (problems found while loading your content), **Sources** (turn whole sources or individual files on
  and off — nothing is deleted), and **Collisions** (when the same entry exists in more than one
  source, keep them all or pick one).
- **Compendium language, independent of the app.** A language selector in the compendium shows content
  in any language you've translated to, regardless of the interface language. Your choice is remembered.
- **Better translating.** Pick the "from" and "to" languages freely from searchable dropdowns above each
  panel — full language names, a broad list (incl. minority languages like Crimean Tatar), and an "add a
  language" option to start a new one. The view remembers your settings, with a "back to compendium" button.
- **Clearer authoring form.** Adding or editing an entry now mirrors how the article looks; each field
  has an **(i)** with the format + an example (for the parser-driven damage and effects fields too), the
  spell "available to" is a checklist of spellcaster classes plus a free-add, and a warning appears if a
  spell level above 9 is entered.
- Dropdowns close when you click outside them; various layout fixes.
- **Smoother updates (desktop).** The Windows installer now updates an existing install in place
  instead of asking you to uninstall first. This release also changes the app's internal identifier
  (to `io.github.ferndragonborn.charnik`); if you had an earlier build installed, uninstall it once —
  future versions will update over the top.

## 0.2.0

- **Translate mode.** From the compendium, open **Edit compendium → Translate** to translate any
  entry side by side: the English original on the left, your language on the right. Edit the name,
  description, and prose fields (like a spell's material component); the stats stay read-only. A list
  marker shows what's done, in progress, or untranslated. Switch your language in the top-right.
- **Content now shows in your language.** Names and descriptions display in the active language
  wherever a translation exists, falling back to English otherwise.
- **Choose where new homebrew goes.** The "new entry" form lets you pick a file and shows an id
  example; it warns if you'd write into a file that ships with the app.

## 0.1.1

- First-run prompt to choose where your data folder lives (default: Documents/charnik), with an
  "open folder" button.
- Views refresh live after content changes — no full restart.
- Fixed an empty compendium after install and a couple of packaging issues.
