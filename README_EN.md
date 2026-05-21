# wiki2md-extension

[中文](README.md) | [English](README_EN.md)

A browser extension for parsing and saving wiki documents from Zread, DeepWiki, and Google Code Wiki as Markdown files.

## ✨ Highlights

- Export the current page as `.md`
- Batch export detected chapters as `.zip`
- Preserve source metadata in YAML frontmatter
- Convert common rich content
- Support Zread, DeepWiki, and Google Code Wiki

## 🚀 Quick Start

### 🛠️ Installation

1. Open the browser extensions page.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select the `wiki2md-extension` folder.

### 🎯 Usage

1. Open a page on Zread, DeepWiki, or Google Code Wiki.
2. Click the extension icon to open the popup.
3. Choose one action:
   - `转换当前页面`: export the current page as Markdown
   - `批量导出所有章节`: export detected chapters as a ZIP archive
4. Choose a save location when the browser download dialog appears.

## 🌐 Supported Sites

- Zread
- DeepWiki
- Google Code Wiki

## 🖼️ Screenshots

### 🧩 Popup UI

<p align="center">
  <img src="images/popup-ui.png" alt="Single Page Export" width="300">
</p>

### 📝 Single Page Export

<p align="center">
  <img src="images/single-page-export.png" alt="Single Page Export" width="300">
</p>

### 📦 Batch Export Workflow

<p align="center">
  <img src="images/batch-export-workflow.png" alt="Single Page Export" width="300">
</p>

## 📌 Features

- Export the current page as `.md`
- Batch export detected chapters as `.zip`
- Show progress and support cancellation
- Preserve `title`, `source`, `owner`, `repo`, and `url`
- Convert headings, lists, links, images, tables, code blocks, and blockquotes
- Handle Code Wiki snippets, diagrams, and tables

## 📄 Output

Single-page export generates one Markdown file.

Batch export generates a ZIP archive containing:

- one Markdown file per page
- a generated `README.md` index file

Generated Markdown includes frontmatter like:

```yaml
---
title: "Page Title"
source: zread.ai
owner: example-owner
repo: example-repo
url: https://example.com/page
---
```

## 🔐 Permissions

The extension uses these permissions:

- `activeTab`
- `downloads`
- `storage`
- `tabs`
- `webNavigation`

Host access is limited to:

- `zread.ai`
- `deepwiki.com`
- `codewiki.google`

## ⚠️ Limitations

- Only supported sites are handled
- Parsing depends on site DOM structure and may break after site updates
- Batch export depends on detectable chapter links

## 🙏 Acknowledgements

- Thanks to Zread, DeepWiki, and Google Code Wiki as supported documentation sources.
- Inspiration: [deepwiki-md-chrome-extension](https://github.com/zxmfke/deepwiki-md-chrome-extension)
