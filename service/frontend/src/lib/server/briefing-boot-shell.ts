/**
 * Instant HTML shell shown while the standalone briefing page is generated server-side.
 * The shell paints a spinner immediately; client JS fetches the full page with ?render=full.
 */
export function renderBriefingBootShell(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Loading briefing…</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8f6f1;
      color: #1a1a1a;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #0f1013; color: #f3f4f6; }
    }
    .briefing-boot-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
    }
    .briefing-boot-spinner {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid rgba(0, 0, 0, 0.12);
      border-top-color: #888;
      animation: briefing-boot-spin 700ms linear infinite;
    }
    @media (prefers-color-scheme: dark) {
      .briefing-boot-spinner {
        border-color: rgba(255, 255, 255, 0.14);
        border-top-color: #cbd5e1;
      }
    }
    @keyframes briefing-boot-spin {
      to { transform: rotate(360deg); }
    }
    .briefing-boot-label {
      font-size: 0.9rem;
      color: rgba(0, 0, 0, 0.55);
    }
    @media (prefers-color-scheme: dark) {
      .briefing-boot-label { color: rgba(255, 255, 255, 0.62); }
    }
    .briefing-boot-error {
      display: none;
      max-width: 28rem;
      text-align: center;
      font-size: 0.9rem;
      color: #b91c1c;
      padding: 0 1rem;
    }
  </style>
</head>
<body>
  <div class="briefing-boot-overlay" id="briefing-boot-overlay">
    <div class="briefing-boot-spinner" aria-hidden="true"></div>
    <p class="briefing-boot-label">Loading briefing…</p>
    <p class="briefing-boot-error" id="briefing-boot-error"></p>
  </div>
  <script>
    (function () {
      var url = new URL(window.location.href);
      url.searchParams.set('render', 'full');
      fetch(url.toString(), { credentials: 'same-origin' })
        .then(function (response) {
          return response.text().then(function (html) {
            if (!response.ok) {
              document.open();
              document.write(html);
              document.close();
              return;
            }
            document.open();
            document.write(html);
            document.close();
          });
        })
        .catch(function (error) {
          var overlay = document.getElementById('briefing-boot-overlay');
          var message = document.getElementById('briefing-boot-error');
          if (message) {
            message.textContent = 'Could not load this briefing. Please refresh and try again.';
            message.style.display = 'block';
          }
          if (overlay) {
            var label = overlay.querySelector('.briefing-boot-label');
            if (label) label.textContent = 'Loading failed';
          }
        });
    })();
  </script>
</body>
</html>`;
}
