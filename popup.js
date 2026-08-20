// popup.js - wiki2md-extension popup script

const i18n = {
  zh: {
    documentTitle: "wiki2md-extension",
    headerSubtitle: "Zread / DeepWiki / Code Wiki 导出工具",
    statusReady: "就绪，等待转换",
    convertSingleTitle: "转换当前页面",
    convertSingleDesc: "将本文档导出为 Markdown 文件",
    convertBatchTitle: "批量导出所有章节",
    convertBatchDesc: "提取全部页面并打包为 ZIP",
    cancelBatch: "取消批量导出",
    batchProcessing: "批量处理中...",
    batchPreparing: "准备中",
    footerText: "支持 Zread、DeepWiki、Code Wiki 与 ReadMex",
    msgNotSupported: "请在 Zread、DeepWiki、Code Wiki 或 ReadMex 页面使用此工具",
    msgConverting: "正在转换页面...",
    msgConvertSuccess: "转换成功！正在下载...",
    msgConvertFail: "转换失败：",
    msgUnknownError: "未知错误",
    msgOpFail: "操作失败：",
    msgFetchingList: "正在获取章节列表...",
    msgStartBatchFail: "无法启动批量转换",
    msgCanceling: "正在取消...",
    msgNoBatch: "没有正在运行的批量操作",
    msgCancelFail: "取消失败：",
    msgGetBatchStatusFail: "无法获取批量状态：",
    msgProcessing: "处理中",
    batchStarted: "已找到 {total} 个页面，开始批量转换...",
    batchProcessingItem: "正在处理 {current}/{total}: {title}",
    batchConvertedItem: "已转换 {processed}/{total}: {title}",
    batchFailedItem: "转换失败 {title}: {error}",
    batchCancelling: "正在取消... 已处理 {processed}/{total}。",
    batchCancelled: "批量已取消。成功 {processed}，失败 {failed}。",
    batchZipping: "正在创建 ZIP，包含 {processed} 个文件...",
    batchCompleted: "ZIP 已就绪。成功 {processed}，失败 {failed}。",
    batchError: "批量转换失败：{error}",
    langSwitcherLabel: "语言切换",
    githubAriaLabel: "GitHub 仓库"
  },
  en: {
    documentTitle: "wiki2md-extension",
    headerSubtitle: "Zread / DeepWiki / Code Wiki / ReadMex Exporter",
    statusReady: "Ready to convert",
    convertSingleTitle: "Convert Current Page",
    convertSingleDesc: "Export this document to Markdown",
    convertBatchTitle: "Batch Export All Chapters",
    convertBatchDesc: "Extract all pages and pack into ZIP",
    cancelBatch: "Cancel Batch Export",
    batchProcessing: "Batch processing...",
    batchPreparing: "Preparing",
    footerText: "Supports Zread, DeepWiki, Code Wiki & ReadMex",
    msgNotSupported: "Please use this tool on Zread, DeepWiki, Code Wiki, or ReadMex pages",
    msgConverting: "Converting page...",
    msgConvertSuccess: "Conversion successful! Downloading...",
    msgConvertFail: "Conversion failed: ",
    msgUnknownError: "Unknown error",
    msgOpFail: "Operation failed: ",
    msgFetchingList: "Fetching chapter list...",
    msgStartBatchFail: "Unable to start batch conversion",
    msgCanceling: "Canceling...",
    msgNoBatch: "No running batch operation",
    msgCancelFail: "Cancellation failed: ",
    msgGetBatchStatusFail: "Unable to get batch status: ",
    msgProcessing: "Processing",
    batchStarted: "Found {total} pages. Starting batch conversion...",
    batchProcessingItem: "Processing {current}/{total}: {title}",
    batchConvertedItem: "Converted {processed}/{total}: {title}",
    batchFailedItem: "Failed {title}: {error}",
    batchCancelling: "Cancelling... processed {processed}/{total}.",
    batchCancelled: "Batch cancelled. Success {processed}, Failed {failed}.",
    batchZipping: "Creating ZIP with {processed} files...",
    batchCompleted: "ZIP ready. Success {processed}, Failed {failed}.",
    batchError: "Batch conversion failed: {error}",
    langSwitcherLabel: "Language switcher",
    githubAriaLabel: "GitHub repository"
  }
};

document.addEventListener('DOMContentLoaded', () => {
  let currentLang = 'zh';
  let hasManualLanguageSelection = false;
  let currentStatus = { key: 'statusReady', params: {}, rawMessage: '' };
  let currentBatchView = {
    title: { key: 'batchProcessing', params: {}, rawMessage: '' },
    current: { key: 'batchPreparing', params: {}, rawMessage: '' },
    count: { current: 0, total: 0 }
  };

  const convertBtn = document.getElementById('convertBtn');
  const batchBtn = document.getElementById('batchDownloadBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const batchProgress = document.getElementById('batchProgress');
  const progressFill = document.getElementById('progressFill');
  const batchStatusTitle = document.getElementById('batchStatusTitle');
  const batchCurrent = document.getElementById('batchCurrent');
  const batchCount = document.getElementById('batchCount');

  function t(key, params = {}) {
    const template = i18n[currentLang][key] || i18n.zh[key] || key;
    return template.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '');
  }

  function renderStatus() {
    statusText.textContent = currentStatus.rawMessage || t(currentStatus.key, currentStatus.params);
  }

  function renderBatchProgress() {
    batchStatusTitle.textContent = currentBatchView.title.rawMessage
      || t(currentBatchView.title.key, currentBatchView.title.params);
    batchCurrent.textContent = currentBatchView.current.rawMessage
      || t(currentBatchView.current.key, currentBatchView.current.params);
    batchCount.textContent = `${currentBatchView.count.current} / ${currentBatchView.count.total}`;
  }

  function applyLanguage(lang) {
    currentLang = i18n[lang] ? lang : 'zh';
    document.documentElement.lang = currentLang;
    
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === currentLang);
      btn.setAttribute('aria-pressed', String(btn.dataset.lang === currentLang));
    });

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) {
        el.textContent = t(key);
      }
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      const key = el.dataset.i18nAriaLabel;
      if (key) {
        el.setAttribute('aria-label', t(key));
      }
    });

    renderStatus();
    renderBatchProgress();
    
    chrome.storage.local.set({ appLang: currentLang });
  }

  function getMsg(key) {
    return t(key);
  }

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      hasManualLanguageSelection = true;
      applyLanguage(btn.dataset.lang);
    });
  });

  chrome.storage.local.get(['appLang'], (result) => {
    if (!hasManualLanguageSelection) {
      applyLanguage(result.appLang || 'zh');
    }
  });

  // Listen for batch updates from background
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'batchUpdate') {
      applyBatchStatus(request);
    }
  });

  initializeBatchStatus();

  function getSupportedPlatform(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.includes('zread.ai')) return { id: 'zread', label: 'Zread' };
    if (url.includes('deepwiki.com')) return { id: 'deepwiki', label: 'DeepWiki' };
    if (url.includes('codewiki.google')) return { id: 'codewiki', label: 'Code Wiki' };
    if (url.includes('readmex.com')) return { id: 'readmex', label: 'ReadMex' };
    return null;
  }

  // Single page conversion
  convertBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const platform = getSupportedPlatform(tab.url);
      if (!platform) {
        showStatus('msgNotSupported', 'warning');
        return;
      }

      showStatus('msgConverting', 'info');
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'convertToMarkdown' });

      if (response && response.success) {
        const headTitle = response.headTitle || '';
        const currentTitle = response.markdownTitle;
        const repoName = response.repoName || '';
        const fileName = repoName
          ? `${sanitizeName(repoName)}-${sanitizeName(currentTitle)}.md`
          : headTitle
            ? `${sanitizeName(headTitle)}-${sanitizeName(currentTitle)}.md`
            : `${sanitizeName(currentTitle)}.md`;

        const blob = new Blob([response.markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);

        chrome.downloads.download({ url, filename: fileName, saveAs: true });

        showStatus('msgConvertSuccess', 'success');
      } else {
        showStatus(getMsg('msgConvertFail') + (response?.error || getMsg('msgUnknownError')), 'error');
      }
    } catch (error) {
      showStatus(getMsg('msgOpFail') + error.message, 'error');
    }
  });

  // Batch conversion
  batchBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const platform = getSupportedPlatform(tab.url);
      if (!platform) {
        showStatus('msgNotSupported', 'warning');
        return;
      }

      showCancelBtn(true);
      disableBatchBtn(true);
      showStatus('msgFetchingList', 'info');

      const response = await chrome.runtime.sendMessage({ action: 'startBatch', tabId: tab.id });

      if (!response || !response.success) {
        throw new Error(response?.error || getMsg('msgStartBatchFail'));
      }
    } catch (error) {
      showStatus(getMsg('msgOpFail') + error.message, 'error');
      showCancelBtn(false);
      disableBatchBtn(false);
    }
  });

  // Cancel batch
  cancelBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'cancelBatch' });
      if (response && response.success) {
        showStatus('msgCanceling', 'info');
      } else {
        showStatus('msgNoBatch', 'info');
      }
    } catch (error) {
      showStatus(getMsg('msgCancelFail') + error.message, 'error');
    }
  });

  async function initializeBatchStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getBatchStatus' });
      applyBatchStatus(response);
    } catch (error) {
      console.warn(getMsg('msgGetBatchStatusFail'), error.message);
    }
  }

  function applyBatchStatus(payload) {
    if (!payload) return;

    if (payload.running) {
      showCancelBtn(true);
      disableBatchBtn(true);
      showBatchProgress(true);
      updateProgress(getDisplayedProgressCount(payload), payload.total || 0);
    } else {
      showCancelBtn(false);
      disableBatchBtn(false);
      showBatchProgress(false);
      updateProgress(payload.processed || 0, payload.total || 0);
    }

    const translatedBatchStatus = translateBatchPayload(payload);
    setBatchViewFromPayload(payload, translatedBatchStatus);

    if (translatedBatchStatus) {
      showStatus(translatedBatchStatus.key, payload.level || 'info', translatedBatchStatus.params);
    } else if (payload.message) {
      showStatus(payload.message, payload.level || 'info', {}, true);
    }

    // Batch complete - reset state
    if (payload.type === 'completed' || payload.type === 'cancelled' || payload.type === 'error') {
      setTimeout(() => {
        showBatchProgress(false);
        showCancelBtn(false);
        disableBatchBtn(false);
      }, 2000);
    }
  }

  function updateProgress(current, total) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    currentBatchView.count = { current, total };
  }

  function showBatchProgress(show) {
    batchProgress.style.display = show ? 'block' : 'none';
  }

  function showCancelBtn(show) {
    cancelBtn.style.display = show ? 'flex' : 'none';
  }

  function disableBatchBtn(disable) {
    batchBtn.disabled = disable;
  }

  function showStatus(message, type, params = {}, isRaw = false) {
    currentStatus = isRaw
      ? { key: '', params: {}, rawMessage: message }
      : { key: message, params, rawMessage: '' };

    renderStatus();
    status.className = 'status';
    switch (type) {
      case 'success': status.classList.add('status-success'); break;
      case 'error': status.classList.add('status-error'); break;
      case 'warning': status.classList.add('status-warning'); break;
      default: status.classList.add('status-info');
    }
  }

  function setBatchViewFromPayload(payload, translatedBatchStatus) {
    if (translatedBatchStatus) {
      const usesGenericTitle = payload.type === 'processing'
        || payload.type === 'pageProcessed'
        || payload.type === 'pageFailed';

      currentBatchView.title = usesGenericTitle
        ? { key: 'batchProcessing', params: {}, rawMessage: '' }
        : { key: translatedBatchStatus.key, params: translatedBatchStatus.params, rawMessage: '' };

      currentBatchView.current = {
        key: translatedBatchStatus.key,
        params: translatedBatchStatus.params,
        rawMessage: ''
      };
    } else if (payload.message) {
      currentBatchView.title = { key: '', params: {}, rawMessage: payload.message };
      currentBatchView.current = {
        key: '',
        params: {},
        rawMessage: payload.message.length > 30 ? `${payload.message.substring(0, 30)}...` : payload.message
      };
    } else {
      currentBatchView.title = { key: 'batchProcessing', params: {}, rawMessage: '' };
      currentBatchView.current = { key: 'batchPreparing', params: {}, rawMessage: '' };
    }

    renderBatchProgress();
  }

  function translateBatchPayload(payload) {
    switch (payload.type) {
      case 'idle':
        return { key: 'statusReady', params: {} };
      case 'started':
        return { key: 'batchStarted', params: { total: payload.total || 0 } };
      case 'processing': {
        const title = extractTitleFromProcessingMessage(payload.message);
        return { key: 'batchProcessingItem', params: { current: (payload.processed || 0) + 1, total: payload.total || 0, title } };
      }
      case 'pageProcessed': {
        const title = extractTitleFromProcessingMessage(payload.message);
        return { key: 'batchConvertedItem', params: { processed: payload.processed || 0, total: payload.total || 0, title } };
      }
      case 'pageFailed': {
        const failure = extractFailureDetails(payload.message);
        return { key: 'batchFailedItem', params: { title: failure.title, error: failure.error } };
      }
      case 'cancelling':
        return { key: 'batchCancelling', params: { processed: payload.processed || 0, total: payload.total || 0 } };
      case 'cancelled':
        return { key: 'batchCancelled', params: { processed: payload.processed || 0, failed: payload.failed || 0 } };
      case 'zipping':
        return { key: 'batchZipping', params: { processed: payload.processed || 0 } };
      case 'completed':
        return { key: 'batchCompleted', params: { processed: payload.processed || 0, failed: payload.failed || 0 } };
      case 'error':
        return { key: 'batchError', params: { error: payload.message || getMsg('msgUnknownError') } };
      default:
        return null;
    }
  }

  function extractTitleFromProcessingMessage(message) {
    if (!message) return '';
    const [, title = ''] = message.split(': ');
    return title;
  }

  function extractFailureDetails(message) {
    if (!message) {
      return { title: '', error: getMsg('msgUnknownError') };
    }

    const match = message.match(/^Failed\s+(.*?):\s+(.*)$/);
    if (match) {
      return { title: match[1], error: match[2] };
    }

    return { title: '', error: message };
  }

  function getDisplayedProgressCount(payload) {
    if (payload.type === 'processing') {
      return Math.min((payload.processed || 0) + (payload.failed || 0) + 1, payload.total || 0);
    }

    return Math.min((payload.processed || 0) + (payload.failed || 0), payload.total || 0);
  }

  function sanitizeName(value) {
    if (!value || typeof value !== 'string') return 'page';
    return value
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
});
