const apiBase = "";
let isLoading = false;

// Transliteration map (Cyrillic to Latin)
const translitMap = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
  'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
  'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
  'Ф': 'F', 'Х': 'H', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch',
  'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya'
};

function slugify(text) {
  if (!text) return '';

  // Transliterate
  let slug = text.split('').map(char => translitMap[char] || char).join('');

  // Convert to lowercase and replace spaces/special chars with hyphens
  slug = slug
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_]+/g, '-')  // Replace spaces and underscores with hyphens
    .replace(/-+/g, '-')      // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

  return slug;
}

function updateBotCode() {
  const nameInput = document.getElementById("name");
  const codeInput = document.getElementById("botCode");
  const codeValue = slugify(nameInput.value);
  codeInput.value = codeValue;
}

/**
 * Authenticated fetch helper
 * Automatically adds auth headers and handles 401 errors
 */
async function authFetch(url, options = {}) {
  const headers = {
    ...getAuthHeaders(),
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized - redirect to login
  if (response.status === 401) {
    clearToken();
    window.location.href = "/login.html";
    throw new Error("Unauthorized");
  }

  // Handle 403 Forbidden
  if (response.status === 403) {
    showToast("Access denied");
    throw new Error("Forbidden");
  }

  return response;
}

function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function openCreateModal() {
  document.getElementById("createModal").classList.remove("hidden");
}

function closeCreateModal() {
  document.getElementById("createModal").classList.add("hidden");
  // clear streamed logs on close
  document.getElementById("createResult").textContent = "";
}

function backdropClose(event, id = "createModal") {
  if (event.target.id === id) {
    if (id === "createModal") closeCreateModal();
    if (id === "envModal") closeEnvModal();
    if (id === "updateModal") closeUpdateModal();
    if (id === "deleteModal") closeDeleteModal();
  }
}

async function createBot() {
  if (isLoading) return;
  isLoading = true;
  const btn = document.getElementById("createBtn");
  btn.disabled = true;
  const payload = {
    name: document.getElementById("name").value,
    code: document.getElementById("botCode").value,
    runtime: document.getElementById("runtime").value,
    sourceType: document.getElementById("sourceType").value,
    source: document.getElementById("source").value,
    botToken: document.getElementById("token").value,
    env: parseEnvFields(),
  };
  if (payload.sourceType === "zip" && selectedFile) {
    payload.source = selectedFile;
  }
  const logEl = document.getElementById("createResult");
  logEl.textContent = "";
  try {
    const body = payload.sourceType === "zip" && payload.source instanceof File
      ? await buildFormData(payload)
      : JSON.stringify(payload);
    const headers = payload.sourceType === "zip" && payload.source instanceof File
      ? {}
      : { "Content-Type": "application/json" };

    const res = await authFetch("/bots?stream=true", {
      method: "POST",
      headers,
      body,
    });
    let hadError = false;
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const text = chunk.endsWith("\n") ? chunk : `${chunk}\n`;
        logEl.textContent += text;
        logEl.scrollTop = logEl.scrollHeight;
        if (chunk.toLowerCase().includes("error")) hadError = true;
      }
    } else {
      const text = await res.text();
      logEl.textContent = text.endsWith("\n") ? text : `${text}\n`;
      if (!res.ok) hadError = true;
    }
    if (!res.ok || hadError) {
      showToast("Create failed");
    } else {
      showToast("Bot created");
      await loadBots();
      closeCreateModal();
    }
  } catch (err) {
    logEl.textContent += `\nERROR: ${err}`;
    showToast("Create failed");
  } finally {
    btn.disabled = false;
    isLoading = false;
  }
}

function parseEnvFields() {
  const rows = document.querySelectorAll(".env-row");
  const env = {};
  rows.forEach((row) => {
    const key = row.querySelector(".env-key")?.value?.trim();
    const value = row.querySelector(".env-value")?.value ?? "";
    if (key) env[key] = value;
  });
  return env;
}

function addEnvRow() {
  const container = document.getElementById("envRows");
  const row = document.createElement("div");
  row.className = "row env-row";
  row.innerHTML = `
    <div>
      <label>Key</label>
      <input class="env-key" placeholder="MY_ENV" />
    </div>
    <div>
      <label>Value</label>
      <input class="env-value" placeholder="value" />
    </div>
  `;
  container.appendChild(row);
}

let envEditBotId = null;

function openEnvModal(bot) {
  envEditBotId = bot.id;
  const container = document.getElementById("envRowsEdit");
  container.innerHTML = "";

  // Get allowed env from manifest
  const allowedEnv = bot.allowedEnv || {};
  const allowedKeys = Object.keys(allowedEnv).filter((k) => k !== "BOT_TOKEN");

  if (allowedKeys.length === 0) {
    container.innerHTML = '<p class="meta">No custom environment variables available for this bot.</p>';
  } else {
    // Show only allowed env variables with descriptions
    allowedKeys.forEach((key) => {
      const config = allowedEnv[key];
      const existingEnv = (bot.envs || []).find((e) => e.key === key);
      const value = existingEnv?.value || config.default || "";
      container.appendChild(buildEnvRow(key, value, config.description, config.required));
    });
  }

  document.getElementById("envResult").textContent = "";
  document.getElementById("envModal").classList.remove("hidden");
}

function closeEnvModal() {
  document.getElementById("envModal").classList.add("hidden");
  envEditBotId = null;
}

function buildEnvRow(key = "", value = "", description = "", required = false) {
  const row = document.createElement("div");
  row.className = "env-modal-row";

  const requiredLabel = required ? '<span class="required-badge">required</span>' : '';
  const descriptionText = description ? `<small class="field-hint">${description}</small>` : '';

  row.innerHTML = `
    <div>
      <label>${key || "Key"} ${requiredLabel}</label>
      <input class="env-key" type="hidden" value="${key}" />
      <input class="env-value" placeholder="${description || "value"}" value="${value}" ${required ? 'required' : ''} />
      ${descriptionText}
    </div>
  `;
  return row;
}

function addEnvRowEdit() {
  // Disabled: only show allowed env from manifest
  // const container = document.getElementById("envRowsEdit");
  // container.appendChild(buildEnvRow("", ""));
}

async function saveEnv() {
  if (!envEditBotId) return;
  const env = parseEnvFieldsFrom("envRowsEdit");
  const resultEl = document.getElementById("envResult");
  resultEl.textContent = "";
  try {
    const res = await authFetch(`/bots/${envEditBotId}/env`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env }),
    });
    if (!res.ok) {
      const text = await res.text();
      resultEl.textContent = text;
      showToast("Env update failed");
      return;
    }
    showToast("Env updated");
    closeEnvModal();
    loadBots();
  } catch (err) {
    resultEl.textContent = String(err);
    showToast("Env update failed");
  }
}

function parseEnvFieldsFrom(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .env-row`);
  const env = {};
  rows.forEach((row) => {
    const key = row.querySelector(".env-key")?.value?.trim();
    const value = row.querySelector(".env-value")?.value ?? "";
    if (key) env[key] = value;
  });
  return env;
}

function fillSample() {
  openCreateModal();
  document.getElementById("name").value = "Sample Bot";
  document.getElementById("botCode").value = "sample-bot";
  document.getElementById("sourceType").value = "local";
  document.getElementById("source").placeholder = "./packages/sample-bot";
  document.getElementById("source").classList.remove("hidden");
  document.getElementById("sourceFile").classList.add("hidden");
  document.getElementById("source").value = "../sample-bot";
}

async function loadBots() {
  try {
    const res = await authFetch("/bots");
    const bots = await res.json();
    renderBots(bots);
  } catch (err) {
    showToast("Load failed");
    console.error(err);
  }
}

function renderBots(bots) {
  const container = document.getElementById("bots");
  const empty = document.getElementById("emptyState");

  // Save state for ALL cards, not just sticky ones
  const stickyData = Array.from(container.querySelectorAll(".bot-card")).map((el) => {
    const id = el.id.replace("bot-card-", "");
    const logEl = el.querySelector(`#log-${id}`);
    const webhookEl = el.querySelector(`#webhook-${id}`);
    const contentEl = el.querySelector(`#bot-content-${id}`);
    return {
      id,
      expanded: contentEl?.classList.contains("expanded"),
      logVisible: logEl?.style.display === "block",
      webhookVisible: webhookEl?.style.display === "block",
      logText: logEl?.textContent || "",
      webhookText: webhookEl?.textContent || "",
    };
  });
  container.innerHTML = "";
  if (!bots.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  bots.forEach((bot) => {
    const card = buildBotCard(bot);
    const savedState = stickyData.find((s) => s.id === bot.id);

    // Always restore state if it exists
    if (savedState) {
      const log = card.querySelector(`#log-${bot.id}`);
      const webhook = card.querySelector(`#webhook-${bot.id}`);
      const content = card.querySelector(`#bot-content-${bot.id}`);
      const expandBtn = card.querySelector('.expand-btn');

      // Restore expanded state
      if (savedState.expanded && content && expandBtn) {
        content.classList.add("expanded");
        expandBtn.classList.add("expanded");
        expandBtn.setAttribute('aria-expanded', 'true');
        const tooltip = expandBtn.querySelector('.custom-tooltip');
        if (tooltip) tooltip.textContent = 'Hide details';
      }

      // Restore log visibility and content
      if (log && savedState.logVisible) {
        log.style.display = "block";
        if (savedState.logText) log.textContent = savedState.logText;
      }

      // Restore webhook visibility and content
      if (webhook && savedState.webhookVisible) {
        webhook.style.display = "block";
        if (savedState.webhookText) webhook.textContent = savedState.webhookText;
      }
    }

    container.appendChild(card);
  });
  if (window.htmx) {
    window.htmx.process(container);
  }
}

async function loadLogs(id) {
  const el = document.getElementById(`log-${id}`);
  const isVisible = el.style.display === "block";
  if (isVisible) {
    el.style.display = "none";
    return;
  }
  try {
    const text = await authFetch(`/bots/${id}/logs?tail=100`).then((r) => r.text());
    const finalText = text ? (text.endsWith("\n") ? text : `${text}\n`) : "no logs yet\n";
    el.textContent = finalText;
    el.style.display = "block";
  } catch (err) {
    el.textContent = `error loading logs: ${err}`;
    el.style.display = "block";
  }
}

function handleHtmxEvent(detail, sourceEl) {
  const action = sourceEl?.dataset?.action || "action";
  const status = detail?.xhr?.status;
  const suppressSuccessToast = sourceEl?.dataset?.suppressSuccessToast === "true";
  const forceRenderOnSuccess = sourceEl?.dataset?.forceRenderSuccess === "true";
  const ok = status && status >= 200 && status < 300;
  const targetSelector = sourceEl?.getAttribute?.("hx-target");
  if (targetSelector) {
    const targetEl = document.querySelector(targetSelector);
    const shouldRender =
      action === "webhook-info" ||
      sourceEl?.dataset?.renderResponse === "true" ||
      (!sourceEl?.dataset?.suppressRender && sourceEl?.getAttribute?.("hx-target"));
    if (targetEl && (shouldRender || ok === false || forceRenderOnSuccess)) {
      targetEl.style.display = "block";
      let content = detail?.xhr?.responseText;
      if (!shouldRender && ok && !forceRenderOnSuccess) {
        content = `${action} ok`;
      }
      if (!content || !content.length) {
        content = `${action} ${status ?? ""}`.trim();
      }
      try {
        const json = JSON.parse(content);
        content = JSON.stringify(json, null, 2);
      } catch {
        // keep as text
      }
      const withBreak = content.endsWith("\n") ? content : `${content}\n`;
      targetEl.textContent = withBreak;
      // prevent htmx from replacing this content on swap
      targetEl.setAttribute("hx-swap-oob", "true");
    }
  }
  if (ok) {
    if (!suppressSuccessToast) {
      showToast(`${action} ok`);
    }
    // avoid collapsing expanded panels for read-only actions
    if (!sourceEl?.dataset?.skipRefresh) {
      loadBots();
    } else if (targetSelector) {
      // mark the card as sticky to preserve
      const card = sourceEl.closest(".bot-card");
      if (card) card.dataset.sticky = "true";
    }
  } else {
    const text = detail?.xhr?.responseText || status || "error";
    showToast(`${action} failed`);
    console.error(text);
  }
}

function buildBotCard(bot) {
  const card = document.createElement("div");
  card.className = "bot-card";
  card.id = `bot-card-${bot.id}`;

  const header = document.createElement("div");
  header.className = "bot-card-header";

  // Left section with title and expand button
  const leftSection = document.createElement("div");
  leftSection.className = "bot-card-header-left";

  // Expand/collapse button
  const expandBtn = document.createElement("button");
  expandBtn.className = "icon-control-btn expand-btn";
  expandBtn.setAttribute("aria-label", "Expand or collapse bot details");
  expandBtn.setAttribute("aria-expanded", "false");
  expandBtn.setAttribute("role", "button");

  // Custom tooltip
  const expandTooltip = document.createElement("span");
  expandTooltip.className = "custom-tooltip";
  expandTooltip.textContent = "Show details";
  expandBtn.appendChild(expandTooltip);

  expandBtn.innerHTML += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
  expandBtn.onclick = () => toggleBotCard(bot.id);

  const title = document.createElement("h3");
  title.textContent = bot.name || "unnamed";

  leftSection.appendChild(expandBtn);
  leftSection.appendChild(title);
  header.appendChild(leftSection);

  const rightSection = document.createElement("div");
  rightSection.className = "bot-card-header-right";

  // Control buttons (icon-only)
  const controls = document.createElement("div");
  controls.className = "bot-controls";

  // Start button (only if not running)
  if (bot.status !== "running") {
    controls.appendChild(createIconButton("start", bot.id, "play", "Start bot"));
  }

  // Stop button (only if running)
  if (bot.status === "running") {
    controls.appendChild(createIconButton("stop", bot.id, "stop", "Stop bot"));
  }

  // Restart button (always visible)
  controls.appendChild(createIconButton("restart", bot.id, "restart", "Restart bot"));

  // Delete button (always visible)
  const deleteBtn = createIconButton("delete", bot.id, "delete", "Delete bot", true);
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    confirmDeleteBot(bot.id, bot.code || bot.name);
  };
  controls.appendChild(deleteBtn);

  rightSection.appendChild(controls);

  // Update available badge (for git bots)
  if (bot.gitStatus?.updateAvailable) {
    const updateBadge = document.createElement("span");
    updateBadge.className = "update-badge";
    updateBadge.title = `Update available: ${bot.gitStatus.currentVersion || 'current'} → ${bot.gitStatus.latestVersion || 'latest'}`;
    updateBadge.innerHTML = '🔄 Update';
    updateBadge.onclick = () => openUpdateModal(bot.id);
    rightSection.appendChild(updateBadge);
  }

  // Status badge
  const status = document.createElement("span");
  status.className = `status ${bot.status}`;
  status.textContent = bot.status;
  rightSection.appendChild(status);

  header.appendChild(rightSection);
  card.appendChild(header);

  // Content section (collapsible)
  const content = document.createElement("div");
  content.className = "bot-card-content";
  content.id = `bot-content-${bot.id}`;

  const meta = (text) => {
    const div = document.createElement("div");
    div.className = "meta";
    div.innerHTML = text;
    return div;
  };
  const created = bot.createdAt ? new Date(bot.createdAt).toLocaleString() : "—";
  if (bot.code) {
    content.appendChild(meta(`code: <span class="code-badge">${bot.code}</span>`));
  }
  content.appendChild(meta(`id: ${bot.id}`));
  content.appendChild(meta(`runtime: ${bot.runtime}`));
  const versionText = bot.latestRuntimeVersion
    ? `${bot.runtimeVersion || "unknown"} (latest ${bot.latestRuntimeVersion})`
    : bot.runtimeVersion || "unknown";
  content.appendChild(meta(`runtime version: ${versionText}`));
  content.appendChild(
    meta(
      `webhook: <a class="inline-link" href="${bot.webhookUrl || "#"}" target="_blank">${bot.webhookUrl || "not set"}</a>`
    )
  );
  content.appendChild(meta(`image: ${bot.imageName}`));
  content.appendChild(meta(`created: ${created}`));
  const envSummary = (bot.envs || [])
    .filter((e) => e.key !== "BOT_TOKEN")
    .map((e) => `${e.key}=${e.value}`)
    .join(", ");
  content.appendChild(meta(`env: ${envSummary || "—"}`));

  const actions = document.createElement("div");
  actions.className = "actions grid";

  if (bot.runtimeOutdated) {
    actions.appendChild(
      actionButton("upgrade-runtime", bot.id, "primary", "Upgrade runtime", `/bots/${bot.id}/upgrade-runtime`)
    );
  }

  // Update button for all bots
  const updateBtn = document.createElement("button");
  updateBtn.className = bot.gitStatus?.updateAvailable ? "primary" : "secondary";
  updateBtn.textContent = bot.gitStatus?.updateAvailable ? "🔄 Update available" : "Update bot";
  updateBtn.setAttribute("hx-on:click", `openUpdateModal('${bot.id}')`);
  actions.appendChild(updateBtn);

  const envBtn = document.createElement("button");
  envBtn.className = "secondary";
  envBtn.textContent = "Edit env";
  envBtn.onclick = () => openEnvModal(bot);
  actions.appendChild(envBtn);

  const logsBtn = document.createElement("button");
  logsBtn.className = "secondary";
  logsBtn.textContent = "Logs";
  logsBtn.setAttribute("hx-on:click", `loadLogs('${bot.id}')`);
  actions.appendChild(logsBtn);

  content.appendChild(actions);

  const logPanel = document.createElement("div");
  logPanel.className = "log-panel";
  const logPre = document.createElement("pre");
  logPre.id = `log-${bot.id}`;
  logPre.style.display = "none";
  logPanel.appendChild(logPre);
  content.appendChild(logPanel);

  const webhookActions = document.createElement("div");
  webhookActions.className = "actions grid";
  webhookActions.appendChild(
    actionButton(
      "setup-webhook",
      bot.id,
      "secondary",
      "Setup webhook",
      `/bots/${bot.id}/webhook/setup`,
      undefined,
      `#webhook-${bot.id}`,
      false,
      true,
      true
    )
  );
  webhookActions.appendChild(
    actionButton(
      "delete-webhook",
      bot.id,
      "secondary",
      "Delete webhook",
      `/bots/${bot.id}/webhook/delete`,
      undefined,
      `#webhook-${bot.id}`,
      false,
      true
    )
  );
  webhookActions.appendChild(
    actionButton(
      "webhook-info",
      bot.id,
      "secondary",
      "Webhook info",
      `/bots/${bot.id}/webhook`,
      "get",
      `#webhook-${bot.id}`,
      true,
      false
    )
  );

  const webhookInfo = document.createElement("pre");
  webhookInfo.id = `webhook-${bot.id}`;
  webhookInfo.className = "webhook-info";
  webhookInfo.style.display = "none";
  webhookInfo.textContent = "";

  content.appendChild(webhookActions);
  content.appendChild(webhookInfo);

  // Add content to card
  card.appendChild(content);

  return card;
}

function createIconButton(action, botId, icon, tooltip, isDelete = false) {
  const btn = document.createElement("button");
  btn.className = "icon-control-btn";
  btn.dataset.action = action;

  // Accessibility attributes
  btn.setAttribute("aria-label", tooltip);
  btn.setAttribute("role", "button");

  // Custom tooltip
  const tooltipEl = document.createElement("span");
  tooltipEl.className = "custom-tooltip";
  tooltipEl.textContent = tooltip;
  btn.appendChild(tooltipEl);

  // SVG icons
  const icons = {
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>',
    restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  };

  btn.innerHTML += icons[icon] || icons.play;

  if (isDelete) {
    btn.classList.add("danger-icon");
    return btn;
  }

  // For non-delete buttons, use htmx
  const path = action === "delete" ? `/bots/${botId}` : `/bots/${botId}/${action}`;
  const method = action === "delete" ? "delete" : "post";
  const hxAttr = method === "delete" ? "hx-delete" : "hx-post";

  btn.setAttribute(hxAttr, path);
  btn.setAttribute("hx-swap", "none");

  return btn;
}

function actionButton(action, id, variant, label, pathOverride, methodOverride, targetOverride, skipRefresh, suppressRender) {
  const btn = document.createElement("button");
  btn.dataset.action = label || action;
  if (skipRefresh) {
    btn.dataset.skipRefresh = "true";
  }
  if (suppressRender) {
    btn.dataset.suppressRender = "true";
  }
  if (action === "webhook-info") {
    btn.dataset.suppressSuccessToast = "true";
  }
  if (variant === "secondary") btn.className = "secondary";
  if (variant === "danger") btn.className = "danger";
  const path = pathOverride ?? (action === "delete" ? `/bots/${id}` : `/bots/${id}/${action}`);
  const method = methodOverride ?? (action === "delete" ? "delete" : "post");
  const hxAttr = method === "delete" ? "hx-delete" : method === "get" ? "hx-get" : "hx-post";
  btn.setAttribute(hxAttr, path);
  if (targetOverride) {
    btn.setAttribute("hx-target", targetOverride);
    btn.setAttribute("hx-swap", "innerText");
  } else {
    btn.setAttribute("hx-swap", "none");
  }
  if (targetOverride) {
    btn.setAttribute("hx-target", targetOverride);
  }
  // Auth headers are now added globally via htmx:configRequest
  const text = label || action;
  btn.textContent = text.charAt(0).toUpperCase() + text.slice(1);
  return btn;
}

let updateBotId = null;
let updateStatus = null;

async function fetchReleaseNotes(repoUrl, version) {
  try {
    // Parse GitHub URL
    const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/);
    if (!match) return null;

    const owner = match[1];
    const repo = match[2];

    // Fetch release info from GitHub API
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${version}`;
    const response = await fetch(apiUrl);

    if (!response.ok) return null;

    const release = await response.json();

    // Format release notes as markdown
    let notes = release.body || 'No release notes provided.';

    // Convert markdown to HTML (simple conversion)
    notes = notes
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h3>$1</h3>')
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Wrap list items
    notes = notes.replace(/(<li>.*<\/li>\s*)+/gs, '<ul>$&</ul>');

    return notes;
  } catch (err) {
    console.error('Failed to fetch release notes:', err);
    return null;
  }
}

async function openUpdateModal(botId) {
  updateBotId = botId;

  // Check update status
  try {
    const res = await authFetch(`/bots/${botId}/update/status`);
    updateStatus = await res.json();

    const modal = document.getElementById("updateModal");
    const statusEl = document.getElementById("updateStatus");
    const zipSourceInput = document.getElementById("updateZipSource");
    const updateBtn = document.getElementById("updateBtn");

    // Show status info
    let statusHTML = `<strong>Source Type:</strong> ${updateStatus.sourceType}<br>`;

    if (updateStatus.sourceType === "git") {
      statusHTML += `<strong>Repository:</strong> ${updateStatus.repo || "—"}<br>`;

      if (updateStatus.currentVersion) {
        statusHTML += `<strong>Current Version:</strong> ${updateStatus.currentVersion}<br>`;
      }

      if (updateStatus.latestVersion) {
        statusHTML += `<strong>Latest Version:</strong> ${updateStatus.latestVersion}<br>`;
      }

      if (updateStatus.updateType === "release") {
        statusHTML += `<strong>Update Type:</strong> 📦 Release<br>`;
      } else {
        statusHTML += `<strong>Update Type:</strong> ⚠️ Branch (no releases)<br>`;
      }

      if (updateStatus.warning) {
        statusHTML += `<div class="warning-box">⚠️ ${updateStatus.warning}</div>`;
      }

      if (updateStatus.updateAvailable) {
        statusHTML += `<div class="success-box">✅ Update available</div>`;
      } else {
        statusHTML += `<div class="info-box">✓ Up to date</div>`;
      }

      // Show release notes for updates
      if (updateStatus.updateAvailable && updateStatus.updateType === "release") {
        statusHTML += `<div id="releaseNotes" class="release-notes-loading">Loading release notes...</div>`;

        // Fetch release notes
        fetchReleaseNotes(updateStatus.repo, updateStatus.latestVersion).then(notes => {
          const notesEl = document.getElementById("releaseNotes");
          if (notesEl) {
            if (notes) {
              notesEl.className = "release-notes";
              notesEl.innerHTML = `<strong>📝 Release Notes:</strong><div class="release-notes-content">${notes}</div>`;
            } else {
              notesEl.style.display = "none";
            }
          }
        }).catch(() => {
          const notesEl = document.getElementById("releaseNotes");
          if (notesEl) notesEl.style.display = "none";
        });
      } else if (updateStatus.updateAvailable && updateStatus.updateType === "branch") {
        statusHTML += `<div class="info-box">ℹ️ Updating from branch - no release notes available</div>`;
      }

      zipSourceInput.style.display = "none";
    } else if (updateStatus.sourceType === "zip") {
      statusHTML += `<strong>Current Path:</strong> ${updateStatus.sourcePath || "—"}<br>`;
      statusHTML += `<div class="info-box">${updateStatus.message}</div>`;
      zipSourceInput.style.display = "block";
    } else if (updateStatus.sourceType === "local") {
      statusHTML += `<strong>Source Path:</strong> ${updateStatus.sourcePath || "—"}<br>`;
      statusHTML += `<div class="info-box">${updateStatus.message}</div>`;
      zipSourceInput.style.display = "none";
    }

    statusEl.innerHTML = statusHTML;
    updateBtn.disabled = false;

    modal.classList.remove("hidden");
  } catch (err) {
    showToast("Failed to check update status");
    console.error(err);
  }
}

function closeUpdateModal() {
  document.getElementById("updateModal").classList.add("hidden");
  document.getElementById("updateResult").textContent = "";
  document.getElementById("updateZipSourceValue").value = "";
  updateBotId = null;
  updateStatus = null;
}

async function performUpdate() {
  if (!updateBotId) return;

  const btn = document.getElementById("updateBtn");
  const resultEl = document.getElementById("updateResult");
  btn.disabled = true;
  resultEl.textContent = "Updating...\n";

  try {
    const payload = {};

    // For ZIP updates, include new source
    if (updateStatus.sourceType === "zip") {
      const newSource = document.getElementById("updateZipSourceValue").value.trim();
      if (!newSource) {
        showToast("Please provide new ZIP source path");
        btn.disabled = false;
        return;
      }
      payload.source = newSource;
    }

    const res = await authFetch(`/bots/${updateBotId}/update?stream=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let hadError = false;
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const text = chunk.endsWith("\n") ? chunk : `${chunk}\n`;
        resultEl.textContent += text;
        resultEl.scrollTop = resultEl.scrollHeight;
        if (chunk.toLowerCase().includes("error")) hadError = true;
      }
    } else {
      const text = await res.text();
      resultEl.textContent = text.endsWith("\n") ? text : `${text}\n`;
      if (!res.ok) hadError = true;
    }

    if (!res.ok || hadError) {
      showToast("Update failed");
    } else {
      showToast("Bot updated successfully");
      await loadBots();
      setTimeout(() => closeUpdateModal(), 2000);
    }
  } catch (err) {
    resultEl.textContent += `\nERROR: ${err}`;
    showToast("Update failed");
  } finally {
    btn.disabled = false;
  }
}

let deleteBotId = null;
let deleteBotCode = null;

function toggleBotCard(botId) {
  const content = document.getElementById(`bot-content-${botId}`);
  const card = document.getElementById(`bot-card-${botId}`);
  const expandBtn = card.querySelector('.expand-btn');
  const tooltip = expandBtn?.querySelector('.custom-tooltip');

  if (!content) return;

  const isExpanded = content.classList.contains('expanded');

  if (isExpanded) {
    // Collapse
    content.classList.remove('expanded');
    expandBtn.classList.remove('expanded');
    expandBtn.setAttribute('aria-expanded', 'false');
    if (tooltip) tooltip.textContent = 'Show details';
  } else {
    // Expand
    content.classList.add('expanded');
    expandBtn.classList.add('expanded');
    expandBtn.setAttribute('aria-expanded', 'true');
    if (tooltip) tooltip.textContent = 'Hide details';
  }
}

function confirmDeleteBot(botId, botCode) {
  deleteBotId = botId;
  deleteBotCode = botCode;

  const modal = document.getElementById("deleteModal");
  const confirmInput = document.getElementById("deleteConfirmInput");
  const botCodeDisplay = document.getElementById("deleteBotCode");

  botCodeDisplay.textContent = botCode;
  confirmInput.value = "";

  modal.classList.remove("hidden");
}

function closeDeleteModal() {
  document.getElementById("deleteModal").classList.add("hidden");
  deleteBotId = null;
  deleteBotCode = null;
}

async function performDelete() {
  const confirmInput = document.getElementById("deleteConfirmInput");
  const confirmValue = confirmInput.value.trim();

  if (confirmValue !== deleteBotCode) {
    showToast("Code mismatch. Please type the correct bot code.");
    return;
  }

  if (!deleteBotId) return;

  try {
    const res = await authFetch(`/bots/${deleteBotId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      showToast("Delete failed");
      return;
    }

    showToast("Bot deleted");
    closeDeleteModal();
    await loadBots();
  } catch (err) {
    showToast("Delete failed");
    console.error(err);
  }
}

// Initial load
loadBots();

// Auto-refresh interval (15 seconds instead of 8)
const AUTO_REFRESH_INTERVAL = 15000;
setInterval(loadBots, AUTO_REFRESH_INTERVAL);

let selectedFile = null;

document.body.addEventListener("htmx:afterRequest", (evt) => {
  handleHtmxEvent(evt.detail, evt.detail?.elt);
});

// Inject auth headers into all htmx requests
document.body.addEventListener("htmx:configRequest", (evt) => {
  const authHeaders = getAuthHeaders();
  if (authHeaders.Authorization) {
    evt.detail.headers["Authorization"] = authHeaders.Authorization;
  }
});

function updateSourcePlaceholder(event) {
  const type = event.target.value;
  const sourceInput = document.getElementById("source");
  const fileInput = document.getElementById("sourceFile");
  selectedFile = null;
  fileInput.value = "";
  if (type === "git") {
    sourceInput.placeholder = "https://github.com/user/repo.git";
    sourceInput.classList.remove("hidden");
    fileInput.classList.add("hidden");
  } else if (type === "zip") {
    sourceInput.classList.add("hidden");
    fileInput.classList.remove("hidden");
  } else {
    sourceInput.placeholder = "./path/to/bot";
    sourceInput.classList.remove("hidden");
    fileInput.classList.add("hidden");
  }
}

function handleFile(event) {
  selectedFile = event.target.files?.[0] || null;
}

async function buildFormData(payload) {
  const form = new FormData();
  form.append("name", payload.name);
  form.append("runtime", payload.runtime);
  form.append("sourceType", payload.sourceType);
  form.append("botToken", payload.botToken);
  form.append("file", payload.source);
  return form;
}
