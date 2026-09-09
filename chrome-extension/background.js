const API_BASE_URL = 'http://localhost:5000/api';

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
  console.log('Service worker started');
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Service worker installed');
});

setInterval(() => {
  console.log('Service worker heartbeat');
}, 30000);

// --- YouTube Info Scraper Function (injected into page) ---
function scrapeYouTubePageInfo() {
  console.log('Starting YouTube page info scraping...');

  const videoId = new URLSearchParams(window.location.search).get('v');
  console.log('Extracted videoId:', videoId);

  let videoTitle = document.title.replace(/ - YouTube$/, "").trim();
  console.log('Initial videoTitle from document.title:', videoTitle);

  const metaTitleTag = document.querySelector('meta[name="title"]');
  if (metaTitleTag && metaTitleTag.content && (videoTitle === "YouTube" || videoTitle === "")) {
    videoTitle = metaTitleTag.content;
  } else {
    const h1Title = document.querySelector('#title h1.ytd-watch-metadata yt-formatted-string, h1.title.ytd-video-primary-info-renderer');
    if (h1Title && h1Title.textContent && (videoTitle === "YouTube" || videoTitle === "" || videoTitle.length < 5)) {
      videoTitle = h1Title.textContent.trim();
    }
  }

  let channelId = null;
  let channelName = null;
  let channelUrl = null;
  let channelHandle = null;
  let channelIdSource = 'none';

  const channelMetaTag = document.querySelector('meta[itemprop="channelId"]');
  if (channelMetaTag && channelMetaTag.content) {
    channelId = channelMetaTag.content;
    channelIdSource = 'meta';
  }

  const ownerElement = document.querySelector(
    'ytd-video-owner-renderer #channel-name a.yt-simple-endpoint, ' +
    '#meta-contents ytd-channel-name a.yt-simple-endpoint, ' +
    '#upload-info #channel-name a.yt-simple-endpoint, ' +
    'ytd-channel-name .yt-simple-endpoint'
  );

  if (ownerElement) {
    channelName = ownerElement.textContent.trim();
    channelUrl = ownerElement.href;

    if (channelUrl && !channelId) {
      const pathSegments = new URL(channelUrl).pathname.split('/');
      const lastSegment = pathSegments.pop() || pathSegments.pop();

      if (lastSegment && lastSegment.startsWith('UC')) {
        channelId = lastSegment;
        channelIdSource = 'url_UC';
      } else if (lastSegment && lastSegment.startsWith('@')) {
        channelHandle = lastSegment;
        channelIdSource = 'url_handle';
      }
    }
  }

  if (!channelName) {
    const authorMetaTag = document.querySelector('meta[itemprop="author"]');
    if (authorMetaTag && authorMetaTag.content) {
      channelName = authorMetaTag.content;
    }
  }

  if (!channelId) {
    try {
      const ytInitialData = window.ytInitialData || JSON.parse(Array.from(document.scripts).find(s => s.textContent.includes("ytInitialData ="))?.textContent?.match(/ytInitialData\s*=\s*(\{.+?\});/)?.[1]);

      if (ytInitialData) {
        const idFromData = ytInitialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents
          ?.find(c => c.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer
          ?.owner?.videoOwnerRenderer?.navigationEndpoint?.browseEndpoint?.browseId;

        if (idFromData && idFromData.startsWith('UC')) {
          channelId = idFromData;
          channelIdSource = 'ytInitialData';
        }
      }
    } catch(e) {
      console.warn("Error parsing ytInitialData for channelId:", e);
    }
  }

  if ((!channelId || channelIdSource === 'handle_only' || channelIdSource === 'url_handle') && channelHandle) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', `https://www.youtube.com/${channelHandle}`, false);
      xhr.send(null);
      if (xhr.status === 200) {
        const html = xhr.responseText;
        const idMatch = html.match(/"channelId":"(UC[^"]+)"/);
        if (idMatch && idMatch[1]) {
          channelId = idMatch[1];
          channelIdSource = 'fetched_from_handle';
        }
        const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/);
        if (canonicalMatch && canonicalMatch[1]) {
          channelUrl = canonicalMatch[1];
        }
        const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
        if (nameMatch && nameMatch[1]) {
          channelName = nameMatch[1];
        }
      }
    } catch (e) {
      console.warn('Error fetching channel page for handle:', channelHandle, e);
    }
  }

  if (!channelId && channelHandle) {
    channelId = channelHandle;
    channelIdSource = 'handle_only';
  }

  return {
    scrapedAt: new Date().toISOString(),
    videoId: videoId || null,
    videoTitle: videoTitle || "N/A",
    channelId: channelId || "N/A_ChannelID_Unavailable",
    channelName: channelName || "N/A",
    channelUrl: channelUrl || "N/A",
    videoUrl: window.location.href,
    channelIdSource: channelIdSource
  };
}
// --- End of Scraper Function ---

// --- Web Page Scraper Function (injected into any non-YouTube page) ---
function scrapeWebPageInfo() {
  const meta = (sel) => document.querySelector(sel)?.content?.trim() || null;

  const title = meta('meta[property="og:title"]') || document.title.trim() || window.location.href;
  const siteName = meta('meta[property="og:site_name"]') || window.location.hostname.replace(/^www\./, '');
  const thumbnailUrl = meta('meta[property="og:image"]')
    || document.querySelector('link[rel~="icon"]')?.href
    || null;

  // Prefer the main content region; fall back to the whole body if it is too short
  let root = document.querySelector('main, article, [role="main"]');
  let text = root ? (root.innerText || '') : '';
  if (text.trim().length < 500) text = document.body?.innerText || '';
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const MAX_CHARS = 300000;
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + '\n\n[Page text truncated by BookMarkManager extension]';
    truncated = true;
  }

  return {
    type: 'web',
    scrapedAt: new Date().toISOString(),
    videoId: null,                    // server derives it from the URL
    videoTitle: title,
    channelId: window.location.hostname,
    channelName: siteName,
    channelUrl: window.location.origin,
    channelIdSource: 'hostname',
    videoUrl: window.location.href,
    thumbnailUrl: thumbnailUrl,
    pageText: text,
    pageTextLength: text.length,
    pageTextTruncated: truncated
  };
}
// --- End of Web Page Scraper ---

// The tab the user was on when they opened the manager. The popup opens in its
// own tab, so "active tab" would be the popup itself by the time it asks.
let sourceTabId = null;
// Screenshot of the source tab, taken while it is still visible (before the popup tab opens)
let sourceScreenshot = null;

const THUMB_W = 320;
const THUMB_H = 180;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Shrink a full-tab screenshot to a 320x180 JPEG data URL (center-crop, cover)
async function shrinkScreenshot(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const scale = Math.max(THUMB_W / bitmap.width, THUMB_H / bitmap.height);
  const sw = THUMB_W / scale;
  const sh = THUMB_H / scale;
  const sx = (bitmap.width - sw) / 2;
  const sy = 0; // keep the top of the page (headline area)

  const canvas = new OffscreenCanvas(THUMB_W, THUMB_H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, THUMB_W, THUMB_H);
  bitmap.close();

  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  return 'data:image/jpeg;base64,' + arrayBufferToBase64(await out.arrayBuffer());
}

async function captureSourceTab(tab) {
  sourceScreenshot = null;
  if (!tab || !/^https?:/.test(tab.url || '') || isYouTubeWatchUrl(tab.url)) return;
  try {
    const full = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    sourceScreenshot = await shrinkScreenshot(full);
  } catch (e) {
    console.warn('Screenshot failed (og:image will be used instead):', e.message);
  }
}

async function openManager(tab) {
  sourceTabId = tab ? tab.id : null;
  await captureSourceTab(tab);
  chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
}

function isYouTubeWatchUrl(url) {
  return !!url && url.includes("youtube.com/watch");
}

async function findSourceTab() {
  if (sourceTabId !== null) {
    try {
      const tab = await chrome.tabs.get(sourceTabId);
      if (tab && tab.url) return tab;
    } catch { /* tab was closed */ }
  }
  // Fallback: any open YouTube watch tab (old behaviour)
  const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/watch*" });
  return tabs[0] || null;
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-manager") {
    openManager(tab);
  }
});

chrome.action.onClicked.addListener((tab) => {
  openManager(tab);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);

  if (request.action === "getCurrentVideoInfo") {
    (async () => {
      try {
        const tab = await findSourceTab();

        if (!tab || !tab.url) {
          sendResponse({ success: false, error: "No page found. Open a web page or YouTube video, then click the extension icon." });
          return;
        }
        if (!/^https?:/.test(tab.url)) {
          sendResponse({ success: false, error: "This is a browser page and cannot be saved." });
          return;
        }

        const isYouTube = isYouTubeWatchUrl(tab.url);
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: isYouTube ? scrapeYouTubePageInfo : scrapeWebPageInfo,
          });
          const data = results && results[0] && results[0].result;
          if (isYouTube) {
            if (data && data.videoId) {
              sendResponse({ success: true, data: { ...data, type: 'youtube' } });
            } else {
              sendResponse({ success: false, error: "Could not extract info or not a video page." });
            }
          } else {
            if (data && data.pageText) {
              // Prefer the real screenshot; fall back to og:image / favicon
              if (sourceScreenshot) data.thumbnailUrl = sourceScreenshot;
              sendResponse({ success: true, data });
            } else {
              sendResponse({ success: false, error: "This page has no readable text to save." });
            }
          }
        } catch (e) {
          console.error("Error scripting for current page info:", e);
          sendResponse({ success: false, error: e.message });
        }
      } catch (error) {
        console.error("Error querying tabs:", error);
        sendResponse({ success: false, error: "Error accessing tab information." });
      }
    })();
    return true;
  }

  else if (request.action === "saveVideo") {
    (async () => {
      const videoInfo = request.data;
      const isWeb = videoInfo && videoInfo.type === 'web';
      if (!videoInfo || (isWeb ? !videoInfo.videoUrl : !videoInfo.videoId)) {
        sendResponse({ success: false, error: "Invalid page data provided." });
        return;
      }
      if (isWeb && !videoInfo.pageText) {
        sendResponse({ success: false, error: "Page text is empty, cannot save page." });
        return;
      }
      if (!isWeb && (!videoInfo.channelId || videoInfo.channelId === "N/A_ChannelID_Unavailable")) {
        sendResponse({ success: false, error: "Channel ID is missing, cannot save video." });
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(videoInfo)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.error || `Server error: ${response.status}`;
          sendResponse({ success: false, error: errorMsg });
          return;
        }

        const result = await response.json();
        if (result.success) {
          sendResponse({ success: true, message: `"${videoInfo.videoTitle}" saved to BookMarkManager.` });
        } else {
          const errorMsg = result.error || "Unknown error from server.";
          sendResponse({ success: false, error: errorMsg });
        }
      } catch (error) {
        const errorMsg = error.message.includes('Failed to fetch')
          ? "BookMarkManager is not running. Start the Docker container at localhost:5000."
          : `Error: ${error.message}`;
        console.error("Error saving video to API:", error);
        sendResponse({ success: false, error: errorMsg });
      }
    })();
    return true;
  }

  else if (request.action === "checkApiStatus") {
    (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        sendResponse({ online: response.ok });
      } catch {
        sendResponse({ online: false });
      }
    })();
    return true;
  }
});
