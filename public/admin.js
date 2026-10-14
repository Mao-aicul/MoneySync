(function () {
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }

  window.refreshAdminUI = async function () {
    const nav = document.getElementById("adminNavBtn");
    const panel = document.getElementById("adminContent");
    let user;
    try {
      user = JSON.parse(sessionStorage.getItem("moneysync_user"));
    } catch (_) {
      user = null;
    }
    if (!nav || !panel) return;

    const allowed = !!user && user.role === "admin";
    nav.classList.toggle("hidden", !allowed);
    if (!allowed) return;

    try {
      const response = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${sessionStorage.getItem("moneysync_token")}` }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to load accounts.");

      const allUsers = result;
      panel.innerHTML = `<div class="admin-stats"><div><span>Total accounts</span><strong>${allUsers.length}</strong></div><div><span>Administrators</span><strong>${allUsers.filter(u => u.role === "admin").length}</strong></div><div><span>Regular users</span><strong>${allUsers.filter(u => u.role !== "admin").length}</strong></div></div>
        <h3>Registered Accounts</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${allUsers.map(u => `<tr><td>${escapeHTML(u.name || "—")}</td><td>${escapeHTML(u.email || "—")}</td><td><span class="role-pill">${escapeHTML(u.role || "user")}</span></td></tr>`).join("") || '<tr><td colspan="3">No accounts found.</td></tr>'}</tbody></table></div>`;
    } catch (error) {
      panel.innerHTML = `<p class="muted">${escapeHTML(error.message)}</p>`;
    }
  };
})();
