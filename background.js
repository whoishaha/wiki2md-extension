// background.js - wiki2md-extension service worker
// Handles batch processing for Zread, DeepWiki, and Code Wiki.

importScripts('lib/jszip.min.js');

const MESSAGE_TIMEOUT = 30000;
const messageQueue = {};

const createInitialBatchState = () => ({
  isRunning: false,
  tabId: null,
  originalUrl: null,
  pages: [],
  convertedPages: [],
  folderName: '',
  processed: 0,
  failed: 0,
  cancelRequested: false,
  total: 0,
  currentTitle: '',
  fileNames: new Set()
});

let batchState = createInitialBatchState();
let lastBatchReport = {
  type: 'idle',
  message: 'Batch converter ready.',
  level: 'info',
  processed: 0,
  failed: 0,
  total: 0,
  running: false
};

function getSupportedPlatform(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.includes('zread.ai')) return { id: 'zread', label: 'Zread', fallbackFolder: 'zread-docs' };
  if (url.includes('deepwiki.com')) return { id: 'deepwiki', label: 'DeepWiki', fallbackFolder: 'deepwiki-docs' };
  if (url.includes('codewiki.google')) return { id: 'codewiki', label: 'Code Wiki', fallbackFolder: 'code-wiki-docs' };
  return null;
}

// ---- Message Queue ----

function markTabPending(tabId) {
  if (!messageQueue[tabId]) {
    messageQueue[tabId] = { isReady: false, queue: [] };
    return;
  }
  messageQueue[tabId].isReady = false;
}

function dispatchMessageToTab(tabId, item) {
  chrome.tabs.sendMessage(tabId, item.message, response => {
    if (chrome.runtime.lastError) {
      item.reject(new Error(chrome.runtime.lastError.message));
      return;
    }
    item.resolve(response);
  });
}

function flushMessageQueue(tabId) {
  const entry = messageQueue[tabId];
  if (!entry) return;
  entry.isReady = true;
  while (entry.queue.length > 0) {
    const payload = entry.queue.shift();
    dispatchMessageToTab(tabId, payload);
  }
}

function queueMessageForTab(tabId, message, resolve, reject) {
  if (!messageQueue[tabId]) {
    messageQueue[tabId] = { isReady: false, queue: [] };
  }

  const queueItem = {
    message,
    resolve: (response) => {
      clearTimeout(queueItem.timeoutId);
      resolve(response);
    },
    reject: (error) => {
      clearTimeout(queueItem.timeoutId);
      reject(error);
    }
  };

  queueItem.timeoutId = setTimeout(() => {
    queueItem.reject(new Error(`Timed out waiting for response for ${message.action}`));
  }, MESSAGE_TIMEOUT);

  messageQueue[tabId].queue.push(queueItem);
}

function attemptDirectMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function shouldQueueForError(error) {
  if (!error || !error.message) return false;
  return error.message.includes('Receiving end does not exist') ||
    error.message.includes('Could not establish connection');
}

function sendMessageToTab(tabId, message) {
  const entry = messageQueue[tabId];
  const tryDirect = () => attemptDirectMessage(tabId, message);

  if (entry && entry.isReady) {
    return tryDirect();
  }

  return tryDirect().catch(error => {
    if (!shouldQueueForError(error)) {
      throw error;
    }
    return new Promise((resolve, reject) => {
      queueMessageForTab(tabId, message, resolve, reject);
    });
  });
}

// ---- Batch Status ----

function broadcastBatchUpdate(type, data = {}, overrideRunning) {
  const running = typeof overrideRunning === 'boolean' ? overrideRunning : batchState.isRunning;
  const payload = {
    action: 'batchUpdate',
    type,
    running,
    processed: data.processed ?? batchState.processed,
    failed: data.failed ?? batchState.failed,
    total: data.total ?? batchState.total,
    cancelRequested: batchState.cancelRequested,
    message: data.message || '',
    level: data.level || 'info'
  };

  lastBatchReport = payload;

  chrome.runtime.sendMessage(payload, () => {
    const error = chrome.runtime.lastError;
    if (error && error.message && !error.message.includes('Receiving end does not exist')) {
      console.warn('Batch update broadcast error:', error.message);
    }
  });
}

function getBatchStatusPayload() {
  if (batchState.isRunning) {
    return {
      running: true,
      processed: batchState.processed,
      failed: batchState.failed,
      total: batchState.total,
      cancelRequested: batchState.cancelRequested,
      message: lastBatchReport.message,
      level: lastBatchReport.level,
      type: lastBatchReport.type
    };
  }
  const { action, ...rest } = lastBatchReport;
  return { running: false, ...rest };
}

function sanitizeName(value, fallback = 'page') {
  if (!value || typeof value !== 'string') return fallback;
  return value
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || fallback;
}

function getUniqueFileName(desired) {
  const base = sanitizeName(desired, 'page');
  let candidate = base;
  let counter = 1;
  while (batchState.fileNames.has(candidate)) {
    candidate = `${base}-${counter++}`;
  }
  batchState.fileNames.add(candidate);
  return candidate + '.md';
}

function resetBatchState() {
  batchState = createInitialBatchState();
}

function cancelBatchProcessing() {
  if (!batchState.isRunning) return false;
  batchState.cancelRequested = true;
  broadcastBatchUpdate('cancelling', {
    message: `Cancelling... processed ${batchState.processed}/${batchState.total}.`
  });
  return true;
}

// ---- Navigation ----

async function restoreOriginalPage() {
  if (!batchState.tabId || !batchState.originalUrl) return;
  try {
    await navigateToPage(batchState.tabId, batchState.originalUrl);
  } catch (error) {
    console.warn('Failed to restore original page:', error.message);
  } finally {
    batchState.originalUrl = null;
  }
}

function waitForNavigation(tabId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Navigation timeout.'));
    }, MESSAGE_TIMEOUT);

    function cleanup() {
      clearTimeout(timeoutId);
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      chrome.webNavigation.onErrorOccurred.removeListener(onError);
    }

    function onCompleted(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        cleanup();
        resolve();
      }
    }

    function onError(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        cleanup();
        reject(new Error(details.error || 'Navigation error'));
      }
    }

    chrome.webNavigation.onCompleted.addListener(onCompleted);
    chrome.webNavigation.onErrorOccurred.addListener(onError);
  });
}

function navigateToPage(tabId, url) {
  markTabPending(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      waitForNavigation(tabId).then(resolve).catch(reject);
    });
  });
}

// ---- Batch Processing ----

async function processSinglePage(page) {
  if (batchState.cancelRequested) return;

  const currentStep = batchState.processed + batchState.failed + 1;
  batchState.currentTitle = page.title;
  broadcastBatchUpdate('processing', {
    message: `Processing ${currentStep}/${batchState.total}: ${page.title}`
  });

  await navigateToPage(batchState.tabId, page.url);
  if (batchState.cancelRequested) return;

  // Give content script time to initialize on the new page
  await new Promise(resolve => setTimeout(resolve, 1000));

  const convertResponse = await sendMessageToTab(batchState.tabId, { action: 'convertToMarkdown' });
  if (!convertResponse || !convertResponse.success) {
    throw new Error(convertResponse?.error || 'Conversion failed');
  }

  const nameParts = [convertResponse.repoName, convertResponse.markdownTitle || page.title]
    .filter(part => part && typeof part === 'string');
  const fileName = getUniqueFileName(nameParts.join('-') || page.title);
  batchState.convertedPages.push({ title: fileName, content: convertResponse.markdown });
  batchState.processed += 1;
  broadcastBatchUpdate('pageProcessed', {
    message: `Converted ${batchState.processed}/${batchState.total}: ${page.title}`
  });
}

async function createZipArchive() {
  const zip = new JSZip();
  let indexContent = `# ${batchState.folderName}\n\n## Content Index\n\n`;

  batchState.convertedPages.forEach(page => {
    indexContent += `- [${page.title}](${page.title})\n`;
    zip.file(`${page.title}`, page.content);
  });

  zip.file('README.md', indexContent);

  const base64Zip = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  const dataUrl = `data:application/zip;base64,${base64Zip}`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: `${sanitizeName(batchState.folderName, 'wiki-docs')}.zip`,
      saveAs: true
    }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function runBatchProcessing() {
  try {
    for (const page of batchState.pages) {
      if (batchState.cancelRequested) break;

      try {
        await processSinglePage(page);
      } catch (error) {
        batchState.failed += 1;
        broadcastBatchUpdate('pageFailed', {
          message: `Failed ${page.title}: ${error.message || error}`,
          level: 'error'
        });
      }
    }

    if (batchState.cancelRequested) {
      batchState.isRunning = false;
      broadcastBatchUpdate('cancelled', {
        message: `Batch cancelled. Success ${batchState.processed}, Failed ${batchState.failed}.`
      }, false);
      return;
    }

    if (!batchState.convertedPages.length) {
      throw new Error('No pages were converted successfully.');
    }

    broadcastBatchUpdate('zipping', {
      message: `Creating ZIP with ${batchState.convertedPages.length} files...`
    });

    await createZipArchive();

    batchState.isRunning = false;
    broadcastBatchUpdate('completed', {
      message: `ZIP ready. Success ${batchState.processed}, Failed ${batchState.failed}.`,
      level: 'success'
    }, false);
  } catch (error) {
    batchState.isRunning = false;
    broadcastBatchUpdate('error', {
      message: error.message || 'Batch conversion failed.',
      level: 'error'
    }, false);
  } finally {
    await restoreOriginalPage();
    resetBatchState();
  }
}

function getTabById(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

async function startBatchProcessing(tabId) {
  if (batchState.isRunning) {
    throw new Error('Batch conversion already running.');
  }

  const tab = await getTabById(tabId);
  const platform = getSupportedPlatform(tab.url);
  if (!platform) {
    throw new Error('Please open a Zread, DeepWiki, or Code Wiki page before starting batch conversion.');
  }

  // Extract all pages from sidebar
  const extraction = await sendMessageToTab(tabId, { action: 'extractAllPages' });
  if (!extraction || !extraction.success) {
    throw new Error(extraction?.error || 'Failed to extract sidebar links.');
  }

  const pages = extraction.pages || [];
  if (!pages.length) {
    throw new Error('No child pages were detected on this document.');
  }

  // Initialize batch state
  batchState = {
    isRunning: true,
    tabId,
    originalUrl: tab.url,
    pages,
    convertedPages: [],
    folderName: sanitizeName(extraction.headTitle || extraction.currentTitle || platform.fallbackFolder),
    processed: 0,
    failed: 0,
    cancelRequested: false,
    total: pages.length,
    currentTitle: '',
    fileNames: new Set()
  };

  broadcastBatchUpdate('started', {
    message: `Found ${batchState.total} pages. Starting batch conversion...`
  });

  // Start batch processing (no await - runs in background)
  runBatchProcessing();

  return {
    total: batchState.total,
    folderName: batchState.folderName
  };
}

// ---- Event Listeners ----

chrome.runtime.onInstalled.addListener(() => {
  console.log('wiki2md-extension installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'contentScriptReady') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ status: 'no-tab' });
      return;
    }
    if (!messageQueue[tabId]) {
      messageQueue[tabId] = { isReady: true, queue: [] };
    } else {
      messageQueue[tabId].isReady = true;
    }
    flushMessageQueue(tabId);
    sendResponse({ status: 'ready' });
    return;
  }

  if (request.action === 'startBatch') {
    const tabId = request.tabId;
    if (typeof tabId !== 'number') {
      sendResponse({ success: false, error: 'Missing tabId for batch start.' });
      return;
    }
    startBatchProcessing(tabId)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'cancelBatch') {
    const cancelled = cancelBatchProcessing();
    sendResponse({ success: cancelled });
    return;
  }

  if (request.action === 'getBatchStatus') {
    sendResponse(getBatchStatusPayload());
    return;
  }

  return false;
});

// Tab lifecycle management
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!getSupportedPlatform(tab.url)) return;

  if (changeInfo.status === 'loading' || changeInfo.status === 'complete') {
    markTabPending(tabId);
  }

  if (changeInfo.status === 'complete') {
    chrome.tabs.sendMessage(tabId, { action: 'pageLoaded' }, () => {
      const error = chrome.runtime.lastError;
      if (error && !error.message.includes('Receiving end does not exist')) {
        console.log('Page loaded ping error:', error.message);
      }
    });
  }
});

chrome.tabs.onActivated.addListener(activeInfo => {
  chrome.tabs.get(activeInfo.tabId, tab => {
    if (tab && getSupportedPlatform(tab.url)) {
      chrome.tabs.sendMessage(activeInfo.tabId, { action: 'tabActivated' }, () => {
        const error = chrome.runtime.lastError;
        if (error && !error.message.includes('Receiving end does not exist')) {
          console.log('Tab activated ping error:', error.message);
        }
      });
    }
  });
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (messageQueue[tabId]) {
    messageQueue[tabId].queue.forEach(item => item.reject(new Error('Tab closed.')));
    delete messageQueue[tabId];
  }

  if (batchState.isRunning && batchState.tabId === tabId) {
    batchState.isRunning = false;
    batchState.cancelRequested = true;
    broadcastBatchUpdate('error', {
      message: 'Batch cancelled because the tab was closed.',
      level: 'error'
    }, false);
    resetBatchState();
  }
});
