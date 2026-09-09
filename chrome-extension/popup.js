document.addEventListener('DOMContentLoaded', () => {
  const currentVideoInfoDiv = document.getElementById('currentVideoInfo');
  const saveCurrentVideoButton = document.getElementById('saveCurrentVideoButton');
  const statusMessageDiv = document.getElementById('statusMessage');
  const apiStatusDot = document.getElementById('apiStatusDot');
  const apiStatusText = document.getElementById('apiStatusText');
  const bookmarkFrame = document.getElementById('bookmarkFrame');
  const offlineMsg = document.getElementById('offlineMsg');

  let currentVideoData = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function displayStatus(message, isError = false) {
    statusMessageDiv.textContent = message;
    statusMessageDiv.style.color = isError ? '#f88' : '#6f6';
    statusMessageDiv.classList.remove('hidden');
    setTimeout(() => statusMessageDiv.classList.add('hidden'), 5000);
  }

  async function checkApiStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "checkApiStatus" });
      if (response && response.online) {
        apiStatusDot.style.background = '#28a745';
        apiStatusText.textContent = 'BookMarkManager online';
        document.getElementById('iframeWrap').classList.remove('hidden');
        offlineMsg.classList.add('hidden');
      } else {
        apiStatusDot.style.background = '#dc3545';
        apiStatusText.textContent = 'BookMarkManager offline — start Docker';
        document.getElementById('iframeWrap').classList.add('hidden');
        offlineMsg.classList.remove('hidden');
      }
    } catch {
      apiStatusDot.style.background = '#dc3545';
      apiStatusText.textContent = 'BookMarkManager offline — start Docker';
      document.getElementById('iframeWrap').classList.add('hidden');
      offlineMsg.classList.remove('hidden');
    }
  }

  async function loadCurrentVideoInfo() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getCurrentVideoInfo" });
      if (response && response.success && response.data) {
        currentVideoData = response.data;
        const isWeb = currentVideoData.type === 'web';
        const detail = isWeb
          ? `Web page &nbsp;|&nbsp; ${(currentVideoData.pageTextLength || 0).toLocaleString()} chars` +
            (currentVideoData.pageTextTruncated ? ' (truncated)' : '')
          : `ID: ${currentVideoData.videoId}`;
        currentVideoInfoDiv.innerHTML = `
          <h3>${escapeHtml(currentVideoData.videoTitle)}</h3>
          <p>${escapeHtml(currentVideoData.channelName || 'N/A')} &nbsp;|&nbsp; ${detail}</p>
        `;
        saveCurrentVideoButton.textContent = isWeb ? "Save Page to BookMarkManager" : "Save to BookMarkManager";
        if (isWeb || (currentVideoData.channelId && currentVideoData.channelId !== "N/A_ChannelID_Unavailable")) {
          saveCurrentVideoButton.classList.remove('hidden');
        } else {
          currentVideoInfoDiv.innerHTML += `<p style="color:#f88;">Cannot save: Channel ID unavailable.</p>`;
          saveCurrentVideoButton.classList.add('hidden');
        }
      } else {
        currentVideoInfoDiv.textContent = (response && response.error) || "No page selected. Open a web page or YouTube video first.";
        saveCurrentVideoButton.classList.add('hidden');
      }
    } catch (error) {
      console.error("Error fetching current video info:", error);
      currentVideoInfoDiv.textContent = "Error fetching current video details.";
      saveCurrentVideoButton.classList.add('hidden');
    }
  }

  saveCurrentVideoButton.addEventListener('click', async () => {
    if (currentVideoData) {
      try {
        saveCurrentVideoButton.disabled = true;
        saveCurrentVideoButton.textContent = "Saving...";
        const response = await chrome.runtime.sendMessage({ action: "saveVideo", data: currentVideoData });
        if (response && response.success) {
          displayStatus(response.message || `Saved "${currentVideoData.videoTitle}"`);
          // Reload the iframe so the new video appears in the list
          bookmarkFrame.src = bookmarkFrame.src;
        } else {
          displayStatus(response.error || "Failed to save video.", true);
        }
      } catch (error) {
        console.error("Error saving video:", error);
        displayStatus("Error communicating with background script.", true);
      } finally {
        saveCurrentVideoButton.disabled = false;
        saveCurrentVideoButton.textContent = currentVideoData.type === 'web' ? "Save Page to BookMarkManager" : "Save to BookMarkManager";
      }
    }
  });

  checkApiStatus();
  loadCurrentVideoInfo();
});
