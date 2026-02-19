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

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-manager") {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);

  if (request.action === "getCurrentVideoInfo") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/watch*" });
        const youtubeTab = tabs[0];

        if (youtubeTab && youtubeTab.url && youtubeTab.url.includes("youtube.com/watch")) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: youtubeTab.id },
              function: scrapeYouTubePageInfo,
            });
            if (results && results[0] && results[0].result && results[0].result.videoId) {
              sendResponse({ success: true, data: results[0].result });
            } else {
              sendResponse({ success: false, error: "Could not extract info or not a video page." });
            }
          } catch (e) {
            console.error("Error scripting for current video info:", e);
            sendResponse({ success: false, error: e.message });
          }
        } else {
          sendResponse({ success: false, error: "No YouTube video tab found. Please navigate to a YouTube video page." });
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
      if (!videoInfo || !videoInfo.videoId) {
        sendResponse({ success: false, error: "Invalid video data provided." });
        return;
      }
      if (!videoInfo.channelId || videoInfo.channelId === "N/A_ChannelID_Unavailable") {
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
