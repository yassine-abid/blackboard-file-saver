# Blackboard File Saver

A Chrome / Microsoft Edge extension that saves original documents referenced by Blackboard previews you can already open. No Python, copied viewer URLs, or external service required.

## Install

1. Download this repository as a ZIP and extract it.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Pin **Blackboard File Saver** from your browser’s Extensions menu.

Keep the extracted folder in a permanent location. This is an unpacked extension, not a Chrome Web Store listing.

## Use

1. Sign in to Blackboard in Chrome or Edge.
2. Expand a course attachment’s preview and wait for its pages to load.
3. Click the extension icon, then **Download file** beside the document.
4. Choose a destination in the Save As dialog. Check your browser’s downloads for completion.

Choose **Refresh** after opening another preview. If a link expires, reopen the preview and refresh.

## Supported files

- PDFs in Blackboard’s Document Rendering viewer.
- Original Office documents when the viewer exposes their original file.
- Direct hosted Blackboard document links.

Works across courses on HTTPS sites ending in `blackboard.com`. It scans the current tab’s loaded previews; it does not crawl courses or expand attachments. Image-only viewers, videos, SCORM packages, custom non-Blackboard domains, Safari, and Codex’s in-app browser are outside this version’s scope.

## Privacy and permissions

The extension runs when you open its popup. It has no background script, analytics, remote code, login form, or persistent file-link storage. It does not read passwords or use the cookies API. Your browser handles the chosen download using its existing session; normal download history may retain its temporary file URL.

| Permission | Purpose |
|---|---|
| `activeTab` | Identify the tab where the extension was opened. |
| `scripting` | Read file references in the loaded frames. |
| `webNavigation` | Discover the current tab’s preview frames. |
| `downloads` | Start the selected download with Save As. |
| Blackboard HTTPS site access | Inspect Blackboard course and preview frames. |

It uses existing account access and does not change course settings or retrieve unavailable documents.

## Development

There are no runtime dependencies or build step. JavaScript source is used directly by the extension.

Run tests with Node.js 20 or newer:

```sh
node --test tests/*.test.mjs
```

The 15 tests cover URL decoding, filename handling, document detection, frame failures, and download options. Live PDF extraction was verified against an accessible Blackboard preview. Popup behavior was checked with simulated browser APIs; installation and native Save As behavior still need an installed Chrome/Edge smoke test.

Browser APIs: [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting), [frame discovery](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), and [downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads).
