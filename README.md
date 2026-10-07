# Course File Saver

An extension for desktop Chrome, Microsoft Edge, Firefox, and Zen that saves original documents referenced by Blackboard previews and AWS Academy Student Guides you can already open. No Python, copied viewer URLs, or external service required.

[Download the latest release](https://github.com/yassine-abid/course-file-saver/releases/latest).

## Install in Chrome or Edge

1. Download this repository as a ZIP and extract it.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Pin **Course File Saver** from your browser's Extensions menu.

Keep the extracted folder in a permanent location. This is an unpacked extension, not a Chrome Web Store listing.

## Install in Zen or Firefox

1. Download the latest release ZIP and extract it.
2. Open `about:debugging` in Zen or Firefox.
3. Choose **This Zen** or **This Firefox**, then **Load Temporary Add-on**.
4. Select `manifest.json` in the extracted extension folder.

The unsigned add-on remains installed until the browser restarts. Reload it using the same steps after a restart. Permanent installation requires a Mozilla-signed package; this release is not signed. [Mozilla's temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) explains the process.

Firefox requires version 128 or newer. Zen installation and document downloading were confirmed working by the user. Firefox uses the same supported API path but has not been separately tested in a Firefox installation. Chrome/Edge still need an installed-browser smoke test.

## Use

1. Sign in to Blackboard or AWS Academy in a supported browser.
2. Expand a course attachment’s preview and wait for its pages to load.
3. Click the extension icon, then **Download file** beside the document.
4. For AWS, reload the Student Guide once after installing or updating the extension. Wait for **Original PDF captured — ready to save**, then click Download file. The extension copies the captured original bytes in the background without opening another tab. Keep the guide open while it copies.
5. AWS guides save directly to your browser’s Downloads folder without an extra tab or Save As dialog. The popup confirms completion. Blackboard attachments use the normal Save As dialog.

Choose **Refresh** after opening another preview. If a link expires, reopen the preview and refresh.

### AWS Academy Student Guides

Open the Student Guide inside the module and wait until its pages appear, then open the extension popup. AWS Academy's SCORM viewer can load the PDF through a request without exposing a download link. The extension checks the already-loaded PDF resource URLs in the permitted viewer frames and lists the original file when one is available. It does not reconstruct the file from screenshots or invent file URLs.

If the popup reports unreadable frames or missing viewer permissions, choose **Enable AWS guide access** and approve access to the three listed course/viewer sites. Reopen the popup and choose **Refresh**; if needed, reload the course page once. Being able to see the guide yourself does not mean the browser has granted the extension access to the guide's separate embedded origin.

AWS detection, original PDF capture, and saving have been verified in Zen with the 59-page Module 3 guide. The extension copies the response that the guide’s own renderer receives while loading, without changing its requests or authentication. It copies page-owned buffers into extension-owned memory for Firefox compatibility and assembles complete HTTP range responses when needed. Reload the guide once after installation or an update so capture is active before its PDF request starts.

The default popup shortcut is **Alt+Shift+D** (**Option+Shift+D** on macOS). A conflicting browser or extension shortcut can prevent it from activating; the toolbar icon remains available.

## Supported files

- PDFs in Blackboard’s Document Rendering viewer.
- Original Office documents when the viewer exposes their original file.
- Direct hosted Blackboard document links.
- Original PDFs already loaded by AWS Academy's supported Student Guide viewer.

Supports hosted Blackboard HTTPS sites, `awsacademy.instructure.com`, and the `emergingtalent.contentcontroller.com` / `awsacademy.contentcontroller.com` guide viewers. It scans the current tab's loaded previews; it does not crawl courses or expand attachments. Downloading entire SCORM packages, image-only viewers, videos, custom institutional domains, mobile browsers, Safari, and Codex's in-app browser are outside this version's scope.

## Privacy and permissions

The extension has no analytics, remote code, login form, or persistent file-link storage. A local background script handles the selected AWS download so the popup can close without opening another page. On permitted AWS course/viewer pages, local capture scripts observe PDF responses from the page's existing fetch/XHR requests. They forward requests unchanged and copy PDF bytes, MIME information, and byte-range metadata; they do not read authentication headers, passwords, or cookies. Only complete, validated PDF data is cached, with at most three completed files per viewer frame, in memory until the frame closes or navigates. Scanning the cache and document references happens when you open the popup.

After you choose an AWS file, the background script copies the selected PDF’s captured bytes from its viewer. Zen/Firefox uses a blob URL owned by the background page; Chrome/Edge’s service worker uses a PDF data URL. The extension waits for the browser to confirm completion before releasing a blob URL. Temporary transfer buffers are cleaned after copying or expire after ten minutes. Links and PDF bytes are not stored in extension disk storage or uploaded anywhere. Your browser handles saving the file and its normal download history may retain the download address.

| Permission | Purpose |
|---|---|
| `activeTab` | Identify the tab where the extension was opened. |
| `scripting` | Read file references in the loaded frames. |
| `webNavigation` | Discover the current tab’s preview frames. |
| `downloads` | Save the selected file to your browser’s download manager. |
| Blackboard and AWS Academy site access | Inspect course pages and their supported guide/preview frames. |

It uses existing account access and does not change course settings or retrieve unavailable documents.

## Project structure

```text
course-file-saver/
├── manifest.json       Browser entry point; must remain at the root
├── README.md
├── icons/              Toolbar icons
├── popup/              Popup HTML, styles, and UI logic
├── scripts/            Scanning, PDF capture, transfer, and background code
└── tools/              Background build script
```

The release ZIP uses this same structure. Tests and development experiments are excluded from the public repository and install package.

## Development

There are no runtime dependencies. The shipped scripts/background.js bundle registers its browser listeners synchronously. After editing its source modules, rebuild it before reloading the extension:

```sh
node tools/build-background.mjs
```

The release passed 56 automated checks covering URL decoding, document detection, permissions, frame failures, unchanged request forwarding, PDF response capture, out-of-order byte-range assembly, binary integrity, rejection of login/partial responses, and direct background downloading without helper tabs. Live Blackboard extraction and saving were verified. AWS capture and saving were verified in Zen with the complete 59-page Module 3 guide. Direct background downloading without a helper tab or Save As dialog was verified in Zen with the complete 19-page Module 1 guide and 47-page Module 2 guide. The Module 2 download also completed after closing the popup. Chrome/Edge still need an installed-browser smoke test. This version requires Chrome/Edge 121+ or Firefox/Zen based on Firefox 128+.

Browser APIs: [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting), [frame discovery](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), and [downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads).
