
const TOKEN_KEY = "moneysync_token";
const USER_KEY = "moneysync_user";
const today = new Date().toISOString().slice(0, 10);

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function currentUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY));
  } catch (_) {
    return null;
  }
}

function setSession(token, user) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

async function api(path, method = "GET", body) {
  const headers = {};
  const token = getToken();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch("/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const error = new Error(result.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function showAuthScreen() {
  document.getElementById("authScreen").classList.remove("hidden");
  document.getElementById("appRoot").classList.add("hidden");
  document.getElementById("pinModal").classList.add("hidden");
}

async function showApp() {
  const user = currentUser();
  if (!user || !getToken()) {
    clearSession();
    showAuthScreen();
    return;
  }

  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("hidden");

  const firstName = user.name.trim().split(" ")[0];

  document.getElementById("userChip").textContent =
    user.name + (user.role === "admin" ? " · Admin" : "");

  document.getElementById("welcomeNameTop").textContent = firstName || "there";
  document.getElementById("settingsEmail").textContent = user.email;

  document.body.classList.toggle(
    "light-mode",
    localStorage.getItem("moneysync_theme") === "light"
  );

  try {
    await loadData();
    renderAll();
    const pin = await api("/account/pin");
    if (window.refreshAdminUI) await window.refreshAdminUI();
    openPinModal(pin.configured ? "unlock" : "setup");
  } catch (error) {
    if (error.status === 401) {
      clearSession();
      showAuthScreen();
      return;
    }
    alert("Cannot load MoneySync data: " + error.message);
  }
}

function switchAuthTab(tab) {
  const isLogin = tab === "login";

  document.getElementById("tabLogin").classList.toggle("active", isLogin);
  document.getElementById("tabSignup").classList.toggle("active", !isLogin);
  document.getElementById("loginForm").classList.toggle("hidden", !isLogin);
  document.getElementById("signupForm").classList.toggle("hidden", isLogin);
  document.getElementById("loginError").textContent = "";
  document.getElementById("signupError").textContent = "";
}

document.getElementById("tabLogin").addEventListener("click", () => switchAuthTab("login"));
document.getElementById("tabSignup").addEventListener("click", () => switchAuthTab("signup"));

document.getElementById("signupForm").addEventListener("submit", async e => {
  e.preventDefault();

  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim().toLowerCase();
  const pw = document.getElementById("signupPassword").value;
  const pw2 = document.getElementById("signupPasswordConfirm").value;
  const errEl = document.getElementById("signupError");

  if (pw.length < 8) {
    errEl.textContent = "Password must be at least 8 characters.";
    return;
  }

  if (pw !== pw2) {
    errEl.textContent = "Passwords do not match.";
    return;
  }

  try {
    await api("/register", "POST", { name, email, password: pw });
    const result = await api("/login", "POST", { email, password: pw });
    setSession(result.token, result.user);
    e.target.reset();
    await showApp();
  } catch (error) {
    errEl.textContent = error.message;
  }
});

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const pw = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  try {
    const result = await api("/login", "POST", { email, password: pw });
    setSession(result.token, result.user);
    e.target.reset();
    await showApp();
  } catch (error) {
    errEl.textContent = error.message;
  }
});

/* ---------- Separate PIN setup, unlock, and recovery dialogs ---------- */

function openPinModal(mode) {
  const modal = document.getElementById("pinModal");
  modal.classList.remove("hidden");

  document.querySelectorAll(".pin-panel").forEach(panel => panel.classList.add("hidden"));

  const panelId = mode === "setup"
    ? "pinSetupPanel"
    : mode === "reset"
      ? "pinResetPanel"
      : "pinUnlockPanel";

  document.getElementById(panelId).classList.remove("hidden");
  document.getElementById("pinSetupError").textContent = "";
  document.getElementById("pinUnlockError").textContent = "";
  document.getElementById("pinResetError").textContent = "";

  if (mode === "setup") document.getElementById("pinSetupForm").reset();
  if (mode === "unlock") document.getElementById("pinUnlockForm").reset();
  if (mode === "reset") document.getElementById("pinResetForm").reset();

  const first = document.querySelector("#" + panelId + " input");
  if (first) first.focus();
}

function closePinModal() {
  document.getElementById("pinModal").classList.add("hidden");
}

document.getElementById("pinSetupForm").addEventListener("submit", async e => {
  e.preventDefault();

  const pin = document.getElementById("newPin").value;
  const confirmPin = document.getElementById("newPinConfirm").value;
  const error = document.getElementById("pinSetupError");

  if (!/^\d{4}$/.test(pin)) {
    error.textContent = "PIN must contain exactly 4 digits.";
    return;
  }

  if (pin !== confirmPin) {
    error.textContent = "PINs do not match.";
    return;
  }

  try {
    await api("/account/pin", "PUT", { pin });
    closePinModal();
  } catch (err) {
    error.textContent = err.message;
  }
});

document.getElementById("pinUnlockForm").addEventListener("submit", async e => {
  e.preventDefault();

  const pin = document.getElementById("unlockPin").value;
  const user = currentUser();
  const error = document.getElementById("pinUnlockError");

  if (!user || !getToken()) {
    closePinModal();
    showAuthScreen();
    return;
  }

  try {
    await api("/account/pin/verify", "POST", { pin });
    closePinModal();
  } catch (err) {
    error.textContent = err.message;
  }
});

document.getElementById("forgotPinBtn").addEventListener("click", () => openPinModal("reset"));
document.getElementById("backToUnlockBtn").addEventListener("click", () => openPinModal("unlock"));

document.getElementById("pinResetForm").addEventListener("submit", async e => {
  e.preventDefault();

  const password = document.getElementById("resetAccountPassword").value;
  const pin = document.getElementById("resetNewPin").value;
  const confirmPin = document.getElementById("resetNewPinConfirm").value;
  const error = document.getElementById("pinResetError");
  const user = currentUser();

  if (!user) {
    error.textContent = "Your session expired. Please log in again.";
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    error.textContent = "New PIN must contain exactly 4 digits.";
    return;
  }

  if (pin !== confirmPin) {
    error.textContent = "New PINs do not match.";
    return;
  }

  try {
    await api("/account/pin", "PUT", { pin, currentPassword: password });
    closePinModal();
  } catch (err) {
    error.textContent = err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  clearSession();
  document.getElementById("loginForm").reset();
  document.getElementById("signupForm").reset();
  switchAuthTab("login");
  showAuthScreen();
});

/* ---------- App data (scoped per logged-in user) ---------- */

let data = { transactions: [], bills: [], budget: 0, savingsGoals: [], audit: [] };

async function loadData() {
  const [transactions, bills, budget, savingsGoals, audit] = await Promise.all([
    api("/transactions"),
    api("/bills"),
    api("/budget"),
    api("/savings-goals"),
    api("/audit")
  ]);
  data = {
    transactions,
    bills,
    budget: budget.amount,
    savingsGoals,
    audit: audit.map(entry => ({ action: entry.action, date: entry.created_at }))
  };
}

async function refresh() {
  await loadData();
  renderAll();
}

function peso(n) {
  return "₱" + Number(n).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function sum(type) {
  return data.transactions
    .filter(t => t.type === type)
    .reduce((a, t) => a + Number(t.amount), 0);
}

function renderDashboard() {
  const income = sum("income");
  const expenses = sum("expense");
  const upcoming = data.bills
    .filter(b => !b.paid)
    .reduce((a, b) => a + Number(b.amount), 0);

  document.getElementById("balance").textContent = peso(income - expenses);
  document.getElementById("income").textContent = peso(income);
  document.getElementById("expenses").textContent = peso(expenses);
  document.getElementById("upcoming").textContent = peso(upcoming);

  const recent = data.transactions.slice(0, 5);

  document.getElementById("recentTransactions").innerHTML = recent.length
    ? recent.map(t => `
      <div class="row"><span>${escapeHTML(t.name)}<small> · ${escapeHTML(t.category)}</small></span>
      <b class="${t.type}-text">${t.type === "income" ? "+" : "-"}${peso(t.amount)}</b></div>
    `).join("")
    : '<div class="empty">No transactions yet.</div>';

  const notes = [];

  data.bills.filter(b => !b.paid).forEach(b => {
    const days = Math.ceil((new Date(b.due) - new Date()) / 86400000);
    notes.push(`${escapeHTML(b.name)} — ${peso(b.amount)} due ${days < 0 ? "overdue" : days === 0 ? "today" : "in " + days + " day(s)"}.`);
  });

  if (data.budget) {
    const used = sum("expense");
    const pct = Math.round(used / data.budget * 100);

    if (pct >= 80) {
      notes.push(`Budget alert: ${pct}% of your monthly budget has been used.`);
    }
  }

  // Notification rendering: keep the existing dashboard notifications
  // and also populate the popup list if it exists in index.html.
  const notificationHTML = notes.length
    ? notes.map(n => `<div class="row"><i class="dot"></i><span>${n}</span></div>`).join("")
    : '<div class="empty">No new notifications.</div>';

  const notifications = document.getElementById("notifications");
  const notificationPanelList = document.getElementById("notificationPanelList");

  if (notifications) {
    notifications.innerHTML = notificationHTML;
  }

  if (notificationPanelList) {
    notificationPanelList.innerHTML = notificationHTML;
  }

  updateNotifBadge(notes.length);
}

function updateNotifBadge(count) {
  const badge = document.getElementById("notifBadge");
  if (!badge) return;

  badge.textContent = count > 9 ? "9+" : count;
  badge.classList.toggle("hidden", count === 0);
}

function renderTransactions() {
  document.getElementById("transactionList").innerHTML = data.transactions.length
    ? data.transactions.map(t => `
      <div class="row">
        <span><b>${escapeHTML(t.name)}</b><br><small>${escapeHTML(t.category)} · ${escapeHTML(t.method)} · ${escapeHTML(t.date)}</small></span>
        <span><b class="${t.type}-text">${t.type === "income" ? "+" : "-"}${peso(t.amount)}</b>
        <button class="action danger" onclick="deleteTransaction(${t.id})">Delete</button></span>
      </div>
    `).join("")
    : '<div class="empty">No transactions yet.</div>';
}

async function deleteTransaction(id) {
  try {
    await api("/transactions/" + id, "DELETE");
    await refresh();
  } catch (error) {
    alert(error.message);
  }
}

function renderBills() {
  document.getElementById("billList").innerHTML = data.bills.length
    ? data.bills.map(b => `
      <div class="row">
        <span><b>${escapeHTML(b.name)}</b><br><small>${peso(b.amount)} · Due ${escapeHTML(b.due)} · ${escapeHTML(b.frequency)}</small></span>
        <span><span class="pill">${b.paid ? "PAID" : "PENDING"}</span>
        ${!b.paid ? `<button class="action" onclick="payBill(${b.id})">Mark Paid</button>` : ""}</span>
      </div>
    `).join("")
    : '<div class="empty">No bills yet.</div>';
}

async function payBill(id) {
  try {
    await api("/bills/" + id + "/pay", "PATCH", { method: "GCash" });
    await refresh();
  } catch (error) {
    alert(error.message);
  }
}

function renderBudget() {
  const used = sum("expense");
  const budget = Number(data.budget) || 0;
  const pct = budget ? Math.min(100, used / budget * 100) : 0;

  document.getElementById("budgetProgress").style.width = pct + "%";

  const C = 534.07;
  document.getElementById("gaugeArc").style.strokeDashoffset = C * (1 - pct / 100);
  document.getElementById("gaugePct").textContent = Math.round(pct) + "%";
  document.getElementById("gaugeText").textContent = budget
    ? peso(used) + " of " + peso(budget)
    : "No budget set";

  document.getElementById("budgetText").textContent = budget
    ? `${peso(used)} used out of ${peso(budget)} (${Math.round(pct)}%)`
    : "No budget set.";
}

function renderSavingsGoals() {
  const dashboardList = document.getElementById("dashboardSavingsGoals");

  if (dashboardList) {
    if (!data.savingsGoals.length) {
      dashboardList.innerHTML = '<div class="dashboard-goal-empty"><div class="dashboard-goal-icon">✦</div><div class="dashboard-goal-info"><strong>New Phone</strong><span>Start saving for something you want</span></div><button type="button" class="action" onclick="goTo(&quot;savings&quot;)">Create goal</button></div>';
    } else {
      dashboardList.innerHTML = data.savingsGoals.slice(0, 2).map(g => {
        const saved = Math.max(0, Number(g.saved) || 0);
        const target = Math.max(1, Number(g.target) || 1);
        const pct = Math.min(100, Math.round(saved / target * 100));

        return `<div class="dashboard-goal-item"><div class="dashboard-goal-top"><strong>${escapeHTML(g.name)}</strong><span>${pct}%</span></div><div class="progress goal-progress"><div style="width:${pct}%"></div></div><div class="dashboard-goal-amounts"><span>${peso(saved)} saved</span><span>of ${peso(target)}</span></div></div>`;
      }).join("");
    }
  }

  const list = document.getElementById("savingsGoalList");
  if (!list) return;

  if (!data.savingsGoals.length) {
    list.innerHTML = '<div class="empty">No savings goals yet. Create one above to get started.</div>';
    return;
  }

  list.innerHTML = data.savingsGoals.map(g => {
    const saved = Math.max(0, Number(g.saved) || 0);
    const target = Math.max(1, Number(g.target) || 1);
    const pct = Math.min(100, Math.round(saved / target * 100));
    const remaining = Math.max(0, target - saved);

    return `<div class="goal-card">
      <div class="goal-top"><div><h3>${escapeHTML(g.name)}</h3><small>${g.date ? "Target date: " + g.date : "No target date set"}</small></div><span class="pill ${pct >= 100 ? "paid" : ""}">${pct >= 100 ? "GOAL REACHED" : pct + "% SAVED"}</span></div>
      <div class="goal-amounts"><b>${peso(saved)}</b><span>of ${peso(target)}</span></div>
      <div class="progress goal-progress"><div style="width:${pct}%"></div></div>
      <p class="goal-remaining">${pct >= 100 ? "Congratulations! You reached your goal." : peso(remaining) + " left to reach your goal."}</p>
      <form class="goal-contribute" onsubmit="addGoalSavings(event,${g.id})"><input type="number" min="0.01" step="0.01" placeholder="Amount to add (₱)" aria-label="Amount to add to ${escapeHTML(g.name)}" required><button class="action" type="submit">Add Savings</button><button class="action danger" type="button" onclick="deleteSavingsGoal(${g.id})">Delete</button></form>
    </div>`;
  }).join("");
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

async function addGoalSavings(event, id) {
  event.preventDefault();

  const goal = data.savingsGoals.find(g => g.id === id);
  if (!goal) return;

  const input = event.target.querySelector('input[type="number"]');
  const amount = Number(input.value);

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Enter a savings amount greater than zero.");
    return;
  }

  try {
    await api("/savings-goals/" + id + "/contributions", "POST", { amount });
    await refresh();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteSavingsGoal(id) {
  const goal = data.savingsGoals.find(g => g.id === id);
  if (!goal) return;

  if (!confirm('Delete the savings goal "' + goal.name + '"?')) return;

  try {
    await api("/savings-goals/" + id, "DELETE");
    await refresh();
  } catch (error) {
    alert(error.message);
  }
}

function renderReport() {
  const income = sum("income");
  const expenses = sum("expense");
  const cats = {};

  data.transactions.filter(t => t.type === "expense").forEach(t => {
    cats[t.category] = (cats[t.category] || 0) + Number(t.amount);
  });

  const months = {};

  data.transactions.filter(t => t.type === "expense").forEach(t => {
    const key = (t.date || today).slice(0, 7);
    months[key] = (months[key] || 0) + Number(t.amount);
  });

  const monthEntries = Object.entries(months)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6);

  const maxCat = Math.max(1, ...Object.values(cats));
  const maxMonth = Math.max(1, ...monthEntries.map(x => x[1]));
  const maxCompare = Math.max(1, income, expenses);

  const bar = (label, value, max, kind = "") => `<div class="chart-bar-row"><div class="chart-bar-label"><span>${escapeHTML(label)}</span><b>${peso(value)}</b></div><div class="chart-track"><div class="chart-fill ${kind}" style="width:${Math.max(2, value / max * 100)}%"></div></div></div>`;

  document.getElementById("report").innerHTML = `
    <div class="report-summary"><div><span>Total Income</span><strong>${peso(income)}</strong></div><div><span>Total Expenses</span><strong>${peso(expenses)}</strong></div><div><span>Net Balance</span><strong>${peso(income - expenses)}</strong></div></div>
    <div class="report-chart-grid">
      <section class="chart-panel"><h3>Expenses by Category</h3>${Object.keys(cats).length ? Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => bar(c, v, maxCat)).join("") : '<div class="empty">No expense data yet.</div>'}</section>
      <section class="chart-panel"><h3>Monthly Spending</h3>${monthEntries.length ? monthEntries.map(([m, v]) => bar(new Date(m + "-02").toLocaleDateString("en", { month: "short", year: "2-digit" }), v, maxMonth, "monthly")).join("") : '<div class="empty">Add dated expenses to see monthly spending.</div>'}</section>
      <section class="chart-panel"><h3>Income vs Expenses</h3>${bar("Income", income, maxCompare, "income-fill")}${bar("Expenses", expenses, maxCompare, "expense-fill")}</section>
    </div>`;
}

function renderAudit() {
  document.getElementById("auditList").innerHTML = data.audit.length
    ? data.audit.map(a => `<div class="row"><span>${escapeHTML(a.action)}</span><small>${escapeHTML(a.date)}</small></div>`).join("")
    : '<div class="empty">No audit records yet.</div>';
}

function renderAll() {
  renderDashboard();
  renderTransactions();
  renderBills();
  renderBudget();
  renderSavingsGoals();
  renderReport();
  renderAudit();
}

function goTo(page) {
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.page === page)
  );

  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("active", p.id === page)
  );

  const nav = document.querySelector('.nav-btn[data-page="' + page + '"]');
  if (!nav) return;

  const t = nav.dataset.title;
  document.getElementById("crumb").textContent = page === "dashboard" ? "MoneySync" : "MoneySync / " + t;
}

document.querySelectorAll(".nav-btn").forEach(btn =>
  btn.addEventListener("click", () => goTo(btn.dataset.page))
);

const viewSavingsGoalsBtn = document.getElementById("viewSavingsGoals");
if (viewSavingsGoalsBtn) {
  viewSavingsGoalsBtn.addEventListener("click", () => goTo("savings"));
}

document.getElementById("helpImport").addEventListener("click", () => goTo("wallet"));
document.getElementById("goAdd").addEventListener("click", () => goTo("transactions"));
document.getElementById("goAddBill").addEventListener("click", () => goTo("bills"));
document.getElementById("goAnalytics").addEventListener("click", () => goTo("reports"));

window.addEventListener("scroll", () =>
  document.getElementById("topbar").classList.toggle("scrolled", scrollY > 10)
);

document.getElementById("darkModeToggle").addEventListener("click", () => {
  const light = !document.body.classList.contains("light-mode");

  document.body.classList.toggle("light-mode", light);
  localStorage.setItem("moneysync_theme", light ? "light" : "dark");

  const btn = document.getElementById("darkModeToggle");
  btn.textContent = light ? "☀ Light mode" : "☾ Dark mode";
  btn.setAttribute("aria-pressed", String(!light));
});

(function initThemeToggle() {
  const light = localStorage.getItem("moneysync_theme") === "light";

  document.body.classList.toggle("light-mode", light);

  const b = document.getElementById("darkModeToggle");
  if (b) {
    b.textContent = light ? "☀ Light mode" : "☾ Dark mode";
    b.setAttribute("aria-pressed", String(!light));
  }
})();

document.getElementById("changePasswordForm").addEventListener("submit", async e => {
  e.preventDefault();

  const msg = document.getElementById("passwordSettingsMessage");
  msg.textContent = "";

  const old = document.getElementById("currentPassword").value;
  const nw = document.getElementById("settingsNewPassword").value;
  const confirmPw = document.getElementById("settingsConfirmPassword").value;

  if (nw.length < 8) {
    msg.textContent = "New password must be at least 8 characters.";
    return;
  }

  if (nw !== confirmPw) {
    msg.textContent = "New passwords do not match.";
    return;
  }

  try {
    await api("/account/password", "POST", { currentPassword: old, newPassword: nw });
    e.target.reset();
    msg.textContent = "Password updated successfully.";
  } catch (error) {
    msg.textContent = error.message;
  }
});

document.getElementById("changePinForm").addEventListener("submit", async e => {
  e.preventDefault();

  const msg = document.getElementById("pinSettingsMessage");
  msg.textContent = "";

  const pw = document.getElementById("settingsCurrentPasswordForPin").value;
  const pin = document.getElementById("settingsNewPin").value;
  const confirmPin = document.getElementById("settingsConfirmPin").value;

  if (!/^\d{4}$/.test(pin)) {
    msg.textContent = "PIN must be exactly 4 digits.";
    return;
  }

  if (pin !== confirmPin) {
    msg.textContent = "PINs do not match.";
    return;
  }

  try {
    await api("/account/pin", "PUT", { currentPassword: pw, pin });
    e.target.reset();
    msg.textContent = "PIN updated successfully.";
  } catch (error) {
    msg.textContent = error.message;
  }
});

document.getElementById("transactionForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api("/transactions", "POST", {
      name: tName.value,
      amount: tAmount.value,
      type: tType.value,
      category: tCategory.value,
      method: tMethod.value,
      date: tDate.value
    });
    e.target.reset();
    tDate.value = today;
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("billForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api("/bills", "POST", {
      name: bName.value,
      amount: bAmount.value,
      due: bDue.value,
      frequency: bFrequency.value
    });
    e.target.reset();
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("budgetForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api("/budget", "PUT", { amount: budgetAmount.value });
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("savingsGoalForm").addEventListener("submit", async e => {
  e.preventDefault();

  const name = document.getElementById("goalName").value.trim();
  const target = Number(document.getElementById("goalTarget").value);
  const saved = Number(document.getElementById("goalInitial").value || 0);
  const date = document.getElementById("goalDate").value;

  if (!name || !Number.isFinite(target) || target <= 0 || !Number.isFinite(saved) || saved < 0) {
    alert("Please enter a valid goal name and amount.");
    return;
  }

  try {
    await api("/savings-goals", "POST", { name, target, saved, date });
    e.target.reset();
    document.getElementById("goalInitial").value = "0";
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("csvFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const result = await api("/import/transactions", "POST", { csv: reader.result });
      const rejected = result.rejected.length;
      document.getElementById("importMessage").textContent =
        `Imported ${result.loaded} transaction(s); ${result.duplicates} duplicate(s), ${rejected} rejected.`;
      await refresh();
    } catch (error) {
      document.getElementById("importMessage").textContent = error.message;
    }
  };

  reader.readAsText(file);
});

document.getElementById("tDate").value = today;

/* ---------- Notification bell ---------- */
(function initNotificationBell() {
  const notifBtn = document.getElementById("notifBtn");
  const notificationPanel = document.getElementById("notificationPanel");
  const closeNotifBtn = document.getElementById("closeNotifBtn");

  if (!notifBtn || !notificationPanel) return;

  function closeNotifications() {
    notificationPanel.classList.add("hidden");
    notifBtn.setAttribute("aria-expanded", "false");
  }

  notifBtn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();

    const shouldOpen = notificationPanel.classList.contains("hidden");
    notificationPanel.classList.toggle("hidden", !shouldOpen);
    notifBtn.setAttribute("aria-expanded", String(shouldOpen));
  });

  notificationPanel.addEventListener("click", event => {
    event.stopPropagation();
  });

  if (closeNotifBtn) {
    closeNotifBtn.addEventListener("click", event => {
      event.preventDefault();
      closeNotifications();
    });
  }

  document.addEventListener("click", closeNotifications);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeNotifications();
  });
})();

/* ---------- Boot ---------- */

if (currentUser() && getToken()) {
  showApp();
} else {
  clearSession();
  showAuthScreen();
}

