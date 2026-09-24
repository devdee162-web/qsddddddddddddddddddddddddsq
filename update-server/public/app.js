const API = "";

const PAGE_TITLES = {
  dashboard: { title: "Gestionnaire de mises à jour", sub: "Gardez votre application à jour et sécurisée" },
  updates: { title: "Mises à jour", sub: "Gérez toutes vos releases Zcord" },
  create: { title: "Créer une MAJ", sub: "Nouvelle version à publier" },
  history: { title: "Historique", sub: "Publications et installations" },
  sources: { title: "Sources", sub: "Origines des mises à jour" },
  planning: { title: "Planification", sub: "Vérifications et maintenance" },
  settings: { title: "Paramètres", sub: "Configuration GitHub et système" },
  logs: { title: "Logs", sub: "Journal d'activité du serveur" },
  stats: { title: "Statistiques", sub: "Vue d'ensemble des performances" },
  help: { title: "Aide & Support", sub: "Documentation et assistance" }
};

function toast(msg, ok = true) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast";
  el.style.borderColor = ok ? "var(--green)" : "var(--red)";
  setTimeout(() => el.classList.add("hidden"), 4000);
}

async function desktopApi(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const panel = window.zcordPanel;

  if (path === "/api/stats") return panel.invoke("stats");
  if (path === "/api/updates" && method === "GET") return panel.invoke("updates-list");
  if (path === "/api/updates" && method === "POST") return panel.invoke("updates-create", opts.body);
  if (path === "/api/history") return panel.invoke("history");
  if (path === "/api/logs") return panel.invoke("logs");
  if (path === "/api/reports") return panel.invoke("reports");
  if (path === "/api/settings" && method === "GET") return panel.invoke("settings-get");
  if (path === "/api/settings" && method === "PUT") return panel.invoke("settings-save", opts.body);

  const pub = path.match(/^\/api\/updates\/([^/]+)\/publish$/);
  if (pub && method === "POST") return panel.invoke("updates-publish", pub[1]);

  const unpub = path.match(/^\/api\/updates\/([^/]+)\/unpublish$/);
  if (unpub && method === "POST") return panel.invoke("updates-unpublish", unpub[1]);

  throw new Error(`Route non supportée: ${path}`);
}

async function api(path, opts = {}) {
  if (window.zcordPanel?.isDesktop) return desktopApi(path, opts);

  const r = await fetch(API + path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {},
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

function fmtSize(n) {
  if (!n) return "—";
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR");
}

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h}h`;
  return fmtDate(iso);
}

function priorityLabel(type) {
  if (type === "major") return { cls: "high", text: "Haute" };
  if (type === "patch") return { cls: "low", text: "Basse" };
  return { cls: "medium", text: "Moyenne" };
}

function setHealthRing(pct) {
  const ring = document.getElementById("health-ring");
  if (!ring) return;
  const circ = 2 * Math.PI * 34;
  ring.setAttribute("stroke-dasharray", circ);
  ring.setAttribute("stroke-dashoffset", circ * (1 - pct / 100));
  document.getElementById("kpi-health").textContent = `${pct}%`;
}

function setDonut(installed, pending, failed) {
  const total = installed + pending + failed || 1;
  const circ = 2 * Math.PI * 48;
  const pct = total === 1 && installed === 0 && pending === 0 && failed === 0
    ? 100
    : Math.round((installed / total) * 100);

  const sArc = total === 1 && installed === 0 && pending === 0 && failed === 0
    ? circ
    : (installed / total) * circ;
  const pArc = (pending / total) * circ;
  const fArc = (failed / total) * circ;

  const donutS = document.getElementById("donut-success");
  const donutP = document.getElementById("donut-pending");
  const donutF = document.getElementById("donut-failed");

  donutS.setAttribute("stroke-dasharray", `${sArc} ${circ}`);
  donutS.setAttribute("stroke-dashoffset", "0");

  donutP.setAttribute("stroke-dasharray", `${pArc} ${circ}`);
  donutP.setAttribute("stroke-dashoffset", `-${sArc}`);

  donutF.setAttribute("stroke-dasharray", `${fArc} ${circ}`);
  donutF.setAttribute("stroke-dashoffset", `-${sArc + pArc}`);

  document.getElementById("donut-pct").textContent = `${pct}%`;
  document.getElementById("leg-installed").textContent = `${installed} installées`;
  document.getElementById("leg-pending").textContent = `${pending} en attente`;
  document.getElementById("leg-failed").textContent = `${failed} échec`;
}

function navigateTo(page) {
  document.querySelectorAll(".nav").forEach(n => {
    n.classList.toggle("active", n.dataset.page === page);
  });
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(`page-${page}`)?.classList.add("active");

  const meta = PAGE_TITLES[page] || PAGE_TITLES.dashboard;
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-sub").textContent = meta.sub;

  loadPage(page);
}

document.querySelectorAll(".nav, .btn-status, .btn.link[data-page]").forEach(btn => {
  btn.addEventListener("click", () => {
    const page = btn.dataset.page;
    if (page) navigateTo(page);
  });
});

document.getElementById("btn-refresh").addEventListener("click", () => {
  const active = document.querySelector(".nav.active")?.dataset.page || "dashboard";
  loadPage(active);
  toast("Actualisé");
});

async function loadStats() {
  const s = await api("/api/stats");
  document.getElementById("kpi-pending").textContent = s.availableUpdates;
  setHealthRing(s.systemHealth);
  document.getElementById("kpi-lastcheck").textContent = timeAgo(s.lastCheck);
  document.getElementById("kpi-lastcheck-date").textContent = fmtDate(s.lastCheck);
  document.getElementById("kpi-space").textContent = `${s.freedSpaceGb} GB`;
  document.getElementById("badge-updates").textContent = s.availableUpdates;

  setDonut(s.counts.installed || s.counts.success, s.counts.pending, s.counts.failed);

  const statSuccess = document.getElementById("stat-success");
  const statFailed = document.getElementById("stat-failed");
  const statPublished = document.getElementById("stat-published");
  const statDrafts = document.getElementById("stat-drafts");
  if (statSuccess) statSuccess.textContent = s.counts.success;
  if (statFailed) statFailed.textContent = s.counts.failed;
  if (statPublished) statPublished.textContent = s.published || "—";
  if (statDrafts) statDrafts.textContent = s.counts.pending;

  return s;
}

function getPrevVersion(releases, current) {
  const published = releases.find(r => r.status === "published");
  return published?.version || "—";
}

function renderDashTable(releases, publishedVersion) {
  const pending = releases.filter(r => r.status === "draft" || r.status === "scheduled");
  const tbody = document.getElementById("dash-updates-table");
  const btnAll = document.getElementById("btn-update-all");

  if (btnAll) {
    btnAll.disabled = pending.length === 0;
    btnAll.title = pending.length ? "Publier toutes les MAJ en brouillon" : "Aucun brouillon — crée une nouvelle MAJ";
  }

  if (!pending.length) {
    const pub = releases.find(r => r.status === "published");
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">
          <div class="empty-state">
            <strong>Système à jour</strong>
            ${pub ? `<span class="muted">Version publiée : ${pub.version} (${fmtSize(pub.fileSize)})</span>` : ""}
            <button class="btn primary sm" data-page="create">Créer une nouvelle MAJ</button>
          </div>
        </td>
      </tr>`;
    tbody.querySelector("[data-page]")?.addEventListener("click", () => navigateTo("create"));
    return;
  }

  tbody.innerHTML = pending.map(r => {
    const pri = priorityLabel(r.type);
    return `
      <tr>
        <td class="cell-name">${r.name}</td>
        <td>${publishedVersion}</td>
        <td>${r.version}</td>
        <td>${fmtSize(r.fileSize)}</td>
        <td><span class="priority ${pri.cls}">${pri.text}</span></td>
        <td>
          <button class="btn-update" data-pub="${r.id}">
            Mettre à jour
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-pub]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Build + upload GitHub ? (plusieurs minutes)")) return;
      toast("Publication en cours...", true);
      try {
        await api(`/api/updates/${b.dataset.pub}/publish`, { method: "POST" });
        toast("Publié sur GitHub !");
        loadDashboard();
      } catch (e) { toast(e.message, false); }
    };
  });
}

function renderTimeline(items, containerId, limit = 5) {
  const el = document.getElementById(containerId);
  const list = limit ? items.slice(0, limit) : items;

  if (!list.length) {
    el.innerHTML = `<div class="tl-meta" style="padding:12px">Aucun événement</div>`;
    return;
  }

  el.innerHTML = list.map(x => {
    const ok = x.result === "success";
    const icon = ok
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const label = x.action === "publish" ? `Publication ${x.version}` :
      x.action === "client_install" ? `Installation ${x.version}` : `${x.action} ${x.version}`;
    return `
      <div class="timeline-item">
        <div class="tl-icon ${ok ? "success" : "failed"}">${icon}</div>
        <div class="tl-body">
          <div class="tl-title">${label}</div>
          <div class="tl-meta">${fmtDateTime(x.at)} — ${x.result}</div>
        </div>
      </div>`;
  }).join("");
}

async function loadDashboard() {
  const s = await loadStats();
  const [releases, history, settings] = await Promise.all([
    api("/api/updates"),
    api("/api/history"),
    api("/api/settings")
  ]);

  const pubVer = releases.find(r => r.status === "published")?.version || s.published || "—";
  renderDashTable(releases, pubVer);
  renderTimeline(history, "dash-history", 4);

  document.getElementById("plan-maint").textContent =
    `${settings.maintenanceStart || "02:00"} - ${settings.maintenanceEnd || "05:00"}`;
  document.getElementById("plan-autocheck").checked = !!settings.autoCheck;
}

async function loadUpdates() {
  const releases = await api("/api/updates");
  document.getElementById("updates-table").innerHTML = releases.map(r => `
    <tr>
      <td class="cell-name">${r.name}</td>
      <td>${r.version}</td>
      <td>${r.type || "—"}</td>
      <td>${fmtSize(r.fileSize)}</td>
      <td><span class="tag ${r.status}">${r.status}</span></td>
      <td style="white-space:nowrap">
        ${r.status !== "published" ? `<button class="btn sm primary" data-pub="${r.id}">Publier</button>` : ""}
        ${r.status === "published" ? `<button class="btn sm" data-unpub="${r.id}">Dépublier</button>` : ""}
      </td>
    </tr>`).join("") || `<tr class="empty-row"><td colspan="6">Aucune release</td></tr>`;

  document.querySelectorAll("#updates-table [data-pub]").forEach(b => b.onclick = async () => {
    if (!confirm("Build + upload GitHub ? (plusieurs minutes)")) return;
    toast("Publication en cours...", true);
    try {
      await api(`/api/updates/${b.dataset.pub}/publish`, { method: "POST" });
      toast("Publié sur GitHub !");
      loadUpdates();
    } catch (e) { toast(e.message, false); }
  });

  document.querySelectorAll("[data-unpub]").forEach(b => b.onclick = async () => {
    await api(`/api/updates/${b.dataset.unpub}/unpublish`, { method: "POST" });
    loadUpdates();
  });
}

async function loadHistory() {
  const h = await api("/api/history");
  renderTimeline(h, "history-list", 0);
}

async function loadLogs() {
  const logs = await api("/api/logs");
  document.getElementById("logs-list").innerHTML = logs.map(l => `
    <div class="log-item">
      <span>[${l.level}] ${l.message}</span>
      <span class="muted">${fmtDateTime(l.at)}</span>
    </div>`).join("") || `<div class="log-item muted">Aucun log</div>`;
}

async function loadSettings() {
  const s = await api("/api/settings");
  document.getElementById("s-owner").value = s.githubOwner || "";
  document.getElementById("s-repo").value = s.githubRepo || "";
  document.getElementById("s-autocheck").checked = !!s.autoCheck;
  document.getElementById("s-maint-start").value = s.maintenanceStart || "02:00";
  document.getElementById("s-maint-end").value = s.maintenanceEnd || "05:00";

  const ghUrl = document.getElementById("source-github-url");
  if (ghUrl) ghUrl.textContent = `https://github.com/${s.githubOwner}/${s.githubRepo}/releases`;

  const pStart = document.getElementById("p-maint-start");
  const pEnd = document.getElementById("p-maint-end");
  const pAuto = document.getElementById("p-autocheck");
  if (pStart) pStart.value = s.maintenanceStart || "02:00";
  if (pEnd) pEnd.value = s.maintenanceEnd || "05:00";
  if (pAuto) pAuto.checked = !!s.autoCheck;
}

document.getElementById("btn-save-settings").onclick = async () => {
  await api("/api/settings", {
    method: "PUT",
    body: {
      githubOwner: document.getElementById("s-owner").value,
      githubRepo: document.getElementById("s-repo").value,
      autoCheck: document.getElementById("s-autocheck").checked,
      maintenanceStart: document.getElementById("s-maint-start").value,
      maintenanceEnd: document.getElementById("s-maint-end").value
    }
  });
  toast("Paramètres sauvegardés");
};

const btnSavePlanning = document.getElementById("btn-save-planning");
if (btnSavePlanning) {
  btnSavePlanning.onclick = async () => {
    await api("/api/settings", {
      method: "PUT",
      body: {
        autoCheck: document.getElementById("p-autocheck").checked,
        maintenanceStart: document.getElementById("p-maint-start").value,
        maintenanceEnd: document.getElementById("p-maint-end").value
      }
    });
    toast("Planification sauvegardée");
  };
}

document.getElementById("btn-update-all")?.addEventListener("click", async () => {
  const releases = await api("/api/updates");
  const pending = releases.filter(r => r.status === "draft" || r.status === "scheduled");
  if (!pending.length) {
    toast("Crée une MAJ d'abord (ex: v1.27.0) via « Créer une MAJ »", false);
    return;
  }
  if (!confirm(`Publier ${pending.length} mise(s) à jour ?`)) return;
  toast("Publication en cours...", true);
  try {
    for (const r of pending) {
      await api(`/api/updates/${r.id}/publish`, { method: "POST" });
    }
    toast("Toutes les MAJ publiées !");
    loadDashboard();
  } catch (e) { toast(e.message, false); }
});

async function uploadReleaseFile(relId) {
  if (window.zcordPanel?.isDesktop) {
    const filePath = await window.zcordPanel.pickFile();
    if (filePath) await window.zcordPanel.invoke("updates-upload", { id: relId, filePath });
    return;
  }
  const file = document.getElementById("f-file").files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  await fetch(`/api/updates/${relId}/upload`, { method: "POST", body: fd });
}

async function saveRelease(publish) {
  const rel = await api("/api/updates", {
    method: "POST",
    body: {
      name: document.getElementById("f-name").value || undefined,
      version: document.getElementById("f-version").value,
      type: document.getElementById("f-type").value,
      notes: document.getElementById("f-notes").value,
      autoCheck: document.getElementById("f-autocheck").checked,
      autoBackup: document.getElementById("f-backup").checked
    }
  });

  await uploadReleaseFile(rel.id);

  if (publish) {
    toast("Build + publish GitHub...", true);
    await api(`/api/updates/${rel.id}/publish`, { method: "POST" });
    toast("Publié !");
  } else {
    toast("Brouillon enregistré");
  }
  navigateTo("updates");
}

document.getElementById("btn-save-draft").onclick = () => saveRelease(false).catch(e => toast(e.message, false));
document.getElementById("btn-save-publish").onclick = () => {
  if (!document.getElementById("f-version").value) return toast("Version requise", false);
  if (!confirm("Lancer build + publish GitHub ?")) return;
  saveRelease(true).catch(e => toast(e.message, false));
};

function loadPage(page) {
  const map = {
    dashboard: loadDashboard,
    updates: loadUpdates,
    history: loadHistory,
    logs: loadLogs,
    settings: loadSettings,
    sources: loadSettings,
    planning: loadSettings,
    stats: loadStats,
    create: () => {},
    help: () => {}
  };
  (map[page] || loadDashboard)().catch(e => toast(e.message, false));
}

if (window.zcordPanel?.isDesktop) {
  document.title = "Zcord Update Manager";
}

loadPage("dashboard");
