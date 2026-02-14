const apiBase = "";
let isLoading = false;

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
  }
}

async function createBot() {
  if (isLoading) return;
  isLoading = true;
  const btn = document.getElementById("createBtn");
  btn.disabled = true;
  const payload = {
    name: document.getElementById("name").value,
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
  (bot.envs || [])
    .filter((e) => e.key !== "BOT_TOKEN")
    .forEach((env) => container.appendChild(buildEnvRow(env.key, env.value)));
  if (!container.children.length) {
    container.appendChild(buildEnvRow("", ""));
  }
  document.getElementById("envResult").textContent = "";
  document.getElementById("envModal").classList.remove("hidden");
}

function closeEnvModal() {
  document.getElementById("envModal").classList.add("hidden");
  envEditBotId = null;
}

function buildEnvRow(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "env-modal-row env-row";
  row.innerHTML = `
    <div>
      <label>Key</label>
      <input class="env-key" placeholder="MY_ENV" value="${key}" />
    </div>
    <div>
      <label>Value</label>
      <input class="env-value" placeholder="value" value="${value}" />
    </div>
  `;
  return row;
}

function addEnvRowEdit() {
  const container = document.getElementById("envRowsEdit");
  container.appendChild(buildEnvRow("", ""));
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
  const stickyData = Array.from(container.querySelectorAll(".bot-card[data-sticky='true']")).map((el) => {
    const id = el.id.replace("bot-card-", "");
    const logEl = el.querySelector(`#log-${id}`);
    const webhookEl = el.querySelector(`#webhook-${id}`);
    return {
      id,
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
    const sticky = stickyData.find((s) => s.id === bot.id);
    if (sticky) {
      card.dataset.sticky = "true";
      const log = card.querySelector(`#log-${bot.id}`);
      const webhook = card.querySelector(`#webhook-${bot.id}`);
      if (log) {
        log.style.display = sticky.logVisible ? "block" : "none";
        if (sticky.logText) log.textContent = sticky.logText;
      }
      if (webhook) {
        webhook.style.display = sticky.webhookVisible ? "block" : "none";
        if (sticky.webhookText) webhook.textContent = sticky.webhookText;
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
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.gap = "8px";

  const title = document.createElement("h3");
  title.textContent = bot.name || "unnamed";
  const status = document.createElement("span");
  status.className = `status ${bot.status}`;
  status.textContent = bot.status;
  header.appendChild(title);
  header.appendChild(status);
  card.appendChild(header);

  const meta = (text) => {
    const div = document.createElement("div");
    div.className = "meta";
    div.innerHTML = text;
    return div;
  };
  const created = bot.createdAt ? new Date(bot.createdAt).toLocaleString() : "—";
  card.appendChild(meta(`id: ${bot.id}`));
  card.appendChild(meta(`runtime: ${bot.runtime}`));
  const versionText = bot.latestRuntimeVersion
    ? `${bot.runtimeVersion || "unknown"} (latest ${bot.latestRuntimeVersion})`
    : bot.runtimeVersion || "unknown";
  card.appendChild(meta(`runtime version: ${versionText}`));
  card.appendChild(
    meta(
      `webhook: <a class="inline-link" href="${bot.webhookUrl || "#"}" target="_blank">${bot.webhookUrl || "not set"}</a>`
    )
  );
  card.appendChild(meta(`image: ${bot.imageName}`));
  card.appendChild(meta(`created: ${created}`));
  const envSummary = (bot.envs || [])
    .filter((e) => e.key !== "BOT_TOKEN")
    .map((e) => `${e.key}=${e.value}`)
    .join(", ");
  card.appendChild(meta(`env: ${envSummary || "—"}`));

  const actions = document.createElement("div");
  actions.className = "actions grid";
  if (bot.status !== "running") {
    actions.appendChild(actionButton("start", bot.id, "primary"));
  }
  if (bot.status === "running") {
    actions.appendChild(actionButton("stop", bot.id, "secondary"));
  }
  actions.appendChild(actionButton("restart", bot.id, "secondary"));
  if (bot.runtimeOutdated) {
    actions.appendChild(
      actionButton("upgrade-runtime", bot.id, "primary", "Upgrade runtime", `/bots/${bot.id}/upgrade-runtime`)
    );
  }
  if (bot.gitStatus?.updateAvailable) {
    actions.appendChild(
      actionButton(
        "git-upgrade",
        bot.id,
        "primary",
        "Deploy latest commit",
        `/bots/${bot.id}/git/upgrade`,
        "post",
        undefined,
        false
      )
    );
  }
  const envBtn = document.createElement("button");
  envBtn.className = "secondary";
  envBtn.textContent = "Edit env";
  envBtn.onclick = () => openEnvModal(bot);
  actions.appendChild(envBtn);
  actions.appendChild(actionButton("delete", bot.id, "danger"));
  const logsBtn = document.createElement("button");
  logsBtn.className = "secondary";
  logsBtn.textContent = "Logs";
  logsBtn.setAttribute("hx-on:click", `loadLogs('${bot.id}')`);
  actions.appendChild(logsBtn);
  card.appendChild(actions);

  const logPanel = document.createElement("div");
  logPanel.className = "log-panel";
  const logPre = document.createElement("pre");
  logPre.id = `log-${bot.id}`;
  logPre.style.display = "none";
  logPanel.appendChild(logPre);
  card.appendChild(logPanel);

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

  card.appendChild(webhookActions);
  card.appendChild(webhookInfo);

  return card;
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

loadBots();
setInterval(loadBots, 8000);

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
