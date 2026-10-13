const USERS_KEY="moneysync_users_v1";
const SESSION_KEY="moneysync_session_v1";
const today=new Date().toISOString().slice(0,10);

/* ---------- Auth (prototype-only; browser-side, not a real backend) ---------- */
function hashPassword(pw){
  // Simple non-cryptographic hash so we don't store plain-text passwords in localStorage.
  // NOTE: this is NOT secure and is only meant to simulate auth in this frontend prototype.
  let h=5381;
  for(let i=0;i<pw.length;i++) h=((h<<5)+h)+pw.charCodeAt(i);
  return String(h);
}
function getUsers(){return JSON.parse(localStorage.getItem(USERS_KEY))||[]}
function saveUsers(users){localStorage.setItem(USERS_KEY,JSON.stringify(users))}
function getSession(){return JSON.parse(localStorage.getItem(SESSION_KEY))}
function setSession(userId){localStorage.setItem(SESSION_KEY,JSON.stringify({userId}))}
function clearSession(){localStorage.removeItem(SESSION_KEY)}
function currentUser(){
  const session=getSession(); if(!session)return null;
  return getUsers().find(u=>u.id===session.userId)||null;
}

function showAuthScreen(){
  document.getElementById("authScreen").classList.remove("hidden");
  document.getElementById("appRoot").classList.add("hidden");
}
function showApp(){
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("hidden");
  const user=currentUser();
  const firstName=user?user.name.trim().split(" ")[0]:"";
  document.getElementById("userChip").textContent="♡ "+(user?user.name:"");
  document.getElementById("welcomeName").textContent="Good day"+(firstName?", "+firstName:"")+"! ♡";
  loadData();
  renderAll();
}

function switchAuthTab(tab){
  const isLogin=tab==="login";
  document.getElementById("tabLogin").classList.toggle("active",isLogin);
  document.getElementById("tabSignup").classList.toggle("active",!isLogin);
  document.getElementById("loginForm").classList.toggle("hidden",!isLogin);
  document.getElementById("signupForm").classList.toggle("hidden",isLogin);
  document.getElementById("loginError").textContent="";
  document.getElementById("signupError").textContent="";
}
document.getElementById("tabLogin").addEventListener("click",()=>switchAuthTab("login"));
document.getElementById("tabSignup").addEventListener("click",()=>switchAuthTab("signup"));

document.getElementById("signupForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=signupName.value.trim();
  const email=signupEmail.value.trim().toLowerCase();
  const pw=signupPassword.value;
  const pw2=signupPasswordConfirm.value;
  const errEl=document.getElementById("signupError");
  if(pw.length<6){errEl.textContent="Password must be at least 6 characters.";return}
  if(pw!==pw2){errEl.textContent="Passwords do not match.";return}
  const users=getUsers();
  if(users.some(u=>u.email===email)){errEl.textContent="An account with that email already exists.";return}
  const user={id:Date.now(),name,email,password:hashPassword(pw)};
  users.push(user);saveUsers(users);
  setSession(user.id);
  e.target.reset();
  showApp();
});

document.getElementById("loginForm").addEventListener("submit",e=>{
  e.preventDefault();
  const email=loginEmail.value.trim().toLowerCase();
  const pw=loginPassword.value;
  const errEl=document.getElementById("loginError");
  const user=getUsers().find(u=>u.email===email);
  if(!user||user.password!==hashPassword(pw)){errEl.textContent="Incorrect email or password.";return}
  setSession(user.id);
  e.target.reset();
  showApp();
});

document.getElementById("logoutBtn").addEventListener("click",()=>{
  clearSession();
  document.getElementById("loginForm").reset();
  document.getElementById("signupForm").reset();
  switchAuthTab("login");
  showAuthScreen();
});

/* ---------- App data (scoped per logged-in user) ---------- */
let data;
function dataKey(){const user=currentUser();return "moneysync_data_v1_"+(user?user.id:"guest")}
function loadData(){
  data=JSON.parse(localStorage.getItem(dataKey()))||{
    transactions:[
      {id:1,name:"Allowance",amount:25000,type:"income",category:"Allowance",method:"Bank",date:today},
      {id:2,name:"Lunch",amount:180,type:"expense",category:"Food",method:"GCash",date:today}
    ],
    bills:[{id:1,name:"Internet",amount:1699,due:"2026-09-30",frequency:"Monthly",paid:false}],
    budget:10000,
    audit:[]
  };
}
function save(){localStorage.setItem(dataKey(),JSON.stringify(data))}
function peso(n){return "₱"+Number(n).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}
function log(action){data.audit.unshift({action,date:new Date().toLocaleString()});save();renderAudit()}
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
function deleteTransaction(id){data.transactions=data.transactions.filter(t=>t.id!==id);save();log("Deleted a transaction");renderAll()}
function renderBills(){
  document.getElementById("billList").innerHTML=data.bills.length?data.bills.map(b=>`
  <div class="row">
    <span><b>${b.name}</b><br><small>${peso(b.amount)} · Due ${b.due} · ${b.frequency}</small></span>
    <span><span class="pill">${b.paid?"PAID":"PENDING"}</span>
    ${!b.paid?`<button class="action" onclick="payBill(${b.id})">Mark Paid</button>`:""}</span>
  </div>`).join(""):'<div class="empty">No bills yet.</div>';
}
function payBill(id){
  const b=data.bills.find(x=>x.id===id); if(!b)return;
  b.paid=true;
  data.transactions.unshift({id:Date.now(),name:b.name+" Payment",amount:b.amount,type:"expense",category:"Bills",method:"GCash",date:today});
  save();log("Marked "+b.name+" as paid");renderAll();
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
function renderAll(){renderDashboard();renderTransactions();renderBills();renderBudget();renderReport();renderAudit();save()}

document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(btn.dataset.page).classList.add("active");
  document.getElementById("pageTitle").textContent=btn.textContent;
}));

document.getElementById("transactionForm").addEventListener("submit",e=>{
  e.preventDefault();
  data.transactions.unshift({
    id:Date.now(),name:tName.value,amount:Number(tAmount.value),type:tType.value,
    category:tCategory.value,method:tMethod.value,date:tDate.value
  });
  e.target.reset();tDate.value=today;save();log("Added a "+tType.value+" transaction");renderAll();
});
document.getElementById("billForm").addEventListener("submit",e=>{
  e.preventDefault();
  data.bills.push({id:Date.now(),name:bName.value,amount:Number(bAmount.value),due:bDue.value,frequency:bFrequency.value,paid:false});
  e.target.reset();save();log("Added a bill");renderAll();
});
document.getElementById("budgetForm").addEventListener("submit",e=>{
  e.preventDefault();data.budget=Number(budgetAmount.value);save();log("Updated monthly budget");renderAll();
});
document.getElementById("csvFile").addEventListener("change",e=>{
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    const lines=reader.result.trim().split(/\r?\n/).slice(1);
    let count=0;
    lines.forEach(line=>{
      const p=line.split(","); if(p.length<6)return;
      data.transactions.unshift({id:Date.now()+count,name:p[0],amount:Number(p[1]),type:p[2],category:p[3],method:p[4],date:p[5]});
      count++;
    });
    save();log(`Imported ${count} wallet transaction(s)`);document.getElementById("importMessage").textContent=`Imported ${count} transaction(s).`;renderAll();
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
if(currentUser()){
  showApp();
}else{
  clearSession();
  showAuthScreen();
}