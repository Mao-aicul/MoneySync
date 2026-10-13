
const TOKEN_KEY = "moneysync_token";
const USER_KEY = "moneysync_user";
const today = new Date().toISOString().slice(0, 10);

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function currentUser() {
  const saved = sessionStorage.getItem(USER_KEY);
  return saved ? JSON.parse(saved) : null;
}

function setSession(token, user) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function showAuthScreen() {
  document.getElementById("authScreen").classList.remove("hidden");
  document.getElementById("appRoot").classList.add("hidden");
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
    "♡ " + user.name;

  document.getElementById("welcomeName").textContent =
    "Good day, " + firstName + "! ♡";

  try {
    await refresh();
  } catch (e) {
    if (e.status === 401) {
      clearSession();
      showAuthScreen();
      return;
    }
    alert("Cannot load MoneySync data: " + e.message);
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

document.getElementById("tabLogin").addEventListener("click", () => {
  switchAuthTab("login");
});

document.getElementById("tabSignup").addEventListener("click", () => {
  switchAuthTab("signup");
});

document.getElementById("signupForm").addEventListener("submit", async e => {
  e.preventDefault();

  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const confirm = document.getElementById("signupPasswordConfirm").value;
  const error = document.getElementById("signupError");

  error.textContent = "";

  if (password.length < 8) {
    error.textContent = "Password must be at least 8 characters.";
    return;
  }

  if (password !== confirm) {
    error.textContent = "Passwords do not match.";
    return;
  }

  try {
    await api("/register", "POST", { name, email, password });

    // Registration succeeded. Log in to obtain the token.
    const result = await api("/login", "POST", { email, password });

    setSession(result.token, result.user);
    e.target.reset();

    await showApp();
  } catch (err) {
    error.textContent = err.message;
  }
});

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const error = document.getElementById("loginError");

  error.textContent = "";

  try {
    const result = await api("/login", "POST", { email, password });

    setSession(result.token, result.user);
    e.target.reset();

    await showApp();
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

/* ---------- App data (now comes from the backend API) ---------- */
let data={transactions:[],bills:[],budget:0,audit:[]};

async function api(path,method="GET",body){
  const headers={"Content-Type":"application/json"};
  const token=getToken();
  if(token)headers.Authorization=`Bearer ${token}`;
  const res=await fetch("/api"+path,{method,headers,body:body?JSON.stringify(body):undefined});
  if(!res.ok){const err=await res.json().catch(()=>({}));const error=new Error(err.error||"Request failed");error.status=res.status;throw error}
  return res.status===204?null:res.json();
}
async function loadData(){
  const [transactions,bills,budget,audit]=await Promise.all([api("/transactions"),api("/bills"),api("/budget"),api("/audit")]);
  data={transactions,bills,budget:budget.amount,audit:audit.map(a=>({action:a.action,date:a.created_at}))};
}
async function refresh(){await loadData();renderAll()}
function peso(n){return "₱"+Number(n).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}
function sum(type){return data.transactions.filter(t=>t.type===type).reduce((a,t)=>a+Number(t.amount),0)}
function renderDashboard(){
  const income=sum("income"), expenses=sum("expense"), upcoming=data.bills.filter(b=>!b.paid).reduce((a,b)=>a+Number(b.amount),0);
  document.getElementById("balance").textContent=peso(income-expenses);
  document.getElementById("income").textContent=peso(income);
  document.getElementById("expenses").textContent=peso(expenses);
  document.getElementById("upcoming").textContent=peso(upcoming);
  const recent=data.transactions.slice(0,5);
  document.getElementById("recentTransactions").innerHTML=recent.length?recent.map(t=>`
    <div class="row"><span>${t.name}<small> · ${t.category}</small></span>
    <b class="${t.type}-text">${t.type==="income"?"+":"-"}${peso(t.amount)}</b></div>`).join(""):'<div class="empty">No transactions yet.</div>';
  const notes=[];
  data.bills.filter(b=>!b.paid).forEach(b=>{
    const days=Math.ceil((new Date(b.due)-new Date())/86400000);
    notes.push(`${b.name} — ${peso(b.amount)} due ${days<0?"overdue":days===0?"today":"in "+days+" day(s)"}.`);
  });
  if(data.budget){
    const used=sum("expense"), pct=Math.round(used/data.budget*100);
    if(pct>=80) notes.push(`Budget alert: ${pct}% of your monthly budget has been used.`);
  }
  document.getElementById("notifications").innerHTML=notes.length?notes.map(n=>`<div class="row">🔔 ${n}</div>`).join(""):'<div class="empty">No new notifications.</div>';
  updateNotifBadge(notes.length);
}
function updateNotifBadge(count){
  const badge=document.getElementById("notifBadge");
  badge.textContent=count>9?"9+":count;
  badge.classList.toggle("hidden",count===0);
}
function renderTransactions(){
  document.getElementById("transactionList").innerHTML=data.transactions.length?data.transactions.map(t=>`
  <div class="row">
    <span><b>${t.name}</b><br><small>${t.category} · ${t.method} · ${t.date}</small></span>
    <span><b class="${t.type}-text">${t.type==="income"?"+":"-"}${peso(t.amount)}</b>
    <button class="action" onclick="deleteTransaction(${t.id})">Delete</button></span>
  </div>`).join(""):'<div class="empty">No transactions yet.</div>';
}
async function deleteTransaction(id){
  try{await api("/transactions/"+id,"DELETE");await refresh()}catch(e){alert(e.message)}
}
function renderBills(){
  document.getElementById("billList").innerHTML=data.bills.length?data.bills.map(b=>`
  <div class="row">
    <span><b>${b.name}</b><br><small>${peso(b.amount)} · Due ${b.due} · ${b.frequency}</small></span>
    <span><span class="pill">${b.paid?"PAID":"PENDING"}</span>
    ${!b.paid?`<button class="action" onclick="payBill(${b.id})">Mark Paid</button>`:""}</span>
  </div>`).join(""):'<div class="empty">No bills yet.</div>';
}
async function payBill(id){
  try{await api("/bills/"+id+"/pay","PATCH",{method:"GCash"});await refresh()}catch(e){alert(e.message)}
}
function renderBudget(){
  const used=sum("expense"), budget=Number(data.budget)||0;
  const pct=budget?Math.min(100,used/budget*100):0;
  document.getElementById("budgetProgress").style.width=pct+"%";
  document.getElementById("budgetText").textContent=budget?`${peso(used)} used out of ${peso(budget)} (${Math.round(pct)}%)`:"No budget set.";
}
function renderReport(){
  const income=sum("income"), expenses=sum("expense");
  const cats={}; data.transactions.filter(t=>t.type==="expense").forEach(t=>cats[t.category]=(cats[t.category]||0)+Number(t.amount));
  document.getElementById("report").innerHTML=`
    <p><b>Total Income:</b> ${peso(income)}</p>
    <p><b>Total Expenses:</b> ${peso(expenses)}</p>
    <p><b>Net Balance:</b> ${peso(income-expenses)}</p>
    <h3>Expenses by Category</h3>
    ${Object.keys(cats).length?Object.entries(cats).map(([c,v])=>`<div class="row"><span>${c}</span><b>${peso(v)}</b></div>`).join(""):'<div class="empty">No expense data.</div>'}`;
}
function renderAudit(){
  document.getElementById("auditList").innerHTML=data.audit.length?data.audit.map(a=>`<div class="row"><span>${a.action}</span><small>${a.date}</small></div>`).join(""):'<div class="empty">No audit records yet.</div>';
}
function renderAll(){renderDashboard();renderTransactions();renderBills();renderBudget();renderReport();renderAudit()}

document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(btn.dataset.page).classList.add("active");
  document.getElementById("pageTitle").textContent=btn.textContent;
}));

document.getElementById("transactionForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/transactions","POST",{name:tName.value,amount:tAmount.value,type:tType.value,category:tCategory.value,method:tMethod.value,date:tDate.value});
    e.target.reset();tDate.value=today;await refresh();
  }catch(err){alert(err.message)}
});
document.getElementById("billForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/bills","POST",{name:bName.value,amount:bAmount.value,due:bDue.value,frequency:bFrequency.value});
    e.target.reset();await refresh();
  }catch(err){alert(err.message)}
});
document.getElementById("budgetForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{await api("/budget","PUT",{amount:budgetAmount.value});await refresh()}catch(err){alert(err.message)}
});
document.getElementById("csvFile").addEventListener("change",e=>{
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=async()=>{
    const lines=reader.result.trim().split(/\r?\n/).slice(1);
    let count=0;
    for(const line of lines){
      const p=line.split(","); if(p.length<6)continue;
      try{await api("/transactions","POST",{name:p[0],amount:p[1],type:p[2],category:p[3],method:p[4],date:p[5]});count++}catch(err){}
    }
    document.getElementById("importMessage").textContent=`Imported ${count} transaction(s).`;
    await refresh();
  };
  reader.readAsText(file);
});
document.getElementById("notifBtn").addEventListener("click",()=>{
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  const dashBtn=document.querySelector('.nav-btn[data-page="dashboard"]');
  dashBtn.classList.add("active");
  document.getElementById("dashboard").classList.add("active");
  document.getElementById("pageTitle").textContent=dashBtn.textContent;
  document.getElementById("notifications").scrollIntoView({behavior:"smooth",block:"center"});
});

document.getElementById("tDate").value=today;

/* ---------- Boot ---------- */
if (getToken() && currentUser()) {
  showApp();
} else {
  clearSession();
  showAuthScreen();
}