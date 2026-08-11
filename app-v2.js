const state={user:null,summary:{},data:{leads:[],applications:[],documents:[],inbox:[],outbox:[],catalog:[],pricing:[],team:[],users:[],activity:[],integrations:[],channels:[],qa:[]},view:'dashboard',loaded:false};
const loadedResources=new Set();
const app=document.getElementById('appView'),shell=document.getElementById('appShell'),gate=document.getElementById('loginGate'),form=document.getElementById('loginForm');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const pretty=v=>String(v||'—').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
const when=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.valueOf())?String(v):new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(d)};
const money=v=>v?`RM ${esc(v)}`:'—';
const pill=(v,good=false)=>`<span class="pill ${good?'green':''}">${pretty(v)}</span>`;
const empty=n=>`<tr><td colspan="${n}">No live records found.</td></tr>`;
const isSyntheticLead=lead=>Boolean(lead?.synthetic)||/^(CODEX|QA|UAT)\s+TEST\b/i.test(String(lead?.name||''))||/^(SYNTHETIC|TEST|QA|UAT)$/i.test(String(lead?.source||''));
const isSyntheticApplication=application=>Boolean(application?.synthetic)||/^(CODEX|QA|UAT)\s+TEST\b/i.test(String(application?.customer||''))||/^TEST\s+BRAND$/i.test(String(application?.brand||''));
const businessLeads=()=>state.data.leads.filter(lead=>!isSyntheticLead(lead));
const businessApplications=()=>state.data.applications.filter(application=>!isSyntheticApplication(application));
const businessDocuments=()=>{const syntheticApplicationIds=new Set(state.data.applications.filter(isSyntheticApplication).map(application=>application.id)),syntheticLeadIds=new Set(state.data.leads.filter(isSyntheticLead).map(lead=>lead.id));return state.data.documents.filter(document=>!syntheticApplicationIds.has(document.applicationId)&&!syntheticLeadIds.has(document.leadId))};
const head=(title,desc)=>`<div class="page-head"><div><div class="eyebrow">JomKaki Motor CRM</div><h1>${title}</h1><p>${desc}</p></div><div class="page-actions"><button class="secondary" data-refresh>Refresh data</button></div></div><div class="status-strip"><span class="live-dot"></span><strong>Live CRM connected</strong><span>${esc(state.user?.role||'')}</span></div>`;
const metric=(label,value,note)=>`<article class="metric-card"><span>${label}</span><strong>${value??0}</strong><small>${note}</small></article>`;
async function get(resource){const r=await fetch(`/api/crm?resource=${resource}&_=${Date.now()}`,{cache:'no-store'});if(r.status===401)throw new Error('AUTH');const p=await r.json();if(!r.ok||!p.live)throw new Error(p.error||'Unable to load data');return p}
async function optional(resource){try{return await get(resource)}catch(e){if(e.message==='AUTH')throw e;return{records:[]}}}
async function post(action,payload){const r=await fetch('/api/crm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});const p=await r.json();if(!r.ok||!p.live)throw new Error(p.error||'Unable to save');return p}
const fileData=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
async function ensureCatalogForForms(){if(loadedResources.has('catalog')&&state.data.catalog.length)return;const response=await get('catalog');state.data.catalog=response.records||[];loadedResources.add('catalog')}
const catalogOptions=(selected={})=>state.data.catalog.filter(item=>item.active).map(item=>{const matches=selected.catalogId===item.id||(!selected.catalogId&&String(selected.brand||'').toLowerCase()===String(item.brand||'').toLowerCase()&&String(selected.model||'').toLowerCase()===String(item.model||'').toLowerCase()&&String(selected.variant||'Standard').toLowerCase()===String(item.variant||'Standard').toLowerCase());return `<option value="${esc(item.id)}" ${matches?'selected':''}>${esc([item.brand,item.model,item.variant].filter(Boolean).join(' '))} · ${esc(item.id)}</option>`}).join('');
const normalizePhone=value=>{let digits=String(value||'').replace(/\D/g,'');if(digits.startsWith('0'))digits=`60${digits.slice(1)}`;return digits};
async function ensureCustomer360Data(){const resources=['inbox','outbox','activity'],missing=resources.filter(resource=>!loadedResources.has(resource));if(!missing.length)return;const responses=await Promise.all(missing.map(resource=>optional(resource)));missing.forEach((resource,index)=>{state.data[resource]=responses[index].records||[];loadedResources.add(resource)})}
function customerSearchCandidates(){const seen=new Set(),results=[];const add=item=>{const key=item.leadId||item.applicationId||normalizePhone(item.phone)||String(item.name||'').toLowerCase();if(!key||seen.has(key))return;seen.add(key);results.push(item)};state.data.leads.forEach(lead=>add({leadId:lead.id,applicationId:lead.applicationId,phone:lead.phone,name:lead.name,motor:lead.model,status:lead.status,search:Object.values(lead).join(' ')}));state.data.applications.forEach(application=>add({leadId:application.leadId,applicationId:application.id,phone:application.phone,name:application.customer,motor:application.product,status:application.stage||application.status,search:Object.values(application).join(' ')}));state.data.inbox.forEach(message=>add({leadId:message.leadId,applicationId:message.applicationId,phone:message.phone,name:message.customer,motor:'',status:message.status,search:Object.values(message).join(' ')}));return results}
function bindCustomerProfileButtons(){document.querySelectorAll('[data-customer-profile]').forEach(button=>button.onclick=()=>openCustomer360({leadId:button.dataset.leadId||'',applicationId:button.dataset.applicationId||'',phone:button.dataset.phone||''}).catch(error=>alert(error.message)))}
async function runGlobalSearch(query){const q=String(query||'').trim();if(!q)return;await ensureCustomer360Data();const matches=customerSearchCandidates().filter(item=>`${item.name} ${item.phone} ${item.motor} ${item.status} ${item.search}`.toLowerCase().includes(q.toLowerCase())).slice(0,40);drawer('Customer search',`${matches.length} result${matches.length===1?'':'s'} for "${esc(q)}"`,`<div class="customer-search-results">${matches.map(item=>`<button class="customer-search-card" data-customer-profile data-lead-id="${esc(item.leadId||'')}" data-application-id="${esc(item.applicationId||'')}" data-phone="${esc(item.phone||'')}"><span><strong>${esc(item.name||item.phone||'Customer')}</strong><small>${esc([item.phone,item.motor].filter(Boolean).join(' | '))}</small></span>${pill(item.status||'Open',true)}</button>`).join('')||'<div class="customer-360-empty"><strong>No matching customer found</strong><p>Try a name, phone number, Lead ID, Application ID or motorcycle model.</p></div>'}</div>`,'customer-search-drawer');bindCustomerProfileButtons()}
async function load(){app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading live CRM…</p></div>';try{const [session,dashboard,leads,applications,documents,team]=await Promise.all([get('session'),get('dashboard'),get('leads'),optional('applications'),optional('documents'),optional('team')]);state.user=session.user;state.summary=dashboard.summary;Object.assign(state.data,{leads:leads.records||[],applications:applications.records||[],documents:documents.records||[],team:team.records||[],inbox:[],outbox:[],catalog:[],pricing:[],activity:[],integrations:[],channels:[],secondHandMotors:[]});loadedResources.clear();['leads','applications','documents','team'].forEach(x=>loadedResources.add(x));state.loaded=true;shell.hidden=false;gate.classList.add('hidden');document.getElementById('profileName').textContent=state.user.name;document.getElementById('profileRole').textContent=state.user.role==='ADMIN'?'Administrator':state.user.role==='STAFF'?`Sales Advisor · ${state.user.saId}`:state.user.role==='BRANCH_MANAGER'?`Branch Manager · ${state.user.branchId}`:`${pretty(state.user.region)} Manager`;document.querySelector('.integration-card small').textContent=state.user.whatsappMode==='CLOUD'?'Cloud API connected':'Manual ready · Cloud pending';document.getElementById('leadBadge').textContent=state.summary.leads||0;document.getElementById('applicationBadge').textContent=state.summary.applications||0;document.getElementById('inboxBadge').textContent=state.summary.unreadInbox||0;document.getElementById('workBadge').textContent=state.summary.needsAttention||0;document.querySelector('[aria-label="Notifications"] em').textContent=state.summary.needsAttention||0;render();return true}catch(e){shell.hidden=true;gate.classList.remove('hidden');return false}}
function dashboard(){const s=state.summary;app.innerHTML=head('Command Centre','AI-managed applications, exception queues and LMS readiness in your permitted scope.')+`<div class="metric-grid">${metric('Total leads',s.leads,'Your permitted scope')}${metric('Applications',s.applications,'Financing cases')}${metric('AI exceptions',s.aiExceptions||0,'Assigned only when AI cannot finish')}${metric('Ready for LMS',s.lmsReady||0,'Documents verified complete')}${metric('Human handovers',s.humanHandovers,'Manager attention')}${metric('Needs attention',s.needsAttention,'Exceptions and recovery')}${metric('Completed',s.completed,'Finished cases')}${metric('Unread inbox',s.unreadInbox,'Customer replies')}</div><section class="panel" style="margin-top:16px"><div class="panel-head"><h3>Latest applications</h3></div>${applicationTable(state.data.applications.slice(0,10))}</section>`}
function leadTable(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer</th><th>Motor</th><th>Application</th><th>Region</th><th>Status</th><th>Owner</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.id)} · ${esc(x.phone)}</small></td><td>${esc(x.model)}</td><td>${x.applicationId?`${esc(x.applicationId)}<br>${pretty(x.applicationStatus)}`:'—'}</td><td>${pretty(x.region)}</td><td>${pill(x.status,true)}</td><td>${esc(x.sa)}</td><td><button class="row-action" data-lead="${esc(x.id)}">Open</button></td></tr>`).join('')||empty(7)}</tbody></table></div>`}
function leads(){app.innerHTML=head('Lead Pipeline','Customer, motorcycle interest, application status and ownership in one view.')+`<div class="smart-toolbar"><input id="search" placeholder="Search customer, phone, motorcycle or Lead ID"><div class="toolbar-spacer"></div>${pill(`${state.data.leads.length} live leads`,true)}</div><section class="panel" id="results">${leadTable(state.data.leads)}</section>`;document.getElementById('search').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('results').innerHTML=leadTable(state.data.leads.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q)))};bind()}
function applicationTable(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer</th><th>Motor</th><th>Financing</th><th>Documents</th><th>Missing</th><th>Stage</th><th>Owner</th><th>Actions</th></tr></thead><tbody>${rows.map(a=>`<tr><td><strong>${esc(a.customer)}</strong><small>${esc(a.id)}</small></td><td><strong>${esc(a.product||'Not selected')}</strong><small>${pretty(a.priceZone||a.region)}</small></td><td>${money(a.deposit)} deposit<br>${a.monthly?`${money(a.monthly)}/month · ${esc(a.tenure)} years`:'Quote pending'}</td><td><strong>${a.documentsReceived||0}</strong> received<br>${pretty(a.documentStatus||'Pending')}</td><td>${esc(a.missingDocuments||'None recorded')}</td><td>${pill(a.stage,true)}<br>${pretty(a.status)}</td><td>${esc(a.sa)}</td><td><div class="row-actions"><button class="row-action whatsapp-action" data-whatsapp="${esc(a.id)}">WhatsApp</button><button class="row-action" data-upload="${esc(a.id)}">Upload</button><button class="row-action secondary" data-app="${esc(a.id)}">Manage</button></div></td></tr>`).join('')||empty(8)}</tbody></table></div>`}
function applications(){app.innerHTML=head('Applications','Motorcycle, document progress, AI exceptions and LMS readiness in one view.')+`<div class="security-banner upload-banner"><div><strong>AI-first document flow</strong><p>AI collects and checks the required documents. Complete cases move to <b>Ready for LMS</b>; only incomplete or failed follow-ups are assigned to Staff by round-robin.</p></div></div><div class="smart-toolbar"><input id="search" placeholder="Search customer, application, motorcycle or document status"><div class="toolbar-spacer"></div>${pill(`${state.data.applications.length} live applications`,true)}</div><section class="panel" id="results">${applicationTable(state.data.applications)}</section>`;document.getElementById('search').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('results').innerHTML=applicationTable(state.data.applications.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q)))};bind()}
function workbench(){const needsDocs=state.data.applications.filter(a=>!a.documentsReceived||a.missingDocuments&&a.missingDocuments.toLowerCase()!=='none recorded'),review=state.data.applications.filter(a=>a.documentNeedsReview||String(a.reviewRequired).toUpperCase()==='TRUE'),followUp=state.data.applications.filter(a=>a.nextFollowUp),handovers=state.data.inbox.filter(x=>x.humanRequired);app.innerHTML=head('My Workbench',state.user?.role==='STAFF'?'Only AI exceptions assigned to your SA ID appear here.':'Manager oversight for human handovers and AI exceptions inside your scope.')+`<div class="metric-grid">${metric('Human handovers',handovers.length,state.user?.role==='STAFF'?'Visible only when assigned':'Manager action required')}${metric('Incomplete documents',needsDocs.length,'AI exception follow-up')}${metric('AI review exceptions',review.length,state.user?.role==='STAFF'?'Manager decision required':'Resolve failed AI checks')}${metric('Follow-ups',followUp.length,'Exception follow-up schedule')}</div>${handovers.length?`<section class="panel urgent-panel"><div class="panel-head"><h3>Human handover queue</h3></div>${inboxTable(handovers)}</section>`:''}<section class="panel"><div class="panel-head"><h3>Assigned exception cases</h3></div>${applicationTable([...new Map([...review,...needsDocs,...followUp].map(a=>[a.id,a])).values()])}</section>`;bindMessaging()}
function documentTable(rows){const canReview=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer / Application</th><th>Document</th><th>Received</th><th>AI status</th><th>Remarks</th><th>Actions</th></tr></thead><tbody>${rows.map(d=>{const a=state.data.applications.find(x=>x.id===d.applicationId||x.leadId===d.leadId);return `<tr><td><strong>${esc(a?.customer||d.leadId||'Customer')}</strong><small>${esc(d.applicationId||a?.id||d.leadId)}</small></td><td><strong>${pretty(d.type||'Unclassified')}</strong><small>${esc(d.fileName||d.mimeType||'File recorded')}</small></td><td>${esc(when(d.received||d.updated))}</td><td>${pill(d.verification||d.quality||d.classification||'AI queued',String(d.reviewRequired).toUpperCase()!=='TRUE')}</td><td>${esc(d.remarks||'—')}</td><td><div class="row-actions">${canReview?`<button class="row-action" data-review="${esc(d.id)}">Resolve AI exception</button>`:'<span class="pill">Manager decision required</span>'}${a?`<button class="row-action secondary" data-app="${esc(a.id)}">Open application</button>`:''}</div></td></tr>`}).join('')||empty(6)}</tbody></table></div>`}
function documents(){const badge=document.getElementById('documentBadge');if(badge)badge.textContent=state.data.documents.length;const pending=state.data.documents.filter(d=>String(d.reviewRequired).toUpperCase()==='TRUE'||['PENDING','PENDING_AI','AI_QUEUED'].includes(String(d.verification||d.classification||'').toUpperCase()));app.innerHTML=head('Documents','Secure SharePoint records with AI processing and exception status.')+`<div class="metric-grid">${metric('Files received',state.data.documents.length,'Secure SharePoint records')}${metric('AI processing / exceptions',pending.length,'No routine Staff review')}${metric('Applications covered',new Set(state.data.documents.map(d=>d.applicationId).filter(Boolean)).size,'With at least one file')}</div><div class="smart-toolbar"><input id="search" placeholder="Search customer, application, type or filename"><div class="toolbar-spacer"></div><button class="primary" data-new-upload>Upload document</button></div><section class="panel" id="results">${documentTable(state.data.documents)}</section>`;document.getElementById('search').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('results').innerHTML=documentTable(state.data.documents.filter(d=>{const a=state.data.applications.find(x=>x.id===d.applicationId);return `${Object.values(d).join(' ')} ${a?.customer||''}`.toLowerCase().includes(q)}));bind()};document.querySelector('[data-new-upload]').onclick=chooseUpload;bind()}
function chooseUpload(){formModal('Select an application',`<div class="smart-toolbar"><input id="uploadApplicationSearch" placeholder="Search customer, application or motorcycle"></div><div id="uploadApplicationResults">${applicationTable(state.data.applications)}</div>`);const input=document.getElementById('uploadApplicationSearch');input.oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('uploadApplicationResults').innerHTML=applicationTable(state.data.applications.filter(a=>Object.values(a).join(' ').toLowerCase().includes(q)));bind()};bind()}
function reportsScoped(){
  const period=state.reportPeriod||'30';
  const leads=state.data.leads.filter(lead=>!isSyntheticLead(lead)&&reportWithin(lead,period,['created','time']));
  const applications=state.data.applications.filter(application=>!isSyntheticApplication(application)&&reportWithin(application,period,['created','updated']));
  const applicationIds=new Set(applications.map(application=>application.id));
  const leadIds=new Set(leads.map(lead=>lead.id));
  const documents=state.data.documents.filter(document=>(applicationIds.has(document.applicationId)||leadIds.has(document.leadId))&&reportWithin(document,period,['received','updated']));
  const openApplications=applications.filter(reportIsOpen);
  const overdueFollowups=openApplications.filter(reportIsOverdue);
  const stalled=openApplications.filter(application=>reportAgeDays(application,['updated','created'])>=3);
  const documentComplete=applications.filter(reportDocumentComplete);
  const readyForLms=applications.filter(reportReadyForLms);
  const missingDocuments=reportMissingDocumentGroups(applications);
  const aging=reportAgingGroups(openApplications);
  const trendDays=period==='ALL'?30:Number(period);
  const trend=reportTrendGroups(leads,['created','time'],trendDays);
  const summary={
    'Leads':leads.length,
    'Applications':applications.length,
    'Files received':documents.length,
    'Document completion':reportPercent(documentComplete.length,applications.length),
    'Ready for LMS':readyForLms.length,
    'Overdue follow-ups':overdueFollowups.length,
    'Stalled 3+ days':stalled.length
  };
  const report={period,region:state.user?.region||'Permitted scope',summary,trendRows:reportObjectRows(trend),agingRows:reportObjectRows(aging),documentGapRows:reportObjectRows(missingDocuments)};
  app.innerHTML=head('Reports & Analytics','Operational performance, ageing and document progress inside your permitted scope.')+
    '<div class="smart-toolbar report-toolbar"><label>Report period<select id="reportPeriod">'+
      reportOption('7','Last 7 days',period)+reportOption('30','Last 30 days',period)+reportOption('90','Last 90 days',period)+reportOption('ALL','All time',period)+
    '</select></label><div class="toolbar-spacer"></div><button class="secondary" data-export-scoped-report>Download report CSV</button></div>'+
    '<div class="metric-grid">'+
      metric('Leads',leads.length,'Created in selected period')+
      metric('Applications',applications.length,reportPercent(applications.length,leads.length)+' lead conversion')+
      metric('Files received',documents.length,'Secure document records')+
      metric('Documents complete',documentComplete.length,reportPercent(documentComplete.length,applications.length)+' of applications')+
      metric('Ready for LMS',readyForLms.length,'Verified and ready')+
      metric('Overdue follow-ups',overdueFollowups.length,'Follow-up date has passed')+
      metric('Stalled 3+ days',stalled.length,'No application update')+
    '</div><div class="report-grid">'+
      '<section class="report-card"><h3>Lead trend</h3>'+adminBars(trend,period==='90'?13:31)+'</section>'+
      '<section class="report-card"><h3>Open-case ageing</h3>'+adminBars(aging,10)+'</section>'+
      '<section class="report-card"><h3>Missing document types</h3>'+adminBars(missingDocuments,10)+'</section>'+
      '<section class="report-card"><h3>Applications by stage</h3>'+adminBars(adminGroup(applications,application=>application.stage),20)+'</section>'+
      '<section class="report-card"><h3>Loan application status</h3>'+adminBars(adminGroup(applications,application=>application.status),20)+'</section>'+
      '<section class="report-card wide"><h3>Motorcycle demand</h3>'+adminBars(adminGroup(applications,application=>application.product),20)+'</section>'+
    '</div>';
  document.getElementById('reportPeriod').onchange=event=>{state.reportPeriod=event.target.value;reportsScoped()};
  document.querySelector('[data-export-scoped-report]').onclick=()=>downloadOperationalReport(report);
}
function users(){const permissions=state.user?.role==='ADMIN'?['View every company lead and application','Manage all CRM accounts and access','Oversee AI exceptions, LMS readiness and audit activity','Assign or reassign any permitted case']:state.user?.role==='REGION_MANAGER'?['View every lead in own region','Handle regional human handovers and AI exceptions','Assign cases to branches and Staff','View regional reports and activity']:state.user?.role==='BRANCH_MANAGER'?['View leads assigned to own branch only','Handle branch human handovers and AI exceptions','Assign branch cases to eligible Staff','View branch activity and document status']:['View only AI exceptions assigned to own SA ID','Follow up assigned customers and missing documents','Upload documents for assigned customers','No access to approval, verification or other Staff cases'];app.innerHTML=head('Users & Access','Role visibility follows the AI-first exception workflow without exposing passwords or secret credentials.')+`<div class="security-banner"><div><strong>Signed in as ${esc(state.user?.name)}</strong><p>${pretty(state.user?.role)} · ${pretty(state.user?.region||'All regions')} access. Passwords and integration secrets are never shown here.</p></div></div><div class="user-grid"><article class="user-card"><div class="user-top"><div class="user-avatar">${esc((state.user?.name||'U').split(' ').map(x=>x[0]).join('').slice(0,2))}</div><div><h3>${esc(state.user?.name)}</h3><p>${pretty(state.user?.role)} · ${pretty(state.user?.region||'All regions')}</p></div></div><div class="permission-list">${permissions.map(x=>`<span>${esc(x)}</span>`).join('')}</div></article>${state.data.team.map(t=>`<article class="user-card"><div class="user-top"><div class="user-avatar">${esc((t.name||'SA').split(' ').map(x=>x[0]).join('').slice(0,2))}</div><div><h3>${esc(t.name)}</h3><p>${esc(t.id)} · ${esc(t.branch||'Branch pending')}</p></div></div><div class="permission-list"><span>${pretty(t.region)} sales scope</span><span>${String(t.accepting).toUpperCase()==='TRUE'?'Accepting AI exceptions':'Not accepting new exceptions'}</span></div></article>`).join('')}</div>`}
function usersAdmin(){if(state.user?.role!=='ADMIN'){users();return}const rows=state.data.users,passwordSetupCount=rows.filter(x=>x.loginEnabled&&!x.passwordConfigured).length;app.innerHTML=head('Users & Access','Create accounts, assign access, reset passwords and disable departed staff directly in CRM.')+`<div class="smart-toolbar"><input id="userSearch" placeholder="Search username, name, role, branch or SA ID"><div class="toolbar-spacer"></div><button class="secondary" data-migrate-users>Import legacy accounts</button><button class="primary" data-new-user>+ Add account</button></div><div class="security-banner"><div><strong>${rows.filter(x=>x.loginEnabled).length} enabled accounts</strong><p>${passwordSetupCount?`${passwordSetupCount} enabled account${passwordSetupCount===1?'':'s'} still require password setup. `:''}Passwords are never displayed or stored as readable text. Resetting creates a one-time temporary password and immediately invalidates the old login session.</p></div></div><section class="panel" id="userResults">${userTable(rows)}</section>`;document.querySelector('[data-new-user]').onclick=newUser;document.querySelector('[data-migrate-users]').onclick=migrateLegacyUsers;document.getElementById('userSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('userResults').innerHTML=userTable(rows.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q)));bindUsers()};bindUsers()}
function userTable(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>User</th><th>Role & scope</th><th>Branch / SA</th><th>Status</th><th>Security</th><th>Actions</th></tr></thead><tbody>${rows.map(u=>`<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.username)} · ${esc(u.id)}</small></td><td>${pretty(u.role)}<small>${esc(u.access||pretty(u.region))}</small></td><td>${esc(u.branchId||'—')}<small>${esc(u.saId||'No SA ID')}</small></td><td>${pill(u.loginEnabled?'Enabled':'Disabled',u.loginEnabled)}</td><td>${!u.passwordConfigured?pill('Password setup required'):u.lockedUntil?pill('Locked'):u.mustChangePassword?pill('Change required'):'Protected'}<small>${u.failedAttempts?`${u.failedAttempts} failed attempts`:u.lastPasswordReset?'Reset '+esc(when(u.lastPasswordReset)):''}</small></td><td><div class="row-actions"><button class="row-action" data-edit-user="${esc(u.id)}">Edit</button><button class="row-action" data-reset-user="${esc(u.id)}">Reset password</button>${u.failedAttempts||u.lockedUntil?`<button class="row-action" data-unlock-user="${esc(u.id)}">Unlock</button>`:''}<button class="row-action secondary" data-toggle-user="${esc(u.id)}">${u.loginEnabled?'Disable':'Enable'}</button></div></td></tr>`).join('')||empty(6)}</tbody></table></div>`}
function newUser(){const advisorOptions=state.data.team.map(t=>`<option value="${esc(t.id)}" data-branch="${esc(t.branchId)}" data-region="${esc(t.region)}">${esc(t.name)} · ${esc(t.id)}</option>`).join('');formModal('Add CRM account',`<form id="newUserForm" class="crm-form"><label>Display name<input name="name" required></label><label>Username<input name="username" required minlength="3" pattern="[A-Za-z0-9._-]+"></label><label>Role<select name="role"><option value="STAFF">Staff</option><option value="BRANCH_MANAGER">Branch Manager</option><option value="REGION_MANAGER">Regional Manager</option><option value="ADMIN">Administrator</option></select></label><label>Region<select name="region"><option value="EAST_MALAYSIA">East Malaysia</option><option value="WEST_MALAYSIA">West Malaysia</option></select></label><label>Sales advisor<select name="saId"><option value="">Not linked</option>${advisorOptions}</select></label><label>Branch ID<input name="branchId" placeholder="BR-SWK-KCH"></label><label class="form-wide">Temporary password<input name="password" minlength="10" placeholder="Leave blank to generate automatically"></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Create account</button></div><p class="form-wide notice" id="formMessage">The new user must change the temporary password after first sign-in.</p></form>`);const f=document.getElementById('newUserForm');f.saId.onchange=()=>{const o=f.saId.selectedOptions[0];if(o?.dataset.branch)f.branchId.value=o.dataset.branch;if(o?.dataset.region)f.region.value=String(o.dataset.region).includes('WEST')?'WEST_MALAYSIA':'EAST_MALAYSIA'};f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{const saved=await post('createUser',Object.fromEntries(new FormData(f)));showTemporaryPassword('Account created',f.username.value,saved.temporaryPassword);loadedResources.delete('users');await refreshUsers()}catch(x){msg.textContent=x.message;btn.disabled=false}}}
function editUser(u){const advisorOptions=`<option value="">Not linked</option>${state.data.team.map(t=>`<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.id)}</option>`).join('')}`;formModal('Edit CRM account',`<form id="editUserForm" class="crm-form"><label>Display name<input name="name" value="${esc(u.name)}" required></label><label>Username<input name="username" value="${esc(u.username)}" required></label><label>Role<select name="role"><option value="STAFF">Staff</option><option value="BRANCH_MANAGER">Branch Manager</option><option value="REGION_MANAGER">Regional Manager</option><option value="ADMIN">Administrator</option></select></label><label>Region<select name="region"><option value="EAST_MALAYSIA">East Malaysia</option><option value="WEST_MALAYSIA">West Malaysia</option></select></label><label>Sales advisor<select name="saId">${advisorOptions}</select></label><label>Branch ID<input name="branchId" value="${esc(u.branchId||'')}"></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save account</button></div><p class="form-wide notice" id="formMessage">Role and scope changes take effect at the next login.</p></form>`);const f=document.getElementById('editUserForm');f.role.value=u.role;f.region.value=u.region==='WEST_MALAYSIA'?'WEST_MALAYSIA':'EAST_MALAYSIA';f.saId.value=u.saId||'';f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('editUser',{accountId:u.id,...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await refreshUsers()}catch(x){msg.textContent=x.message;btn.disabled=false}}}
function changePassword(required=false){formModal(required?'Set your new password':'Change password',`<form id="changePasswordForm" class="crm-form"><label class="form-wide">Current password<input name="currentPassword" type="password" required></label><label>New password<input name="newPassword" type="password" minlength="10" required></label><label>Confirm new password<input name="confirmPassword" type="password" minlength="10" required></label><div class="form-wide form-actions">${required?'':'<button type="button" class="secondary" data-cancel>Cancel</button>'}<button type="submit">Save new password</button></div><p class="form-wide notice" id="formMessage">Use at least 10 characters. Your password is never stored as readable text.</p></form>`);const f=document.getElementById('changePasswordForm');if(!required)f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const msg=document.getElementById('formMessage'),btn=f.querySelector('[type=submit]');if(f.newPassword.value!==f.confirmPassword.value){msg.textContent='New passwords do not match';return}btn.disabled=true;try{await post('changeOwnPassword',{currentPassword:f.currentPassword.value,newPassword:f.newPassword.value});state.user.mustChangePassword=false;document.querySelector('.drawer-backdrop').remove();alert('Password changed successfully.')}catch(x){msg.textContent=x.message;btn.disabled=false}}}
function showTemporaryPassword(title,username,password){formModal(title,`<div class="temporary-password"><p>Give this temporary login to the user through a secure channel. It will not be shown again.</p><label>Username<input value="${esc(username)}" readonly></label><label>Temporary password<input value="${esc(password)}" readonly></label><button data-copy-password>Copy login details</button></div>`);document.querySelector('[data-copy-password]').onclick=async e=>{await navigator.clipboard.writeText(`Username: ${username}\nTemporary password: ${password}`);e.target.textContent='Copied'}}
async function refreshUsers(){const response=await get('users');state.data.users=response.records||[];loadedResources.add('users');state.view='users';render()}
async function migrateLegacyUsers(){const button=document.querySelector('[data-migrate-users]');if(!confirm('Import legacy Vercel accounts into Admin Users & Access?'))return;button.disabled=true;try{const result=await post('migrateLegacyAccounts',{});alert(`${result.migrated} legacy account(s) imported. Existing passwords remain valid.`);await refreshUsers()}catch(error){alert(error.message);button.disabled=false}}
function bindUsers(){document.querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>editUser(state.data.users.find(x=>x.id===b.dataset.editUser)));document.querySelectorAll('[data-reset-user]').forEach(b=>b.onclick=async()=>{const u=state.data.users.find(x=>x.id===b.dataset.resetUser);b.disabled=true;try{const saved=await post('resetUserPassword',{accountId:u.id});showTemporaryPassword('Password reset',u.username,saved.temporaryPassword)}catch(x){alert(x.message)}finally{b.disabled=false}});document.querySelectorAll('[data-unlock-user]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await post('unlockUser',{accountId:b.dataset.unlockUser});await refreshUsers()}catch(x){alert(x.message);b.disabled=false}});document.querySelectorAll('[data-toggle-user]').forEach(b=>b.onclick=async()=>{const u=state.data.users.find(x=>x.id===b.dataset.toggleUser);if(!confirm(`${u.loginEnabled?'Disable':'Enable'} ${u.username}?`))return;b.disabled=true;try{await post('setUserEnabled',{accountId:u.id,enabled:!u.loginEnabled});await refreshUsers()}catch(x){alert(x.message);b.disabled=false}})}
function simple(title,desc,headers,rows){app.innerHTML=head(title,desc)+`<section class="panel table-card"><table class="data-table"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows||empty(headers.length)}</tbody></table></section>`}
function inboxTable(rows){const manager=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Time</th><th>Customer</th><th>Message</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>${rows.map(x=>{const status=String(x.status).toUpperCase(),staffCanHandle=manager||!x.humanRequired||status==='ASSIGNED_TO_STAFF';return `<tr class="${x.humanRequired?'handover-row':''}"><td>${esc(when(x.time))}</td><td><strong>${esc(x.customer)}</strong><small>${esc(x.phone)}</small></td><td>${esc(x.message)}</td><td>${pill(x.status,!x.humanRequired)}</td><td>${esc(x.assignedSa||'Manager queue')}</td><td><div class="row-actions"><button class="row-action secondary" data-customer-profile data-lead-id="${esc(x.leadId||'')}" data-application-id="${esc(x.applicationId||'')}" data-phone="${esc(x.phone||'')}">Customer 360</button>${staffCanHandle?`<button class="row-action whatsapp-action" data-inbox-reply="${esc(x.id)}">Reply</button>`:'<span class="pill">Waiting for Manager</span>'}${manager&&status==='HUMAN_HANDOVER_REQUIRED'?`<button class="row-action" data-take-handover="${esc(x.id)}">Manager take over</button><button class="row-action secondary" data-assign-handover="${esc(x.id)}">Assign staff</button>`:''}${status!=='RESOLVED'&&(manager||status==='ASSIGNED_TO_STAFF')?`<button class="row-action secondary" data-resolve-handover="${esc(x.id)}">Resolve</button>`:''}</div></td></tr>`}).join('')||empty(6)}</tbody></table></div>`}
function inbox(){const human=state.data.inbox.filter(x=>x.humanRequired);app.innerHTML=head('Customer Inbox',state.user?.role==='STAFF'?'Only conversations assigned to your SA ID are visible.':'Human handovers arrive in the Manager queue before staff assignment.')+`<div class="metric-grid">${metric('Human handovers',human.length,'Manager controlled')}${metric('Visible messages',state.data.inbox.length,'Your permitted scope')}</div><div class="security-banner"><div><strong>WhatsApp Business manual test mode</strong><p>Replies open in WhatsApp Business now. When Meta Cloud is connected, the same reply button will send through the API.</p></div><button data-record-reply>Record customer reply</button></div><section class="panel">${inboxTable(state.data.inbox)}</section>`;document.querySelector('[data-record-reply]').onclick=()=>recordCustomerReply();bindMessaging()}
function outbox(){app.innerHTML=head('Message Outbox','Manual WhatsApp Business and future Meta Cloud messages use one controlled queue.')+`<div class="security-banner"><div><strong>Manual WhatsApp ready</strong><p>Open WhatsApp, send the prepared message, then mark it sent so the audit trail stays complete.</p></div><button data-new-message>New message</button></div><section class="panel table-card"><table class="data-table"><thead><tr><th>Time</th><th>Recipient</th><th>Message</th><th>Lead / Application</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.data.outbox.map(x=>`<tr><td>${esc(when(x.time))}</td><td>${esc(x.recipient)}</td><td>${esc(x.message)}</td><td>${esc(x.leadId||x.applicationId)}</td><td>${pill(x.status,String(x.status).toUpperCase()!=='FAILED')}</td><td><div class="row-actions"><button class="row-action secondary" data-customer-profile data-lead-id="${esc(x.leadId||'')}" data-application-id="${esc(x.applicationId||'')}" data-phone="${esc(x.recipient||'')}">Customer 360</button>${String(x.status).toUpperCase()==='MANUAL_PENDING'?`<button class="row-action whatsapp-action" data-open-outbox="${esc(x.id)}">Open WhatsApp</button><button class="row-action" data-mark-sent="${esc(x.id)}">Mark sent</button>`:''}</div></td></tr>`).join('')||empty(6)}</tbody></table></section>`;document.querySelector('[data-new-message]').onclick=()=>manualWhatsApp();bindMessaging()}
const customerOptions=()=>{const applications=state.data.applications.filter(a=>!a.demo),represented=new Set(applications.map(a=>a.leadId));return applications.map(a=>`<option value="${esc(a.id)}">${esc(a.customer)} · ${esc(a.phone)} · ${esc(a.product||'Motor pending')}</option>`).join('')+state.data.leads.filter(l=>!l.demo&&!represented.has(l.id)).map(l=>`<option value="${esc(l.id)}">${esc(l.name)} · ${esc(l.phone)} · Lead</option>`).join('')};
function customerTarget(value){const appRecord=state.data.applications.find(a=>a.id===value),leadRecord=state.data.leads.find(l=>l.id===value);return appRecord?{leadId:appRecord.leadId,applicationId:appRecord.id,phone:appRecord.phone,name:appRecord.customer}:leadRecord?{leadId:leadRecord.id,applicationId:leadRecord.applicationId||'',phone:leadRecord.phone,name:leadRecord.name}:null}
function manualWhatsApp(target){const selected=target?.id?target:null;formModal('Reply customer',`<form id="manualWhatsAppForm" class="crm-form"><label class="form-wide">Customer<select name="customer" ${selected?'disabled':''}>${selected?`<option value="${esc(selected.id)}">${esc(selected.customer||selected.name||selected.phone)}</option>`:customerOptions()}</select></label><label class="form-wide">Phone number<input name="phone" value="${esc(selected?.phone||'')}" required></label><label>Reply type<select name="messageType"><option value="TEXT">Normal reply</option><option value="TEMPLATE">Approved Meta template</option></select></label><label>Template language<input name="language" value="en_US"></label><label class="form-wide template-field" hidden>Approved template name<input name="templateName"></label><label class="form-wide">Message<textarea name="message" rows="6" required placeholder="Type the customer reply here"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Open WhatsApp Business</button></div><p class="form-wide notice" id="formMessage">The message is recorded in CRM before WhatsApp opens. Meta Cloud will use this same reply screen later; approved templates are supported for conversations outside the service window.</p></form>`);const f=document.getElementById('manualWhatsAppForm'),templateField=f.querySelector('.template-field');if(state.user?.whatsappMode==='CLOUD')f.querySelector('[type=submit]').textContent='Send WhatsApp reply';f.messageType.onchange=()=>{templateField.hidden=f.messageType.value!=='TEMPLATE';f.templateName.required=f.messageType.value==='TEMPLATE'};const applyTarget=()=>{const t=selected||customerTarget(f.customer.value);if(t)f.phone.value=t.phone||''};if(!selected)f.customer.onchange=applyTarget;applyTarget();f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage'),t=selected||customerTarget(f.customer.value),manualWindow=state.user?.whatsappMode==='MANUAL'?window.open('about:blank','_blank'):null;btn.disabled=true;try{const saved=await post('sendCustomerMessage',{leadId:t?.leadId||selected?.leadId||'',applicationId:t?.applicationId||selected?.applicationId||'',phone:f.phone.value,message:f.message.value,messageType:f.messageType.value,templateName:f.templateName.value,language:f.language.value});if(saved.mode==='MANUAL'&&saved.whatsappUrl){if(manualWindow)manualWindow.location=saved.whatsappUrl;else window.location.href=saved.whatsappUrl}else manualWindow?.close();document.querySelector('.drawer-backdrop').remove();await refreshMessaging('outbox')}catch(error){manualWindow?.close();msg.textContent=error.message;btn.disabled=false}}}
function recordCustomerReply(target){const selected=target?.id?target:null;formModal('Record customer reply',`<form id="recordReplyForm" class="crm-form"><label class="form-wide">Customer<select name="customer" ${selected?'disabled':''}>${selected?`<option value="${esc(selected.id)}">${esc(selected.customer||selected.name||selected.phone)}</option>`:customerOptions()}</select></label><label class="form-wide">Phone number<input name="phone" value="${esc(selected?.phone||'')}" required></label><label class="form-wide">Customer message<textarea name="message" rows="5" required></textarea></label><label class="form-wide checkbox-line"><input name="requiresManager" type="checkbox"> Customer requests Manager / human handover</label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save customer reply</button></div><p class="form-wide notice" id="formMessage">Human handovers go to the Manager queue. Staff only sees customers assigned to their own SA ID.</p></form>`);const f=document.getElementById('recordReplyForm');const applyTarget=()=>{const t=selected||customerTarget(f.customer.value);if(t)f.phone.value=t.phone||''};if(!selected)f.customer.onchange=applyTarget;applyTarget();f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage'),t=selected||customerTarget(f.customer.value);btn.disabled=true;try{await post('recordManualReply',{leadId:t?.leadId||selected?.leadId||'',applicationId:t?.applicationId||selected?.applicationId||'',phone:f.phone.value,message:f.message.value,requiresManager:f.requiresManager.checked});document.querySelector('.drawer-backdrop').remove();await refreshMessaging('inbox')}catch(error){msg.textContent=error.message;btn.disabled=false}}}
function requestHandover(target){formModal('Request Manager handover',`<form id="handoverRequestForm" class="crm-form"><label class="form-wide">Customer<input value="${esc(target.customer||target.name||target.phone)}" disabled></label><label class="form-wide">Reason<textarea name="reason" rows="5" required placeholder="Explain why Manager assistance is required"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Send to Manager queue</button></div><p class="form-wide notice" id="formMessage">The responsible Branch or Regional Manager will take over or assign this customer to a Staff member.</p></form>`);const f=document.getElementById('handoverRequestForm');f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('requestHumanHandover',{leadId:target.leadId,applicationId:target.applicationId||target.id,phone:target.phone,reason:f.reason.value});document.querySelector('.drawer-backdrop').remove();await refreshMessaging('workbench')}catch(error){msg.textContent=error.message;btn.disabled=false}}}
function assignHandover(item){const options=state.data.team.map(t=>`<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.id)} · ${esc(t.branch)}</option>`).join('');formModal('Assign human handover',`<form id="assignHandoverForm" class="crm-form"><label class="form-wide">Customer<input value="${esc(item.customer)}" disabled></label><label class="form-wide">Assign Staff<select name="saId" required><option value="">Select staff</option>${options}</select></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Assign customer</button></div><p class="form-wide notice" id="formMessage">After assignment, only that Staff member and authorized Managers can see and handle the customer.</p></form>`);const f=document.getElementById('assignHandoverForm');f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('assignHandover',{messageId:item.id,saId:f.saId.value});document.querySelector('.drawer-backdrop').remove();await loadMessagingView()}catch(error){msg.textContent=error.message;btn.disabled=false}}}
async function updateHandover(item,status){if(!confirm(status==='RESOLVED'?`Mark ${item.customer} handover resolved?`:`Manager take over ${item.customer}?`))return;try{await post('updateHandover',{messageId:item.id,status});await loadMessagingView()}catch(error){alert(error.message)}}
async function refreshMessaging(view){const [inboxData,outboxData,dashboardData]=await Promise.all([optional('inbox'),optional('outbox'),get('dashboard')]);state.data.inbox=inboxData.records||[];state.data.outbox=outboxData.records||[];state.summary=dashboardData.summary||state.summary;loadedResources.add('inbox');loadedResources.add('outbox');state.view=view||state.view;document.getElementById('inboxBadge').textContent=state.summary.unreadInbox||0;document.getElementById('workBadge').textContent=state.summary.needsAttention||0;document.querySelector('[aria-label="Notifications"] em').textContent=state.summary.needsAttention||0;render()}
async function loadMessagingView(){await refreshMessaging(state.view)}
function bindMessaging(){bindCustomerProfileButtons();document.querySelectorAll('[data-inbox-reply]').forEach(button=>button.onclick=()=>manualWhatsApp(state.data.inbox.find(x=>x.id===button.dataset.inboxReply)));document.querySelectorAll('[data-take-handover]').forEach(button=>button.onclick=()=>updateHandover(state.data.inbox.find(x=>x.id===button.dataset.takeHandover),'MANAGER_IN_PROGRESS'));document.querySelectorAll('[data-assign-handover]').forEach(button=>button.onclick=()=>assignHandover(state.data.inbox.find(x=>x.id===button.dataset.assignHandover)));document.querySelectorAll('[data-resolve-handover]').forEach(button=>button.onclick=()=>updateHandover(state.data.inbox.find(x=>x.id===button.dataset.resolveHandover),'RESOLVED'));document.querySelectorAll('[data-open-outbox]').forEach(button=>button.onclick=()=>{const item=state.data.outbox.find(x=>x.id===button.dataset.openOutbox),phone=String(item.recipient||'').replace(/\D/g,'').replace(/^0/,'60');window.open(`https://wa.me/${phone}?text=${encodeURIComponent(item.message||'')}`,'_blank','noopener')});document.querySelectorAll('[data-mark-sent]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await post('markOutboxSent',{outboxId:button.dataset.markSent});await refreshMessaging('outbox')}catch(error){alert(error.message);button.disabled=false}})}
function catalogTable(rows){const admin=state.user?.role==='ADMIN';return `<div class="table-card"><table class="data-table"><thead><tr><th>Motor & Admin actions</th><th>Category</th><th>Image</th><th>Stock check</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.brand+' '+x.model)}</strong><small>${esc(x.variant)} · ${esc(x.id)}</small>${admin?`<div class="inline-admin-actions"><button class="row-action" data-edit-catalog="${esc(x.id)}">Edit</button><button class="row-action secondary" data-toggle-catalog="${esc(x.id)}">${x.active?'Disable':'Restore'}</button></div>`:''}</td><td>${pretty(x.category)}<small>${pretty(x.tier)}</small></td><td>${x.image?`<img src="${esc(x.image)}" alt="${esc(x.brand+' '+x.model)}" class="catalog-thumb">`:x.imageUrl?'Waiting for approval':'No image'}</td><td>${pretty(x.stock)}<small>${esc(x.branchAvailability||x.warehouseAvailability||'Confirm with branch')}</small></td><td>${pill(x.active?'Active':'Inactive',x.active)}<small>${x.imageApproved?'Image approved':'Image not approved'}</small></td></tr>`).join('')||empty(5)}</tbody></table></div>`}
function catalog(){const admin=state.user?.role==='ADMIN';app.innerHTML=head('Motor Catalog',admin?'Add, edit, approve images and activate motorcycle models directly in CRM.':'Approved active motorcycle models. Catalog changes are controlled by Administrator.')+`<div class="smart-toolbar"><input id="catalogSearch" placeholder="Search brand, model, category or Catalog ID"><div class="toolbar-spacer"></div>${admin?'<button class="primary" data-new-catalog>+ Add motor model</button>':''}</div><section class="panel" id="catalogResults">${catalogTable(state.data.catalog)}</section>`;document.getElementById('catalogSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('catalogResults').innerHTML=catalogTable(state.data.catalog.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q)));bindCatalog()};if(admin)document.querySelector('[data-new-catalog]').onclick=()=>editCatalogItem();bindCatalog()}
function bindCatalog(){document.querySelectorAll('[data-edit-catalog]').forEach(button=>button.onclick=()=>editCatalogItem(state.data.catalog.find(x=>x.id===button.dataset.editCatalog)));document.querySelectorAll('[data-toggle-catalog]').forEach(button=>button.onclick=()=>toggleCatalogItem(state.data.catalog.find(x=>x.id===button.dataset.toggleCatalog)))}
async function toggleCatalogItem(item){const enabled=!item.active;if(!confirm(`${enabled?'Restore':'Disable'} ${item.brand} ${item.model}?`))return;try{await post('setCatalogItemEnabled',{catalogId:item.id,enabled});await refreshCatalog()}catch(error){alert(error.message)}}
async function refreshCatalog(){const response=await get('catalog');state.data.catalog=response.records||[];loadedResources.add('catalog');state.view='catalog';render()}
function editCatalogItem(item={}){const editing=Boolean(item.id);formModal(editing?'Edit motor catalog':'Add motor model',`<form id="catalogForm" class="crm-form"><label>Brand<input name="brand" value="${esc(item.brand||'')}" required></label><label>Model<input name="model" value="${esc(item.model||'')}" required></label><label>Variant<input name="variant" value="${esc(item.variant||'Standard')}"></label><label>Category<input name="category" value="${esc(item.category||'MOPED')}" required placeholder="MOPED, CUB, SCOOTER"></label><label>Fuel type<select name="fuel"><option value="PETROL">Petrol</option></select></label><label>Popularity tier<select name="tier"><option value="PRIMARY">Primary</option><option value="SECONDARY">Secondary</option><option value="ON_REQUEST">On request</option></select></label><label>Stock check mode<select name="stock"><option value="CHECK_BRANCH">Check branch</option><option value="CHECK_WAREHOUSE">Check warehouse</option><option value="CONFIRMED_AVAILABLE">Confirmed available</option><option value="UNAVAILABLE">Unavailable</option></select></label><label>Catalog status<select name="active"><option value="TRUE">Active</option><option value="FALSE">Inactive</option></select></label><label class="form-wide">Product page URL<input name="productPageUrl" type="url" value="${esc(item.productPageUrl||'')}"></label><label class="form-wide">Image URL<input name="imageUrl" type="url" value="${esc(item.imageUrl||'')}"></label><label>Image approval<select name="imageApproved"><option value="FALSE">Not approved</option><option value="TRUE">Approved</option></select></label><label>Search keywords<input name="searchKeywords" value="${esc(item.searchKeywords||'')}"></label><label class="form-wide">Malay image caption<textarea name="imageCaption" rows="3">${esc(item.imageCaption||'')}</textarea></label><label>Branch availability<input name="branchAvailability" value="${esc(item.branchAvailability||'')}"></label><label>Warehouse availability<input name="warehouseAvailability" value="${esc(item.warehouseAvailability||'')}"></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing?'Save catalog changes':'Add motor model'}</button></div><p class="form-wide notice" id="formMessage">Only Administrator can save. Inactive models remain in the audit record but are hidden from other users.</p></form>`);const f=document.getElementById('catalogForm');f.tier.value=item.tier||'PRIMARY';f.stock.value=item.stock||'CHECK_BRANCH';f.active.value=item.id?(item.active?'TRUE':'FALSE'):'TRUE';f.imageApproved.value=item.imageApproved?'TRUE':'FALSE';f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('[type=submit]'),message=document.getElementById('formMessage');button.disabled=true;try{await post('saveCatalogItem',{catalogId:item.id||'',...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await refreshCatalog()}catch(error){message.textContent=error.message;button.disabled=false}}}
function pricingTable(rows){const admin=state.user?.role==='ADMIN';return `<div class="table-card"><table class="data-table"><thead><tr><th>Motor & Admin actions</th><th>Zone</th><th>Standard financing</th><th>Promotion</th><th>Validity</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.brand+' '+x.model)}</strong><small>${esc(x.variant)} · ${esc(x.id)}</small>${admin?`<div class="inline-admin-actions"><button class="row-action" data-edit-pricing="${esc(x.id)}">Edit</button><button class="row-action secondary" data-toggle-pricing="${esc(x.id)}">${x.active?'Disable price':'Enable price'}</button>${x.promotion?`<button class="row-action secondary" data-toggle-promotion="${esc(x.id)}">${x.promotionActive?'Disable promotion':'Enable promotion'}</button>`:''}</div>`:''}</td><td>${pretty(x.zone)}</td><td>${money(x.baseDeposit||x.deposit)} deposit<small>${money(x.year3)} / ${money(x.year4)} / ${money(x.year5)} for 3 / 4 / 5 years</small></td><td><strong>${esc(x.promotion||'No promotion')}</strong><small>${x.promotionDeposit?money(x.promotionDeposit)+' deposit':''}${x.promotionStart||x.promotionEnd?` · ${esc(x.promotionStart||'Any time')} to ${esc(x.promotionEnd||'No end')}`:''}</small></td><td>${esc(x.effective||'No start')}<small>to ${esc(x.effectiveTo||'No end')}</small></td><td>${pill(x.active?x.status:'Inactive',x.active&&x.status==='APPROVED')}<small>${x.promotion?`Promotion: ${pretty(x.promotionStatus)} · ${x.promotionActive?'Enabled':'Disabled'}`:'Standard pricing'}</small></td></tr>`).join('')||empty(6)}</tbody></table></div>`}
function pricing(){const admin=state.user?.role==='ADMIN';app.innerHTML=head('Loan Pricing & Promotions',admin?'Add or edit approved customer pricing and promotions directly in CRM. Cash and selling prices remain excluded.':'Customer-safe approved pricing only. Cash and selling prices are excluded.')+`<div class="smart-toolbar"><input id="pricingSearch" placeholder="Search motor, zone, promotion or Pricing ID"><div class="toolbar-spacer"></div>${admin?'<button class="primary" data-new-pricing>+ Add price / promotion</button>':''}</div><section class="panel" id="pricingResults">${pricingTable(state.data.pricing)}</section>`;document.getElementById('pricingSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('pricingResults').innerHTML=pricingTable(state.data.pricing.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q)));bindPricing()};if(admin)document.querySelector('[data-new-pricing]').onclick=()=>editPricingPromotion();bindPricing()}
function bindPricing(){document.querySelectorAll('[data-edit-pricing]').forEach(button=>button.onclick=()=>editPricingPromotion(state.data.pricing.find(x=>x.id===button.dataset.editPricing)));document.querySelectorAll('[data-toggle-pricing]').forEach(button=>button.onclick=()=>togglePricingItem(state.data.pricing.find(x=>x.id===button.dataset.togglePricing),'price'));document.querySelectorAll('[data-toggle-promotion]').forEach(button=>button.onclick=()=>togglePricingItem(state.data.pricing.find(x=>x.id===button.dataset.togglePromotion),'promotion'))}
async function togglePricingItem(item,type){const enabled=type==='price'?!item.active:!item.promotionActive,label=type==='price'?'price':'promotion';if(!confirm(`${enabled?'Enable':'Disable'} ${item.brand} ${item.model} ${label}?`))return;try{await post(type==='price'?'setPricingEnabled':'setPromotionEnabled',{pricingId:item.id,enabled});await refreshPricing()}catch(error){alert(error.message)}}
async function refreshPricing(){const response=await get('pricing');state.data.pricing=response.records||[];loadedResources.add('pricing');state.view='pricing';render()}
function editPricingPromotion(item={}){const editing=Boolean(item.id),catalogOptions=state.data.catalog.map(x=>`<option value="${esc(x.id)}">${esc(x.brand+' '+x.model+' '+x.variant)} · ${esc(x.id)}${x.active?'':' · INACTIVE'}</option>`).join('');formModal(editing?'Edit price and promotion':'Add price and promotion',`<form id="pricingForm" class="crm-form"><h3 class="form-wide">Motor and standard financing</h3><label class="form-wide">Catalog motorcycle<select name="catalogId" required><option value="">Select a motor model</option>${catalogOptions}</select></label><label>Price zone<input name="zone" list="priceZones" value="${esc(item.zone||'EAST_MALAYSIA')}" required><datalist id="priceZones"><option value="ALL_BRANCHES"><option value="WEST_MALAYSIA"><option value="EAST_MALAYSIA"><option value="SARAWAK"><option value="BR-WM-PJ"><option value="BR-EM-SATOK"><option value="BR-EM-BATU_KAWA"><option value="BR-EM-KOTA_SAMARAHAN"><option value="BR-EM-BINTULU"></datalist></label><label>Standard deposit (RM)<input name="deposit" type="number" min="0" step="0.01" value="${esc(item.baseDeposit??item.deposit??'')}" required></label><label>Monthly 3 years (RM)<input name="year3" type="number" min="0" step="0.01" value="${esc(item.year3||'')}" required></label><label>Monthly 4 years (RM)<input name="year4" type="number" min="0" step="0.01" value="${esc(item.year4||'')}" required></label><label>Monthly 5 years (RM)<input name="year5" type="number" min="0" step="0.01" value="${esc(item.year5||'')}" required></label><label>Pricing enabled<select name="active"><option value="TRUE">Enabled</option><option value="FALSE">Disabled</option></select></label><label>Quote approval<select name="quoteStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label>Effective from<input name="effectiveFrom" type="date" value="${esc(item.effective||'')}"></label><label>Effective to<input name="effectiveTo" type="date" value="${esc(item.effectiveTo||'')}"></label><label class="form-wide">Internal notes<textarea name="internalNotes" rows="2">${esc(item.internalNotes||'')}</textarea></label><h3 class="form-wide">Promotion</h3><label>Promotion name<input name="promotionName" value="${esc(item.promotion||'')}"></label><label>Promotion deposit (RM)<input name="promotionDeposit" type="number" min="0" step="0.01" value="${esc(item.promotionDeposit||'')}"></label><label>Promotion start<input name="promotionStart" type="date" value="${esc(item.promotionStart||'')}"></label><label>Promotion end<input name="promotionEnd" type="date" value="${esc(item.promotionEnd||'')}"></label><label>Promotion enabled<select name="promotionActive"><option value="FALSE">Disabled</option><option value="TRUE">Enabled</option></select></label><label>Promotion approval<select name="promotionStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label class="form-wide">Promotion notes<textarea name="promotionNotes" rows="3">${esc(item.promotionNotes||'')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing?'Save price / promotion':'Add price / promotion'}</button></div><p class="form-wide notice" id="formMessage">A promotion is customer-visible only when it is enabled, approved and within its date range. Every change is written to Activity & Audit.</p></form>`);const f=document.getElementById('pricingForm');f.catalogId.value=item.catalogId||'';f.active.value=item.id?(item.active?'TRUE':'FALSE'):'FALSE';f.quoteStatus.value=item.status||'DRAFT';f.promotionActive.value=item.promotionActive?'TRUE':'FALSE';f.promotionStatus.value=item.promotionStatus||'DRAFT';f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('[type=submit]'),message=document.getElementById('formMessage');button.disabled=true;try{await post('savePricingPromotion',{pricingId:item.id||'',...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await refreshPricing()}catch(error){message.textContent=error.message;button.disabled=false}}}
function team(){const canManage=state.user?.role==='ADMIN';app.innerHTML=head('Branches & Team','Active sales advisors and lead acceptance. Administrator can pause or resume automatic AI-exception assignment for each Staff member.')+`<div class="security-banner"><div><strong>${state.data.team.filter(x=>String(x.accepting).toUpperCase()==='TRUE').length} Staff accepting leads</strong><p>Paused Staff remain active and keep their existing assigned customers, but will not receive new automatic assignments.</p></div></div><div class="table-card"><table class="data-table"><thead><tr><th>SA ID</th><th>Name</th><th>Branch</th><th>Region</th><th>Accepting leads</th><th>Last assigned</th>${canManage?'<th>Admin action</th>':''}</tr></thead><tbody>${state.data.team.map(x=>{const accepting=String(x.accepting).toUpperCase()==='TRUE';return `<tr><td>${esc(x.id)}</td><td><strong>${esc(x.name)}</strong></td><td>${esc(x.branch)}</td><td>${pretty(x.region)}</td><td>${pill(accepting?'Yes':'Paused',accepting)}</td><td>${esc(when(x.lastAssigned))}</td>${canManage?`<td><button class="row-action ${accepting?'secondary':''}" data-toggle-accepting="${esc(x.id)}">${accepting?'Pause new leads':'Resume new leads'}</button></td>`:''}</tr>`}).join('')||empty(canManage?7:6)}</tbody></table></div>`;bindTeam()}
function bindTeam(){document.querySelectorAll('[data-toggle-accepting]').forEach(button=>button.onclick=async()=>{const member=state.data.team.find(x=>x.id===button.dataset.toggleAccepting),accepting=String(member?.accepting).toUpperCase()==='TRUE';if(!member||!confirm(`${accepting?'Pause':'Resume'} new automatic lead assignments for ${member.name}?`))return;button.disabled=true;try{await post('setAdvisorAccepting',{saId:member.id,accepting:!accepting});const response=await get('team');state.data.team=response.records||[];loadedResources.add('team');state.view='team';render()}catch(error){alert(error.message);button.disabled=false}})}
function activity(){simple('Activity & Audit','Operational events for the permitted regional scope.',['Time','Activity','Lead','Application','Description','Actor'],state.data.activity.map(x=>`<tr><td>${esc(when(x.time))}</td><td>${pretty(x.type)}</td><td>${esc(x.leadId)}</td><td>${esc(x.applicationId)}</td><td>${esc(x.description)}</td><td>${esc(x.actor)}</td></tr>`).join(''))}
function settingsLegacy(){
  const pricingAmountReady=value=>{const text=String(value??'').trim();return text!==''&&Number.isFinite(Number(text))&&Number(text)>=0};
  const approvedPricingMissingFields=price=>[['Deposit',price.baseDeposit??price.deposit],['3 years',price.year3],['4 years',price.year4],['5 years',price.year5]].filter(([,value])=>!pricingAmountReady(value)).map(([label])=>label);
  const integrationCards=state.data.integrations.map(integration=>{
    const ready=integration.reportingReady||integration.automaticActionsEnabled;
    return `<article class="report-card integration-readiness-card"><div class="integration-readiness-head"><div><span class="eyebrow">${esc(integration.id)}</span><h3>${esc(integration.name)}</h3></div>${pill(integration.status,ready)}</div><p>${esc(integration.description)}</p><dl><div><dt>Mode</dt><dd>${pretty(integration.mode)}</dd></div><div><dt>Automatic actions</dt><dd>${integration.automaticActionsEnabled?'Enabled':'Safely disabled'}</dd></div><div><dt>Future reports</dt><dd>${integration.reportingReady?'Live data enabled':'Waiting for connection'}</dd></div></dl><small>${esc(integration.requiredNext)}</small></article>`;
  }).join('')||'<article class="report-card"><h3>Integration readiness</h3><p>Status is unavailable. Automatic actions remain disabled.</p></article>';
  const syntheticRows=(state.data.qa||[]).map(record=>[record.type,record.name,record.id]);
  const activeImageIssues=state.data.catalog.filter(item=>item.active&&(!item.imageApproved||!item.imageUrl));
  const approvedPricingGaps=state.data.pricing.filter(price=>price.active&&String(price.status).toUpperCase()==='APPROVED'&&approvedPricingMissingFields(price).length);
  const passwordSetupGaps=state.data.users.filter(user=>user.loginEnabled&&!user.passwordConfigured);
  const branchEntries=[...new Map(state.data.team.filter(member=>member.branchId).map(member=>[member.branchId,member.branch||member.branchId])).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  const managedBranches=new Set(state.data.users.filter(user=>['BRANCH_SUPERVISOR','BRANCH_MANAGER'].includes(user.role)&&user.loginEnabled).map(user=>user.branchId).filter(Boolean));
  const missingManagerBranches=branchEntries.filter(([branchId])=>!managedBranches.has(branchId));
  const pendingIntegrations=state.data.integrations.filter(integration=>!integration.automaticActionsEnabled);
  const readinessItems=[
    ['Branch Manager coverage',missingManagerBranches.length?missingManagerBranches.length+' branches need an owner':'Complete',missingManagerBranches.length?'Owner confirmation required':'Every active branch has a Manager login',!missingManagerBranches.length],
    ['Active catalog images',activeImageIssues.length?activeImageIssues.length+' item needs attention':'Complete',activeImageIssues.length?'Open Motor Catalog to add or approve the image':'Every active model has an approved image',!activeImageIssues.length],
    ['Approved pricing completeness',approvedPricingGaps.length?approvedPricingGaps.length+' approved row needs attention':'Complete',approvedPricingGaps.length?'Open Loan Pricing and complete deposit plus 3/4/5-year instalments':'All active approved quotes are complete',!approvedPricingGaps.length],
    ['Account password readiness',passwordSetupGaps.length?passwordSetupGaps.length+' enabled accounts need setup':'Complete',passwordSetupGaps.length?'Open Users & Access and reset each affected account password':'Every enabled account has a secure CRM-managed password',!passwordSetupGaps.length],
    ['Synthetic QA isolation',syntheticRows.length+' records isolated','Excluded from daily workspaces, dashboard and business reports; retained only as traceable Admin evidence',true],
    ['External production connections',pendingIntegrations.length?pendingIntegrations.length+' waiting':'Complete',pendingIntegrations.length?'Meta/LMS remain safely disabled until approved credentials exist':'All approved external connections are live',!pendingIntegrations.length]
  ];
  const readinessCards=readinessItems.map(item=>`<article class="readiness-item ${item[3]?'complete':'attention'}"><div>${pill(item[3]?'READY':'ACTION NEEDED',item[3])}<h4>${esc(item[0])}</h4></div><strong>${esc(item[1])}</strong><p>${esc(item[2])}</p></article>`).join('');
  const missingManagerRows=missingManagerBranches.map(([id,name])=>[name,id,'Owner name and account required']);
  const imageIssueRows=activeImageIssues.map(item=>[[item.brand,item.model,item.variant].filter(Boolean).join(' '),item.id,item.imageUrl?'Approval required':'Image URL required']);
  const pricingIssueRows=approvedPricingGaps.map(price=>[[price.brand,price.model,price.variant].filter(Boolean).join(' '),pretty(price.zone),approvedPricingMissingFields(price).join(', ')]);
  const passwordIssueRows=passwordSetupGaps.map(user=>[user.name,user.username,pretty(user.role),'Reset password']);
  app.innerHTML=head('System Settings','Production safety, data quality, AI workflow, password and integration readiness.')+
    `<div class="security-banner"><div><strong>Account security</strong><p>Five failed attempts lock an account for 15 minutes. Password reset, disable and role changes invalidate old sessions immediately.</p></div><button data-change-password>Change password</button></div>
    ${state.user?.role==='ADMIN'?`<section class="panel go-live-panel"><div class="panel-head"><div><h3>Go-live readiness</h3><p>Only active production data is treated as a blocker. Inactive history and synthetic QA records do not distort business reports.</p></div><button class="secondary" data-download-readiness>Download checklist</button></div><div class="readiness-grid">${readinessCards}</div><div class="quality-detail-grid"><article class="report-card"><h3>Branches missing a Manager</h3>${adminReportTable(['Branch','Branch ID','Required action'],missingManagerRows)}</article><article class="report-card"><h3>Active catalog image issues</h3>${adminReportTable(['Motor','Catalog ID','Required action'],imageIssueRows)}</article><article class="report-card"><h3>Approved pricing gaps</h3>${adminReportTable(['Motor','Zone','Missing'],pricingIssueRows)}</article><article class="report-card"><h3>Isolated synthetic QA records</h3>${adminReportTable(['Type','Name','Record ID'],syntheticRows)}</article></div><div class="readiness-actions"><button class="secondary" data-open-quality="users">Open Users & Access</button><button class="secondary" data-open-quality="catalog">Open Motor Catalog</button><button class="secondary" data-open-quality="pricing">Open Loan Pricing</button></div></section>`:''}
    <section class="panel integration-readiness-panel"><div class="panel-head"><div><h3>External integration readiness</h3><p>Only safe status is shown. Tokens, secrets and passwords are never displayed.</p></div></div><div class="integration-readiness-grid">${integrationCards}</div></section>
    <div class="security-banner"><div><strong>AI-first case ownership</strong><p>Normal leads remain unassigned while AI follows up and collects documents. Complete cases move directly to Ready for LMS. Only incomplete documents or failed AI follow-ups are round-robin assigned to Staff.</p></div></div>
    <div class="security-banner"><div><strong>Human handover control</strong><p>Explicit customer requests for a human enter the Manager queue. Staff only handles AI exceptions assigned to their own SA ID.</p></div></div>
    <div class="security-banner"><div><strong>Role visibility</strong><p>Admin sees all company leads; Regional Managers see their region; Branch Managers see leads assigned to their branch; Staff sees only cases assigned to their SA ID.</p></div></div>`;
  document.querySelector('[data-change-password]').onclick=()=>changePassword(false);
  if(state.user?.role==='ADMIN'){
    document.querySelector('[data-download-readiness]').onclick=()=>downloadReportCsv([['JomKaki CRM Go-Live Readiness'],['Generated',new Date().toISOString()],[],['Area','Status','Required action'],...readinessItems.map(item=>[item[0],item[1],item[2]]),[],['Branches missing a Manager'],['Branch','Branch ID','Required action'],...missingManagerRows,[],['Active catalog image issues'],['Motor','Catalog ID','Required action'],...imageIssueRows,[],['Approved pricing gaps'],['Motor','Zone','Missing'],...pricingIssueRows,[],['Isolated synthetic QA records'],['Type','Name','Record ID'],...syntheticRows],'jomkaki-go-live-readiness');
    document.querySelectorAll('[data-open-quality]').forEach(button=>button.onclick=()=>document.querySelector(`[data-view="${button.dataset.openQuality}"]`)?.click());
  }
}
function formModal(title,body){document.querySelector('.drawer-backdrop')?.remove();document.body.insertAdjacentHTML('beforeend',`<div class="drawer-backdrop"><aside class="drawer"><header class="drawer-head"><div><h2>${title}</h2><small>Staff manual entry</small></div><button class="modal-close" data-close>×</button></header><div class="drawer-body">${body}</div></aside></div>`);document.querySelector('[data-close]').onclick=()=>document.querySelector('.drawer-backdrop').remove()}
function newApplication(){const motorOptions=catalogOptions();formModal('New customer application',`<form id="manualApplicationForm" class="crm-form">
<h3 class="form-wide">Customer details</h3><label>Customer name<input name="customerName" required></label><label>Phone number<input name="phone" required placeholder="+60..."></label><label>IC number<input name="applicantIcNumber" autocomplete="off"></label><label>Email<input name="email" type="email"></label><label class="form-wide">Home address<textarea name="homeAddress" rows="2"></textarea></label><label>Region<select name="region" required><option value="WEST_MALAYSIA">West Malaysia</option><option value="EAST_MALAYSIA">East Malaysia</option></select></label><label>State<input name="state"></label><label>City / area<input name="city"></label>
<h3 class="form-wide">Employment & income</h3><label>Employer name<input name="employerName"></label><label>Job position<input name="jobPosition"></label><label>Employer phone<input name="employerPhone"></label><label>Employment months<input name="employmentDurationMonths" type="number" min="0"></label><label>Basic salary (RM)<input name="basicSalary" type="number" min="0" step="0.01"></label><label>Salary payment method<input name="salaryPaymentMethod"></label><label>Occupation category<input name="occupationCategory"></label><label class="form-wide">Employer address<textarea name="employerAddress" rows="2"></textarea></label>
<h3 class="form-wide">Motorcycle & loan</h3><label class="form-wide">Motorcycle from catalog<select name="catalogId" required><option value="">Select an active motor model</option>${motorOptions}</select></label><label>Loan tenure<select name="tenure"><option value="">Not selected</option><option value="3">3 years</option><option value="4">4 years</option><option value="5">5 years</option></select></label><label>Bank account available<select name="bankAccountAvailable"><option value="">Unknown</option><option value="YES">Yes</option><option value="NO">No</option></select></label><label>Direct Debit status<select name="directDebitStatus"><option value="NOT_STARTED">Not started</option><option value="PENDING">Pending</option><option value="READY">Ready</option><option value="COMPLETED">Completed</option></select></label><label>Agreement status<select name="agreementStatus"><option value="NOT_STARTED">Not started</option><option value="PENDING">Pending</option><option value="READY">Ready</option><option value="SIGNED">Signed</option></select></label>
<h3 class="form-wide">References</h3><label>Reference 1 name<input name="reference1Name"></label><label>Reference 1 phone<input name="reference1Phone"></label><label>Reference 1 relationship<input name="reference1Relationship"></label><label>Reference 2 name<input name="reference2Name"></label><label>Reference 2 phone<input name="reference2Phone"></label><label>Reference 2 relationship<input name="reference2Relationship"></label>
<h3 class="form-wide">Assignment & readiness</h3><label>Branch ID<input name="branchId"></label><label>SA ID<input name="saId"></label><label>Next follow-up<input name="nextFollowUp" type="datetime-local"></label><label class="form-wide">Missing documents<input name="missingDocuments" value="IC_FRONT, IC_BACK, INCOME_PROOF"></label><label class="form-wide">Missing application fields<input name="missingApplicationFields"></label><label class="form-wide">Internal notes<textarea name="notes" rows="3"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Create draft application</button></div><p class="form-wide notice" id="formMessage">Creates a CRM draft only. IC is protected after saving; LMSPRO and automatic WhatsApp are not triggered.</p></form>`);const f=document.getElementById('manualApplicationForm');if(state.user?.role!=='ADMIN'){f.region.value=state.user.region;f.region.disabled=true}if(state.user?.role==='STAFF'){f.saId.value=state.user.saId;f.saId.disabled=true;f.branchId.value=state.user.branchId;f.branchId.disabled=true}if(state.user?.role==='BRANCH_MANAGER'){f.branchId.value=state.user.branchId;f.branchId.disabled=true}f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage'),data=Object.fromEntries(new FormData(f));data.region=f.region.value;if(state.user?.role==='STAFF'){data.saId=state.user.saId;data.branchId=state.user.branchId}if(state.user?.role==='BRANCH_MANAGER')data.branchId=state.user.branchId;btn.disabled=true;try{const saved=await post('createApplication',data);msg.textContent=`Created ${saved.applicationId}`;document.querySelector('.drawer-backdrop').remove();await load()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
function uploadDocument(a){formModal('Upload customer document',`<form id="documentUploadForm" class="crm-form"><label>Application<input value="${esc(a.id)}" disabled></label><label>Document type<select name="documentType" required><option value="IC_FRONT">IC front</option><option value="IC_BACK">IC back</option><option value="INCOME_PROOF">Income proof</option><option value="BANK_STATEMENT">Bank statement</option><option value="DRIVING_LICENSE">Driving licence</option><option value="OTHER">Other</option></select></label><label class="form-wide">Choose document<input name="file" type="file" accept="image/*,.pdf" required></label><label class="form-wide">Remarks<textarea name="remarks" rows="3"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Upload for AI check</button></div><p class="form-wide notice" id="formMessage">Maximum 4 MB. The file is stored securely in SharePoint and queued for AI checking; Staff is involved only if AI raises an exception.</p></form>`);const f=document.getElementById('documentUploadForm');f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage'),file=f.file.files[0];btn.disabled=true;try{await post('uploadDocument',{applicationId:a.id,leadId:a.leadId,documentType:f.documentType.value,remarks:f.remarks.value,file:{name:file.name,type:file.type,data:await fileData(file)}});document.querySelector('.drawer-backdrop').remove();await load()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
function editApplication(a){const advisorOptions=`<option value="">Unassigned</option>${state.data.team.map(t=>`<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.id)}</option>`).join('')}`;formModal('Manage application',`<form id="applicationEditForm" class="crm-form"><label>Current stage<select name="stage"><option value="APPLICATION_DETAILS_PENDING">Application details pending</option><option value="DOCUMENT_COLLECTION">Document collection</option><option value="DOCUMENT_VERIFICATION">Document verification</option><option value="CREDIT_ASSESSMENT">Credit assessment</option><option value="BRANCH_HANDOVER">Branch handover</option><option value="RECOVERY_PENDING">Recovery pending</option><option value="COMPLETED">Completed</option></select></label><label>Status<select name="status"><option value="DRAFT">Draft</option><option value="IN_PROGRESS">In progress</option><option value="MANUAL_REVIEW">Manual review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label><label>Assigned sales advisor<select name="saId">${advisorOptions}</select></label><label>Branch ID<input name="branchId" value="${esc(a.branch||'')}"></label><label>Next follow-up<input name="nextFollowUp" type="datetime-local" value="${esc(String(a.nextFollowUp||'').slice(0,16))}"></label><label>AI exception review required<select name="reviewRequired"><option value="FALSE">No</option><option value="TRUE">Yes</option></select></label><label class="form-wide">Missing documents<input name="missingDocuments" value="${esc(a.missingDocuments||'')}"></label><label class="form-wide">Handover / exception reason<textarea name="handoverReason" rows="3"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save changes</button></div><p class="form-wide notice" id="formMessage">Every change is recorded in Activity & Audit.</p></form>`);const f=document.getElementById('applicationEditForm');f.stage.value=a.stage||'APPLICATION_DETAILS_PENDING';f.status.value=a.status||'DRAFT';f.saId.value=a.sa==='Unassigned'?'':a.sa;f.reviewRequired.value=String(a.reviewRequired).toUpperCase()==='TRUE'?'TRUE':'FALSE';if(state.user?.role==='STAFF'){['stage','status','saId','branchId','reviewRequired','handoverReason'].forEach(name=>f.elements[name].disabled=true);document.getElementById('formMessage').textContent='Staff may update follow-up dates and missing-document notes on assigned AI exceptions only. Manager approval controls stage, status, assignment and exception decisions.'}f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('updateApplication',{applicationId:a.id,...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await load();state.view='applications';render()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
function editApplicantProfile(a){const input=(label,name,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value||'')}" ${extra}></label>`;formModal('Applicant 360 profile',`<form id="applicantProfileForm" class="crm-form profile-form"><h3 class="form-wide">Customer details</h3>${input('Applicant name','applicantName',a.customer,'text','required')}${input('Phone number','phone',a.phone,'tel','required')}${input('IC number','applicantIcNumber','','text','placeholder="Leave blank to keep existing IC"')}${input('Email','email',a.email,'email')}${input('Home address','homeAddress',a.homeAddress)}<h3 class="form-wide">Employment & income</h3>${input('Employer name','employerName',a.employerName)}${input('Job position','jobPosition',a.jobPosition)}${input('Employer phone','employerPhone',a.employerPhone,'tel')}${input('Employment months','employmentDurationMonths',a.employmentDurationMonths,'number','min="0"')}${input('Basic salary (RM)','basicSalary',a.basicSalary,'number','min="0" step="0.01"')}${input('Salary payment method','salaryPaymentMethod',a.salaryPaymentMethod)}${input('Occupation category','occupationCategory',a.occupationCategory)}${input('Employer address','employerAddress',a.employerAddress)}<h3 class="form-wide">Motorcycle & loan</h3>${input('Motor brand','productBrand',a.brand,'text','required')}${input('Motor model','productModel',a.model,'text','required')}<label>Loan tenure<select name="loanTenureYears"><option value="">Not selected</option><option value="3">3 years</option><option value="4">4 years</option><option value="5">5 years</option></select></label><label>Bank account available<select name="bankAccountAvailable"><option value="">Unknown</option><option value="YES">Yes</option><option value="NO">No</option></select></label><label>Direct Debit status<select name="directDebitStatus"><option value="">Not started</option><option value="PENDING">Pending</option><option value="READY">Ready</option><option value="COMPLETED">Completed</option></select></label><label>Agreement status<select name="agreementStatus"><option value="">Not started</option><option value="PENDING">Pending</option><option value="READY">Ready</option><option value="SIGNED">Signed</option></select></label><input type="hidden" name="productCategory" value="MOTORCYCLE"><h3 class="form-wide">References</h3>${input('Reference 1 name','reference1Name',a.reference1Name)}${input('Reference 1 phone','reference1Phone',a.reference1Phone,'tel')}${input('Reference 1 relationship','reference1Relationship',a.reference1Relationship)}${input('Reference 2 name','reference2Name',a.reference2Name)}${input('Reference 2 phone','reference2Phone',a.reference2Phone,'tel')}${input('Reference 2 relationship','reference2Relationship',a.reference2Relationship)}<label class="form-wide">Missing application fields<textarea name="missingApplicationFields" rows="3">${esc(a.missingApplicationFields||'')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save Applicant 360</button></div><p class="form-wide notice" id="formMessage">IC is masked after saving. Every update is recorded in Activity & Audit.</p></form>`);const f=document.getElementById('applicantProfileForm');[['loanTenureYears',a.tenure],['bankAccountAvailable',a.bankAccountAvailable],['directDebitStatus',a.directDebitStatus],['agreementStatus',a.agreementStatus]].forEach(([n,v])=>{if(v&&f.elements[n])f.elements[n].value=String(v).toUpperCase()});f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('updateApplicantProfile',{applicationId:a.id,...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await load();state.view='applications';render()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
const editApplicantProfileLegacy=editApplicantProfile;
editApplicantProfile=async function(a){try{await ensureCatalogForForms();editApplicantProfileLegacy(a);const f=document.getElementById('applicantProfileForm'),brandLabel=f.elements.productBrand.closest('label'),modelLabel=f.elements.productModel.closest('label'),motorLabel=document.createElement('label');motorLabel.className='form-wide';motorLabel.innerHTML=`Motorcycle from catalog<select name="catalogId" required><option value="">Select an active motor model</option>${catalogOptions(a)}</select>`;brandLabel.replaceWith(motorLabel);modelLabel.remove();document.getElementById('formMessage').textContent='Motorcycle must come from the active Motor Catalog. IC is masked after saving and every update is audited.'}catch(error){alert(error.message)}};
function reviewDocument(d){formModal('Resolve AI document exception',`<form id="documentReviewForm" class="crm-form"><label>Document<input value="${esc(d.fileName||d.type||d.id)}" disabled></label><label>Verification<select name="verification"><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option></select></label><label>Quality<select name="quality"><option value="PENDING_REVIEW">Pending review</option><option value="GOOD">Good</option><option value="POOR">Poor / resubmission needed</option></select></label><label class="form-wide">Resolution remarks<textarea name="remarks" rows="4">${esc(d.remarks||'')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save exception decision</button></div><p class="form-wide notice" id="formMessage">Use this only when AI could not verify the file. The decision and Manager identity are written to Activity & Audit.</p></form>`);const f=document.getElementById('documentReviewForm');f.verification.value=['VERIFIED','REJECTED'].includes(String(d.verification).toUpperCase())?String(d.verification).toUpperCase():'PENDING';f.quality.value=['GOOD','POOR'].includes(String(d.quality).toUpperCase())?String(d.quality).toUpperCase():'PENDING_REVIEW';f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('reviewDocument',{documentId:d.id,...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await load();state.view='documents';render()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
function drawer(title,subtitle,body){document.querySelector('.drawer-backdrop')?.remove();document.body.insertAdjacentHTML('beforeend',`<div class="drawer-backdrop"><aside class="drawer"><header class="drawer-head"><div><h2>${title}</h2><small>${subtitle}</small></div><button class="modal-close" data-close>×</button></header><div class="drawer-body">${body}</div></aside></div>`);document.querySelector('[data-close]').onclick=()=>document.querySelector('.drawer-backdrop').remove()}
function openLead(id){const l=state.data.leads.find(x=>x.id===id);if(!l)return;const apps=state.data.applications.filter(a=>a.leadId===id);drawer(esc(l.name),`${esc(l.id)} · ${esc(l.phone)}`,`<div class="detail-grid">${[['Motor selected',l.model],['Lead status',pretty(l.status)],['Application',l.applicationId||'Not created'],['Loan tenure',l.tenure?l.tenure+' years':'Not selected'],['Assigned SA',l.sa],['Branch',l.branch||'Pending']].map(x=>`<div class="detail-card"><span>${x[0]}</span><strong>${esc(x[1])}</strong></div>`).join('')}</div><h3>Related applications</h3>${applicationTable(apps)}<p class="notice">Read-only view. Updates continue through approved workflows.</p>`);bind()}
function profileBlock(title,items){return `<section class="profile-section"><h3>${title}</h3><div class="detail-grid">${items.map(([label,value])=>`<div class="detail-card"><span>${label}</span><strong>${esc(value||'Not provided')}</strong></div>`).join('')}</div></section>`}
function openApp(id){const a=state.data.applications.find(x=>x.id===id);if(!a)return;const docs=state.data.documents.filter(d=>d.applicationId===id||(!d.applicationId&&d.leadId===a.leadId)),events=state.data.activity.filter(x=>x.applicationId===id).slice(0,12);const required=['IC_FRONT','IC_BACK','INCOME_PROOF'],received=new Set(docs.map(d=>String(d.type).toUpperCase())),checklist=required.map(type=>`<div class="check-row"><span>${received.has(type)?'✓':'○'}</span><strong>${pretty(type)}</strong>${pill(received.has(type)?'Received':'Missing',received.has(type))}</div>`).join('');drawer(esc(a.customer),`${esc(a.id)} · ${esc(a.product||'Motor pending')}`,`<div class="drawer-actions"><button class="whatsapp-action" data-whatsapp="${esc(a.id)}">Reply WhatsApp</button><button data-request-handover="${esc(a.id)}">Request Manager</button><button data-edit-profile="${esc(a.id)}">Edit Applicant 360</button><button class="secondary" data-edit-app="${esc(a.id)}">Workflow & assignment</button><button class="secondary" data-upload="${esc(a.id)}">Upload document</button></div>${profileBlock('Customer details',[['Phone',a.phone],['IC number',a.icMasked],['Email',a.email],['Home address',a.homeAddress]])}${profileBlock('Motorcycle & loan',[['Motor',a.product||'Not selected'],['Deposit',a.deposit?money(a.deposit):'Pending'],['Monthly instalment',a.monthly?money(a.monthly):'Pending'],['Tenure',a.tenure?a.tenure+' years':'Pending'],['Promotion',a.promotion],['Price zone',pretty(a.priceZone||a.region)]])}${profileBlock('Employment & income',[['Employer',a.employerName],['Job position',a.jobPosition],['Employment duration',a.employmentDurationMonths?a.employmentDurationMonths+' months':''],['Basic salary',a.basicSalary?money(a.basicSalary):''],['Salary method',a.salaryPaymentMethod],['Occupation',a.occupationCategory]])}${profileBlock('References',[['Reference 1',[a.reference1Name,a.reference1Phone,a.reference1Relationship].filter(Boolean).join(' · ')],['Reference 2',[a.reference2Name,a.reference2Phone,a.reference2Relationship].filter(Boolean).join(' · ')]])}<section class="profile-section"><h3>Documents checklist</h3><div class="checklist">${checklist}</div><div class="list">${docs.map(d=>`<div class="list-row"><div><strong>${esc(d.type||'Unclassified')}</strong><span>${esc(when(d.received||d.updated))}${d.fileName?' · '+esc(d.fileName):''}</span></div>${pill(d.verification||d.quality||d.classification||'Received',String(d.reviewRequired).toUpperCase()!=='TRUE')}</div>`).join('')||'<div class="list-row"><strong>No documents recorded yet</strong></div>'}</div></section>${profileBlock('Readiness & approval',[['Stage',pretty(a.stage)],['Status',pretty(a.status)],['Eligibility',pretty(a.eligibilityStatus)],['Bank account',pretty(a.bankAccountAvailable)],['Direct Debit',pretty(a.directDebitStatus)],['Agreement',pretty(a.agreementStatus)],['CAD status',pretty(a.cadStatus)],['LMS status',pretty(a.lmsSubmissionStatus)]])}${profileBlock('Assignment & follow-up',[['Assigned SA',a.sa],['Branch',a.branch],['Supervisor',a.assignedSupervisorId],['Next follow-up',when(a.nextFollowUp)],['Missing fields',a.missingApplicationFields],['Handover reason',a.handoverReason]])}<section class="profile-section"><h3>Application timeline</h3><div class="list">${events.map(e=>`<div class="list-row"><div><strong>${pretty(e.type)}</strong><span>${esc(when(e.time))} · ${esc(e.actor)}</span><small>${esc(e.description)}</small></div></div>`).join('')||'<div class="list-row"><strong>No activity recorded yet</strong></div>'}</div></section><p class="notice">IC is masked. Original document links and extracted identity data remain hidden. Stock, colour, approval, delivery date and final price require branch confirmation.</p>`);document.querySelector('[data-edit-profile]').onclick=()=>editApplicantProfile(a);document.querySelector('[data-edit-app]').onclick=()=>editApplication(a);document.querySelector('.drawer [data-upload]').onclick=()=>uploadDocument(a);document.querySelector('.drawer [data-whatsapp]').onclick=()=>manualWhatsApp(a);document.querySelector('.drawer [data-request-handover]').onclick=()=>requestHandover(a)}
function bind(){document.querySelectorAll('[data-lead]').forEach(b=>b.onclick=()=>openLead(b.dataset.lead));document.querySelectorAll('[data-app]').forEach(b=>b.onclick=()=>openApp(b.dataset.app));document.querySelectorAll('[data-upload]').forEach(b=>b.onclick=()=>uploadDocument(state.data.applications.find(a=>a.id===b.dataset.upload)));document.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>reviewDocument(state.data.documents.find(d=>d.id===b.dataset.review)));document.querySelectorAll('[data-whatsapp]').forEach(b=>b.onclick=()=>manualWhatsApp(state.data.applications.find(a=>a.id===b.dataset.whatsapp)));document.querySelectorAll('[data-refresh]').forEach(b=>b.onclick=async()=>{await load();await ensureViewData(state.view);render()});bindMessaging()}
async function ensureViewData(view){if(view==='workbench'){if(loadedResources.has('inbox')&&loadedResources.has('outbox'))return;app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading manager and follow-up queues…</p></div>';const [inboxData,outboxData]=await Promise.all([optional('inbox'),optional('outbox')]);state.data.inbox=inboxData.records||[];state.data.outbox=outboxData.records||[];loadedResources.add('inbox');loadedResources.add('outbox');return}if(view==='pricing'&&state.user?.role==='ADMIN'&&(!loadedResources.has('pricing')||!loadedResources.has('catalog'))){app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading catalog and promotions…</p></div>';const [pricingData,catalogData]=await Promise.all([get('pricing'),get('catalog')]);state.data.pricing=pricingData.records||[];state.data.catalog=catalogData.records||[];loadedResources.add('pricing');loadedResources.add('catalog');return}const resource={inbox:'inbox',outbox:'outbox',catalog:'catalog',pricing:'pricing',users:'users',activity:'activity',settings:'integrations'}[view];if(!resource||loadedResources.has(resource))return;app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading workspace…</p></div>';const response=resource==='users'?await get(resource):await optional(resource);state.data[resource]=response.records||[];loadedResources.add(resource)}
function render(){const documentBadge=document.getElementById('documentBadge');if(documentBadge)documentBadge.textContent=state.data.documents.length;document.querySelectorAll('.nav-item').forEach(n=>{n.classList.toggle('active',n.dataset.view===state.view);n.onclick=async()=>{state.view=n.dataset.view;await ensureViewData(state.view);render();document.getElementById('sidebar').classList.remove('open')}});({dashboard,workbench,reports,leads,applications,documents,inbox,outbox,catalog,pricing,handphoneCatalog:catalog,handphonePricing:pricing,team,users:usersAdmin,activity,settings}[state.view]||dashboard)();bind()}
document.getElementById('newLeadButton').textContent='+ New application';document.getElementById('newLeadButton').onclick=async()=>{try{await ensureCatalogForForms();newApplication()}catch(error){alert(error.message)}};document.getElementById('menuButton').onclick=()=>document.getElementById('sidebar').classList.toggle('open');
const globalSearch=document.getElementById('globalSearch');globalSearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runGlobalSearch(e.target.value).catch(error=>alert(error.message))}};document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!shell.hidden){e.preventDefault();globalSearch.focus();globalSearch.select()}});
document.getElementById('openMessageQueue').onclick=async()=>{state.view='outbox';await ensureViewData('outbox');render()};document.querySelector('[aria-label="Notifications"]').onclick=async()=>{state.view='workbench';await ensureViewData('workbench');render()};
document.getElementById('logoutButton').onclick=async()=>{await fetch('/api/logout');state.loaded=false;shell.hidden=true;gate.classList.remove('hidden');form.reset()};
form.onsubmit=async e=>{e.preventDefault();const error=document.getElementById('loginError'),button=form.querySelector('button');button.disabled=true;error.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:document.getElementById('loginUsername').value,password:document.getElementById('loginPassword').value})});if(!r.ok)throw new Error('Incorrect username or password.');if(!await load())throw new Error('Unable to load CRM data.')}catch(x){error.textContent=x.message}finally{button.disabled=false}};
setInterval(()=>{if(state.loaded&&state.user?.mustChangePassword&&!document.querySelector('.drawer-backdrop'))changePassword(true)},500);
const ensureViewDataBase=ensureViewData;
ensureViewData=async function(view){
  if(view==='reports'&&!loadedResources.has('secondHandMotors')){
    const response=await optional('secondHandMotors');
    state.data.secondHandMotors=response.records||[];
    loadedResources.add('secondHandMotors');
  }
  if(view==='settings'&&state.user?.role==='ADMIN'&&!['integrations','catalog','pricing','users','qa','channels'].every(resource=>loadedResources.has(resource))){
    app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading go-live readiness...</p></div>';
    const resources=['integrations','catalog','pricing','users','qa','channels'];
    const responses=await Promise.all(resources.map(resource=>loadedResources.has(resource)?{records:state.data[resource]||[]}:optional(resource)));
    responses.forEach((response,index)=>{state.data[resources[index]]=response.records||[];loadedResources.add(resources[index])});
    return;
  }
  const resourceView=view==='handphoneCatalog'?'catalog':view==='handphonePricing'?'pricing':view;
  return ensureViewDataBase(resourceView);
};
load();

async function loadAdminReportData(){
  const resources=['inbox','outbox','catalog','pricing','users','activity','integrations','channels','secondHandMotors'];
  const responses=await Promise.all(resources.map(async resource=>{
    if(loadedResources.has(resource))return{resource,records:state.data[resource]||[]};
    const response=await optional(resource);
    return{resource,records:response.records||[]};
  }));
  responses.forEach(result=>{
    state.data[result.resource]=result.records;
    loadedResources.add(result.resource);
  });
  syncDemoFeatureData();
}

function reportRegionKey(value){
  const normalized=String(value||'').trim().toUpperCase().replaceAll(' ','_');
  if(normalized.includes('WEST'))return'WEST_MALAYSIA';
  if(normalized.includes('EAST')||normalized.includes('SARAWAK')||normalized.includes('SABAH'))return'EAST_MALAYSIA';
  return normalized||'UNASSIGNED';
}

function reportPercent(value,total){
  return total?Math.round(value/total*100)+'%':'0%';
}

function reportDate(row,fields){
  const value=fields.map(field=>row[field]).find(Boolean);
  if(!value)return null;
  const date=new Date(value);
  return Number.isNaN(date.valueOf())?null:date;
}

function reportAgeDays(row,fields=['updated','created']){
  const date=reportDate(row,fields);
  return date?Math.max(0,Math.floor((Date.now()-date.valueOf())/86400000)):0;
}

function reportIsOpen(application){
  return !['APPROVED','COMPLETED','REJECTED','CANCELLED','CLOSED'].includes(String(application.status||application.stage).toUpperCase());
}

function reportIsOverdue(application){
  if(!reportIsOpen(application)||!application.nextFollowUp)return false;
  const followUp=new Date(application.nextFollowUp);
  return !Number.isNaN(followUp.valueOf())&&followUp.valueOf()<Date.now();
}

function reportDocumentComplete(application){
  return !!application.aiDocumentsComplete||String(application.minimumDocumentsComplete).toUpperCase()==='TRUE';
}

function reportReadyForLms(application){
  return ['READY_FOR_LMS','READY','QUEUED','SUBMITTED'].includes(String(application.lmsSubmissionStatus).toUpperCase())||reportDocumentComplete(application);
}

function reportAgingGroups(applications){
  const groups={'Today':0,'1–2 days':0,'3–7 days':0,'8–14 days':0,'15+ days':0};
  applications.forEach(application=>{
    const days=reportAgeDays(application,['updated','created']);
    if(days===0)groups['Today']++;
    else if(days<=2)groups['1–2 days']++;
    else if(days<=7)groups['3–7 days']++;
    else if(days<=14)groups['8–14 days']++;
    else groups['15+ days']++;
  });
  return groups;
}

function reportMissingDocumentGroups(applications){
  const groups={};
  applications.filter(application=>!reportDocumentComplete(application)).forEach(application=>{
    const missing=String(application.missingDocuments||'').split(/[,;|]/).map(value=>value.trim()).filter(Boolean);
    (missing.length?missing:['Not recorded']).forEach(type=>{
      const key=pretty(type);
      groups[key]=(groups[key]||0)+1;
    });
  });
  return groups;
}

function reportTrendGroups(rows,fields,days=30){
  const safeDays=Math.max(1,Number(days)||30);
  const weekly=safeDays>31;
  const groups={};
  rows.forEach(row=>{
    const date=reportDate(row,fields);
    if(!date)return;
    const age=(Date.now()-date.valueOf())/86400000;
    if(age<0||age>safeDays)return;
    const label=weekly?`Week ${Math.floor(age/7)+1}`:new Intl.DateTimeFormat('en-MY',{day:'2-digit',month:'short',timeZone:'Asia/Kuala_Lumpur'}).format(date);
    groups[label]=(groups[label]||0)+1;
  });
  return groups;
}

function reportPeriodComparison(rows,period,fields){
  const days=period==='ALL'?30:Math.max(1,Number(period)||30);
  const now=Date.now(),currentStart=now-days*86400000,previousStart=now-days*2*86400000;
  let current=0,previous=0;
  rows.forEach(row=>{
    const date=reportDate(row,fields);
    if(!date)return;
    const value=date.valueOf();
    if(value>=currentStart&&value<=now)current++;
    else if(value>=previousStart&&value<currentStart)previous++;
  });
  const change=previous?Math.round((current-previous)/previous*100):current?100:0;
  return{current,previous,change,label:`${change>0?'+':''}${change}% vs previous ${days} days`};
}

function reportObjectRows(groups){
  return Object.entries(groups).map(([label,value])=>[label,value]);
}

function reportNumber(value){
  const number=Number(String(value??'').replace(/[^0-9.-]/g,''));
  return Number.isFinite(number)?number:0;
}

function reportAverage(values){
  const numbers=values.map(reportNumber).filter(value=>value>0);
  return numbers.length?Math.round(numbers.reduce((sum,value)=>sum+value,0)/numbers.length):0;
}

function downloadOperationalReport(report){
  const rows=[
    ['JomKaki Motor CRM Operational Report'],
    ['Generated',new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date())],
    ['Period',report.period==='ALL'?'All time':'Last '+report.period+' days'],
    ['Scope',report.region||'Permitted scope'],[],
    ['Executive summary'],['Metric','Value'],...Object.entries(report.summary||{}),[],
    ['Lead trend'],['Period','Leads'],...(report.trendRows||[]),[],
    ['Open-case ageing'],['Age','Applications'],...(report.agingRows||[]),[],
    ['Missing documents'],['Document type','Applications'],...(report.documentGapRows||[])
  ];
  downloadReportCsv(rows,'jomkaki-operational-report');
}

function downloadReportCsv(rows,fileName){
  const csv=rows.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
  const blob=new Blob([new Uint8Array([0xEF,0xBB,0xBF]),csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=fileName+'-'+new Date().toISOString().slice(0,10)+'.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function reportWithin(row,period,fields){
  if(period==='ALL')return true;
  const days=Number(period);
  const date=reportDate(row,fields);
  if(!date)return false;
  return Date.now()-date.valueOf()<=days*86400000;
}

function adminGroup(rows,getter){
  return rows.reduce((result,row)=>{
    const key=pretty(getter(row)||'Unassigned');
    result[key]=(result[key]||0)+1;
    return result;
  },{});
}

function adminBars(groups,limit=12){
  const entries=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,limit);
  const max=Math.max(1,...entries.map(entry=>entry[1]));
  return '<div class="hbars">'+(entries.map(entry=>'<div class="hbar-row"><span>'+esc(entry[0])+'</span><div class="hbar"><i style="width:'+Math.round(entry[1]/max*100)+'%"></i></div><strong>'+entry[1]+'</strong></div>').join('')||'<p class="notice">No live data for this filter.</p>')+'</div>';
}

function adminReportTable(headers,rows){
  return '<div class="table-card report-table"><table class="data-table"><thead><tr>'+headers.map(header=>'<th>'+esc(header)+'</th>').join('')+'</tr></thead><tbody>'+(rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')||empty(headers.length))+'</tbody></table></div>';
}

function integrationReportCard(title,integration,liveBody,waitingText){
  const connected=Boolean(integration?.reportingReady);
  return '<section class="report-card wide integration-report-card"><div class="integration-report-head"><div><span class="eyebrow">Future-ready reporting</span><h3>'+esc(title)+'</h3></div>'+pill(integration?.status||'WAITING',connected)+'</div>'+
    (connected?liveBody:'<div class="integration-placeholder"><strong>Prepared - waiting for connection</strong><p>'+esc(waitingText)+'</p><small>'+esc(integration?.requiredNext||'Connect the approved provider credentials when available.')+'</small></div>')+
  '</section>';
}

function reportOption(value,label,current){
  return '<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(label)+'</option>';
}

function reportProductTypeKey(record={}){
  const business=String(record.businessUnit||record.productCategory||'').trim().toUpperCase();
  if(business==='HANDPHONE'||business.includes('PHONE'))return'HANDPHONE';
  const condition=String(record.motorType||record.productCondition||record.vehicleCondition||record.inventoryId||record.secondHandInventoryId||'').trim().toUpperCase();
  return /(SECOND|2ND|USED|PRE.?OWNED)/.test(condition)||record.inventoryId||record.secondHandInventoryId?'SECOND_HAND_MOTOR':'NEW_MOTOR';
}

function reportProductAllowed(record,view){
  const key=reportProductTypeKey(record);
  if(view==='ALL')return true;
  if(view==='MOTOR_TOTAL')return key==='NEW_MOTOR'||key==='SECOND_HAND_MOTOR';
  return key===view;
}

function reportProductViewLabel(view){
  return({ALL:'All products',MOTOR_TOTAL:'Total motor (New + 2nd hand)',NEW_MOTOR:'New motor',SECOND_HAND_MOTOR:'2nd hand motor',HANDPHONE:'Handphone'})[view]||'All products';
}

function downloadAdminReport(report){
  const rows=[
    ['JomKaki Motor CRM Administrator Report'],
    ['Generated',new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date())],
    ['Period',report.period==='ALL'?'All time':'Last '+report.period+' days'],
    ['Product view',reportProductViewLabel(report.productView)],
    ['Region',report.region==='ALL'?'All regions':pretty(report.region)],
    ['Branch',report.branch==='ALL'?'All branches':report.branch],
    ['Staff',report.staff==='ALL'?'All Staff':report.staff],
    ['Stage',report.stage==='ALL'?'All stages':pretty(report.stage)],
    ['2nd hand status',report.secondHandStatus==='ALL'?'All stock statuses':pretty(report.secondHandStatus)],
    ['2nd hand search',report.secondHandQuery||'All models and locations'],
    [],
    ['Executive summary'],
    ['Metric','Value'],
    ...Object.entries(report.summary),
    [],
    ['Lead and application trend'],
    ['Period','Leads','Applications'],
    ...report.trendRows,
    [],
    ['Open-case ageing'],
    ['Age','Applications'],
    ...report.agingRows,
    [],
    ['Missing document types'],
    ['Document type','Applications'],
    ...report.documentGapRows,
    [],
    ['Lead sources'],
    ['Source','Leads'],
    ...report.sourceRows,
    [],
    ['Loan application status'],
    ['Status','Applications'],
    ...report.loanStatusRows,
    [],
    ['Rejection and exception reasons'],
    ['Reason','Applications'],
    ...report.rejectionRows,
    [],
    ['2nd hand motor inventory'],
    ['Inventory ID','Motor','Year','Region','Branch','Customer location','Status','Approval status','Condition','Mileage KM','Selling price','Customer visible','Image approval','Last verified'],
    ...report.secondHandRows,
    [],
    ['Regional performance'],
    ['Region','Leads','Applications','Conversion','Documents complete','Ready for LMS','Overdue','Approved','Completed'],
    ...report.regionRows,
    [],
    ['Branch performance'],
    ['Branch','Region','Leads','Applications','Conversion','Staff','Documents complete','Ready for LMS','Overdue','Approved','Completed'],
    ...report.branchRows,
    [],
    ['Staff performance'],
    ['Staff','SA ID','Branch','Accepting leads','Leads','Applications','Documents complete','Ready for LMS','AI exceptions','Overdue','Approved','Completed','Conversion'],
    ...report.staffRows,
    [],
    ['Integration readiness'],
    ['Integration','Status','Reporting','Automatic actions','Next step'],
    ...report.integrationStatusRows,
    ...(report.metaReportingRows.length?[[],['WhatsApp Meta Cloud performance'],['Metric','Value'],...report.metaReportingRows]:[]),
    ...(report.lmsReportingRows.length?[[],['LMS submission and decision performance'],['Metric','Value'],...report.lmsReportingRows]:[])
  ];
  downloadReportCsv(rows,'jomkaki-admin-report');
}

function reportsLegacy(){
  if(state.user?.role!=='ADMIN'){
    reportsScoped();
    return;
  }
  const required=['inbox','outbox','catalog','pricing','users','activity','integrations','channels','secondHandMotors'];
  if(required.some(resource=>!loadedResources.has(resource))){
    app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading full company reports…</p></div>';
    if(!state.adminReportLoading){
      state.adminReportLoading=loadAdminReportData().finally(()=>{state.adminReportLoading=null;reports()});
    }
    return;
  }

  const period=state.reportPeriod||'ALL';
  const productView=state.reportProductView||'ALL';
  const region=state.reportRegion||'ALL';
  const branch=state.reportBranch||'ALL';
  const staff=state.reportStaff||'ALL';
  const stage=state.reportStage||'ALL';
  const secondHandStatus=state.reportSecondHandStatus||'ALL';
  const secondHandQuery=String(state.reportSecondHandQuery||'').trim().toLowerCase();
  const regionAllowed=value=>region==='ALL'||reportRegionKey(value)===region;
  const branchAllowed=value=>branch==='ALL'||value===branch;
  const staffAllowed=value=>staff==='ALL'||value===staff;
  const stageAllowed=value=>stage==='ALL'||String(value||'UNASSIGNED')===stage;
  const allLeadRegions=Object.fromEntries(state.data.leads.map(lead=>[lead.id,reportRegionKey(lead.region)]));
  const allAppRegions=Object.fromEntries(state.data.applications.map(application=>[application.id,reportRegionKey(application.region||allLeadRegions[application.leadId])]));
  const baseApplications=state.data.applications.filter(application=>!isSyntheticApplication(application)&&reportProductAllowed(application,productView)&&regionAllowed(application.region||allLeadRegions[application.leadId])&&branchAllowed(application.branch)&&staffAllowed(application.sa)&&stageAllowed(application.stage));
  const applications=baseApplications.filter(application=>reportWithin(application,period,['created','updated']));
  const baseApplicationIds=new Set(baseApplications.map(application=>application.id));
  const applicationLeadIds=new Set(applications.map(application=>application.leadId).filter(Boolean));
  const baseApplicationLeadIds=new Set(baseApplications.map(application=>application.leadId).filter(Boolean));
  const baseLeads=state.data.leads.filter(lead=>!isSyntheticLead(lead)&&(productView==='ALL'||reportProductAllowed(lead,productView)||baseApplicationLeadIds.has(lead.id))&&regionAllowed(lead.region)&&(branch==='ALL'||branchAllowed(lead.branch)||baseApplicationLeadIds.has(lead.id))&&(staff==='ALL'||staffAllowed(lead.sa)||baseApplicationLeadIds.has(lead.id))&&(stage==='ALL'||baseApplicationLeadIds.has(lead.id)));
  const leads=baseLeads.filter(lead=>reportWithin(lead,period,['created','time']));
  const baseLeadIds=new Set(baseLeads.map(lead=>lead.id));
  const recordAllowed=record=>(baseApplicationIds.has(record.applicationId)||baseLeadIds.has(record.leadId))&&regionAllowed(allAppRegions[record.applicationId]||allLeadRegions[record.leadId]);
  const documents=state.data.documents.filter(document=>recordAllowed(document)&&reportWithin(document,period,['received','updated']));
  const inbox=state.data.inbox.filter(message=>recordAllowed(message)&&reportWithin(message,period,['time']));
  const outbox=state.data.outbox.filter(message=>recordAllowed(message)&&reportWithin(message,period,['time']));
  const activity=state.data.activity.filter(event=>recordAllowed(event)&&reportWithin(event,period,['time']));
  const lmsReadyStatuses=new Set(['READY_FOR_LMS','READY','QUEUED','SUBMITTED']);
  const approvedApplications=applications.filter(application=>String(application.status).toUpperCase()==='APPROVED');
  const completedApplications=applications.filter(application=>String(application.status).toUpperCase()==='COMPLETED'||String(application.stage).toUpperCase()==='COMPLETED');
  const documentComplete=applications.filter(application=>application.aiDocumentsComplete||String(application.minimumDocumentsComplete).toUpperCase()==='TRUE');
  const readyForLms=applications.filter(application=>lmsReadyStatuses.has(String(application.lmsSubmissionStatus).toUpperCase())||application.aiDocumentsComplete);
  const aiExceptions=applications.filter(application=>application.documentNeedsReview||String(application.reviewRequired).toUpperCase()==='TRUE'||['MANUAL_REVIEW','RECOVERY_PENDING'].includes(String(application.status||application.stage).toUpperCase()));
  const humanHandovers=inbox.filter(message=>message.humanRequired);
  const failedMessages=outbox.filter(message=>['FAILED','ERROR'].includes(String(message.status).toUpperCase()));
  const unassigned=applications.filter(application=>!application.sa||application.sa==='Unassigned');
  const openApplications=applications.filter(reportIsOpen);
  const overdueFollowups=openApplications.filter(reportIsOverdue);
  const stalledApplications=openApplications.filter(application=>reportAgeDays(application,['updated','created'])>=3);
  const agingGroups=reportAgingGroups(openApplications);
  const missingDocumentGroups=reportMissingDocumentGroups(applications);
  const leadSourceGroups=adminGroup(leads,lead=>lead.source||'Not recorded');
  const rejectionReasonGroups=adminGroup(applications.filter(application=>['REJECTED','CANCELLED'].includes(String(application.status).toUpperCase())||application.rejectionReason),application=>application.rejectionReason||application.status);
  const trendDays=period==='ALL'?30:Number(period);
  const leadTrendGroups=reportTrendGroups(leads,['created','time'],trendDays);
  const applicationTrendGroups=reportTrendGroups(applications,['created','updated'],trendDays);
  const leadComparison=reportPeriodComparison(baseLeads,period,['created','time']);
  const applicationComparison=reportPeriodComparison(baseApplications,period,['created','updated']);
  const quotedApplications=applications.filter(application=>reportNumber(application.deposit)>0||reportNumber(application.monthly)>0);
  const quotedDepositTotal=quotedApplications.reduce((sum,application)=>sum+reportNumber(application.deposit),0);
  const averageDeposit=reportAverage(quotedApplications.map(application=>application.deposit));
  const averageMonthly=reportAverage(quotedApplications.map(application=>application.monthly));
  const promotionApplications=applications.filter(application=>application.promotion).length;
  const collectionDurations=documentComplete.map(application=>{
    const created=reportDate(application,['created']),completed=reportDate(application,['documentUpdated','updated']);
    return created&&completed?Math.max(0,(completed.valueOf()-created.valueOf())/86400000):0;
  }).filter(Boolean);
  const averageDocumentDays=collectionDurations.length?Math.round(collectionDurations.reduce((sum,value)=>sum+value,0)/collectionDurations.length*10)/10:0;
  const reportCatalog=state.data.catalog.filter(item=>reportProductAllowed(item,productView));
  const reportPricing=state.data.pricing.filter(price=>reportProductAllowed(price,productView));
  const activeCatalog=reportCatalog.filter(item=>item.active);
  const catalogImageIssues=reportCatalog.filter(item=>item.active&&(!item.imageApproved||!item.imageUrl));
  const activePricing=reportPricing.filter(price=>price.active&&String(price.status).toUpperCase()==='APPROVED');
  const pricingGaps=reportPricing.filter(price=>price.active&&String(price.status).toUpperCase()==='APPROVED'&&(!price.deposit||(!price.year3&&!price.month12)||(!price.year4&&!price.month24)||(!price.year5&&!price.month36)));
  const activePromotions=reportPricing.filter(price=>price.promotion&&price.promotionActive&&String(price.promotionStatus).toUpperCase()==='APPROVED');
  const handphoneCatalogReview=reportCatalog.filter(item=>String(item.businessUnit).toUpperCase()==='HANDPHONE'&&regionAllowed(item.submittedRegion||item.regionAvailability));
  const handphonePricingReview=reportPricing.filter(price=>String(price.businessUnit).toUpperCase()==='HANDPHONE'&&regionAllowed(price.submittedRegion||price.zone));
  const handphoneCatalogPending=handphoneCatalogReview.filter(item=>String(item.approvalStatus).toUpperCase()==='PENDING_APPROVAL');
  const handphonePricingPending=handphonePricingReview.filter(price=>String(price.approvalStatus).toUpperCase()==='PENDING_APPROVAL');
  const handphoneRejected=[...handphoneCatalogReview,...handphonePricingReview].filter(item=>String(item.approvalStatus).toUpperCase()==='REJECTED');
  const handphoneAdminReview=handphonePricingPending.filter(price=>price.adminReviewRequired);
  const handphoneApprovalRows=[
    ...handphoneCatalogPending.map(item=>['Catalog',[item.brand,item.model,item.variant].filter(Boolean).join(' '),pretty(item.submittedRegion||item.regionAvailability),item.submittedBy||'System','Regional Manager / Admin',item.approvalNotes||'New model, image or catalog change']),
    ...handphonePricingPending.map(price=>['Pricing',[price.brand,price.model,price.variant].filter(Boolean).join(' '),pretty(price.submittedRegion||price.zone),price.submittedBy||'System',price.adminReviewRequired?'Admin only':'Regional Manager / Admin',price.adminReviewRequired?'Below approved price floor':price.approvalNotes||'Price or promotion change'])
  ];
  const enabledAccounts=state.data.users.filter(user=>user.loginEnabled);
  const acceptingStaff=state.data.team.filter(member=>String(member.accepting).toUpperCase()==='TRUE');
  const showSecondHandReport=['ALL','MOTOR_TOTAL','SECOND_HAND_MOTOR'].includes(productView);
  const secondHandBase=showSecondHandReport?(state.data.secondHandMotors||[]).filter(motor=>
    regionAllowed(motor.region)&&branchAllowed(motor.branchId)&&
    (secondHandStatus==='ALL'||String(motor.status).toUpperCase()===secondHandStatus)&&
    (!secondHandQuery||Object.values(motor).flat().join(' ').toLowerCase().includes(secondHandQuery))
  ):[];
  const secondHandMotors=secondHandBase.filter(motor=>reportWithin(motor,period,['updated','lastVerified']));
  const secondHandAvailable=secondHandMotors.filter(motor=>String(motor.status).toUpperCase()==='AVAILABLE');
  const secondHandVisible=secondHandAvailable.filter(motor=>String(motor.approvalStatus||'APPROVED').toUpperCase()==='APPROVED'&&motor.customerVisible&&motor.imageApproved&&motor.photos?.length&&motor.location);
  const secondHandPendingApproval=secondHandMotors.filter(motor=>String(motor.approvalStatus||'APPROVED').toUpperCase()==='PENDING_APPROVAL');
  const secondHandRejected=secondHandMotors.filter(motor=>String(motor.approvalStatus||'APPROVED').toUpperCase()==='REJECTED');
  const secondHandReserved=secondHandMotors.filter(motor=>String(motor.status).toUpperCase()==='RESERVED');
  const secondHandSold=secondHandMotors.filter(motor=>String(motor.status).toUpperCase()==='SOLD');
  const secondHandStale=secondHandAvailable.filter(motor=>reportAgeDays(motor,['lastVerified','updated'])>7);
  const secondHandPhotoIssues=secondHandAvailable.filter(motor=>!motor.imageApproved||!motor.photos?.length);
  const secondHandStockValue=secondHandAvailable.reduce((sum,motor)=>sum+reportNumber(motor.price),0);
  const secondHandStatusGroups=adminGroup(secondHandMotors,motor=>motor.status||'Not recorded');
  const secondHandRegionGroups=adminGroup(secondHandMotors,motor=>reportRegionKey(motor.region));
  const secondHandRows=secondHandMotors.slice().sort((a,b)=>String(a.region).localeCompare(String(b.region))||String(a.branch).localeCompare(String(b.branch))||String(a.brand+' '+a.model).localeCompare(String(b.brand+' '+b.model))).map(motor=>[
    motor.id,[motor.brand,motor.model,motor.variant].filter(Boolean).join(' '),motor.year||'',pretty(motor.region),motor.branch||motor.branchId||'',motor.location||'',pretty(motor.status),pretty(motor.approvalStatus||'APPROVED'),motor.conditionGrade||'',motor.mileageKm||'',motor.price?`RM ${Number(motor.price).toLocaleString('en-MY')}`:'',motor.customerVisible?'Yes':'No',motor.imageApproved?'Approved':'Pending',motor.lastVerified||''
  ]);
  const productMixGroups=adminGroup(applications,application=>reportProductViewLabel(reportProductTypeKey(application)));
  const newMotorApplications=applications.filter(application=>reportProductTypeKey(application)==='NEW_MOTOR');
  const secondHandApplications=applications.filter(application=>reportProductTypeKey(application)==='SECOND_HAND_MOTOR');
  const handphoneApplications=applications.filter(application=>reportProductTypeKey(application)==='HANDPHONE');

  const regionKeys=region==='ALL'?['EAST_MALAYSIA','WEST_MALAYSIA']:[region];
  const regionRows=regionKeys.map(key=>{
    const regionalLeads=leads.filter(lead=>reportRegionKey(lead.region)===key);
    const regionalApplications=applications.filter(application=>reportRegionKey(application.region||allLeadRegions[application.leadId])===key);
    const regionalComplete=regionalApplications.filter(application=>application.aiDocumentsComplete||String(application.minimumDocumentsComplete).toUpperCase()==='TRUE');
    const regionalReady=regionalApplications.filter(application=>lmsReadyStatuses.has(String(application.lmsSubmissionStatus).toUpperCase())||application.aiDocumentsComplete);
    return[
      pretty(key),
      regionalLeads.length,
      regionalApplications.length,
      reportPercent(regionalApplications.length,regionalLeads.length),
      regionalComplete.length,
      regionalReady.length,
      regionalApplications.filter(reportIsOverdue).length,
      regionalApplications.filter(application=>String(application.status).toUpperCase()==='APPROVED').length,
      regionalApplications.filter(application=>String(application.status).toUpperCase()==='COMPLETED'||String(application.stage).toUpperCase()==='COMPLETED').length
    ];
  });

  const reportTeam=state.data.team.filter(member=>regionAllowed(member.region));
  const team=reportTeam.filter(member=>branchAllowed(member.branchId)&&staffAllowed(member.id));
  const branchNames=Object.fromEntries(state.data.team.map(member=>[member.branchId,member.branch||member.branchId]));
  const branchRegions=Object.fromEntries(state.data.team.map(member=>[member.branchId,reportRegionKey(member.region)]));
  const branchIds=[...new Set([...leads.map(lead=>lead.branch),...applications.map(application=>application.branch),...team.map(member=>member.branchId)].filter(Boolean))];
  const branchRows=branchIds.map(branchId=>{
    const branchLeads=leads.filter(lead=>lead.branch===branchId);
    const branchApplications=applications.filter(application=>application.branch===branchId);
    return[
      branchNames[branchId]||branchId,
      pretty(branchRegions[branchId]||branchApplications[0]?.region||'Unassigned'),
      branchLeads.length,
      branchApplications.length,
      reportPercent(branchApplications.length,branchLeads.length),
      team.filter(member=>member.branchId===branchId).length,
      branchApplications.filter(reportDocumentComplete).length,
      branchApplications.filter(reportReadyForLms).length,
      branchApplications.filter(reportIsOverdue).length,
      branchApplications.filter(application=>String(application.status).toUpperCase()==='APPROVED').length,
      branchApplications.filter(application=>String(application.status).toUpperCase()==='COMPLETED'||String(application.stage).toUpperCase()==='COMPLETED').length
    ];
  }).sort((a,b)=>Number(b[3])-Number(a[3])||String(a[0]).localeCompare(String(b[0])));

  const staffRows=team.map(member=>{
    const staffLeads=leads.filter(lead=>lead.sa===member.id);
    const staffApplications=applications.filter(application=>application.sa===member.id);
    return[
      member.name,
      member.id,
      member.branch,
      String(member.accepting).toUpperCase()==='TRUE'?'Yes':'No',
      staffLeads.length,
      staffApplications.length,
      staffApplications.filter(reportDocumentComplete).length,
      staffApplications.filter(reportReadyForLms).length,
      staffApplications.filter(application=>application.documentNeedsReview||String(application.reviewRequired).toUpperCase()==='TRUE').length,
      staffApplications.filter(reportIsOverdue).length,
      staffApplications.filter(application=>String(application.status).toUpperCase()==='APPROVED').length,
      staffApplications.filter(application=>String(application.status).toUpperCase()==='COMPLETED'||String(application.stage).toUpperCase()==='COMPLETED').length,
      reportPercent(staffApplications.length,staffLeads.length)
    ];
  }).sort((a,b)=>Number(b[5])-Number(a[5])||String(a[0]).localeCompare(String(b[0])));

  const summary={
    'Leads':leads.length,
    'Applications':applications.length,
    'Lead conversion':reportPercent(applications.length,leads.length),
    'Files received':documents.length,
    'Document completion':reportPercent(documentComplete.length,applications.length),
    'Ready for LMS':readyForLms.length,
    'Approved applications':approvedApplications.length,
    'Completed applications':completedApplications.length,
    'AI exceptions':aiExceptions.length,
    'Human handovers':humanHandovers.length,
    'Unassigned applications':unassigned.length,
    'Overdue follow-ups':overdueFollowups.length,
    'Stalled 3+ days':stalledApplications.length,
    'Average document collection days':averageDocumentDays,
    'Quoted deposit total':`RM ${quotedDepositTotal.toLocaleString('en-MY')}`,
    'Average monthly instalment':`RM ${averageMonthly.toLocaleString('en-MY')}`,
    'Failed messages':failedMessages.length,
    'New motor applications':newMotorApplications.length,
    '2nd hand motor applications':secondHandApplications.length,
    'Handphone applications':handphoneApplications.length,
    'Handphone catalog pending approval':handphoneCatalogPending.length,
    'Handphone pricing pending approval':handphonePricingPending.length,
    'Handphone Admin price exceptions':handphoneAdminReview.length,
    'Handphone rejected submissions':handphoneRejected.length,
    '2nd hand units':secondHandMotors.length,
    '2nd hand available':secondHandAvailable.length,
    '2nd hand AI-visible':secondHandVisible.length,
    '2nd hand pending approval':secondHandPendingApproval.length,
    '2nd hand rejected':secondHandRejected.length,
    '2nd hand available stock value':`RM ${secondHandStockValue.toLocaleString('en-MY')}`,
    '2nd hand stale over 7 days':secondHandStale.length
  };
  const trendRows=[...new Set([...Object.keys(leadTrendGroups),...Object.keys(applicationTrendGroups)])].map(label=>[label,leadTrendGroups[label]||0,applicationTrendGroups[label]||0]);
  const agingRows=reportObjectRows(agingGroups);
  const documentGapRows=reportObjectRows(missingDocumentGroups);
  const sourceRows=reportObjectRows(leadSourceGroups);
  const loanStatusRows=reportObjectRows(adminGroup(applications,application=>application.status));
  const rejectionRows=reportObjectRows(rejectionReasonGroups);
  const metaIntegration=state.data.integrations.find(integration=>integration.id==='META_CLOUD')||{};
  const lmsIntegration=state.data.integrations.find(integration=>integration.id==='LMSPRO')||{};
  const metaInbound=inbox.filter(message=>String(message.source||message.channel||'').toUpperCase().includes('META'));
  const metaOutbound=outbox.filter(message=>message.providerMessageId||String(message.routingStatus||'').toUpperCase().includes('CLOUD'));
  const metaDelivered=metaOutbound.filter(message=>message.deliveredAt||['DELIVERED','READ'].includes(String(message.status).toUpperCase()));
  const metaRead=metaOutbound.filter(message=>message.readAt||String(message.status).toUpperCase()==='READ');
  const metaReplies=metaOutbound.filter(message=>message.customerRepliedAt);
  const metaAiProcessed=metaInbound.filter(message=>message.aiProcessed||message.aiProcessedAt);
  const metaHandovers=metaInbound.filter(message=>message.humanRequired||message.humanHandoverAt);
  const lmsSubmittedApplications=applications.filter(application=>application.lmsCaseId||['SUBMITTED','PROCESSING','APPROVED','REJECTED'].includes(String(application.lmsSubmissionStatus).toUpperCase()));
  const lmsApproved=lmsSubmittedApplications.filter(application=>String(application.status).toUpperCase()==='APPROVED'||String(application.lmsSubmissionStatus).toUpperCase()==='APPROVED');
  const lmsRejected=lmsSubmittedApplications.filter(application=>String(application.status).toUpperCase()==='REJECTED'||String(application.lmsSubmissionStatus).toUpperCase()==='REJECTED');
  const lmsPending=lmsSubmittedApplications.filter(application=>!lmsApproved.includes(application)&&!lmsRejected.includes(application));
  const lmsErrors=lmsSubmittedApplications.filter(application=>application.lmsErrorCode||application.lmsErrorMessage||String(application.lmsSubmissionStatus).toUpperCase()==='ERROR');
  const lmsDecisionDurations=lmsSubmittedApplications.map(application=>{
    const submitted=reportDate(application,['submittedAt']),decision=reportDate(application,['lmsDecisionAt','approvedAt','rejectedAt']);
    return submitted&&decision?Math.max(0,(decision.valueOf()-submitted.valueOf())/86400000):null;
  }).filter(value=>value!==null);
  const averageLmsDecisionDays=lmsDecisionDurations.length?Math.round(lmsDecisionDurations.reduce((sum,value)=>sum+value,0)/lmsDecisionDurations.length*10)/10:0;
  const integrationStatusRows=state.data.integrations.map(integration=>[integration.name,integration.status,integration.reportingReady?'Live':'Waiting',integration.automaticActionsEnabled?'Enabled':'Safely disabled',integration.requiredNext]);
  const metaReportingRows=metaIntegration.reportingReady?[
    ['Cloud inbound messages',metaInbound.length],['Cloud outbound messages',metaOutbound.length],['Delivered',metaDelivered.length],['Delivery rate',reportPercent(metaDelivered.length,metaOutbound.length)],['Read',metaRead.length],['Read rate',reportPercent(metaRead.length,metaDelivered.length)],['Customer replies',metaReplies.length],['AI processed',metaAiProcessed.length],['Human handovers',metaHandovers.length]
  ]:[];
  const lmsReportingRows=lmsIntegration.reportingReady?[
    ['Submitted to LMS',lmsSubmittedApplications.length],['Pending decision',lmsPending.length],['Approved',lmsApproved.length],['Rejected',lmsRejected.length],['Submission errors',lmsErrors.length],['Average decision time',averageLmsDecisionDays+' days']
  ]:[];
  const report={period,productView,region,branch,staff,stage,secondHandStatus,secondHandQuery,summary,trendRows,agingRows,documentGapRows,sourceRows,loanStatusRows,rejectionRows,regionRows,branchRows,staffRows,integrationStatusRows,metaReportingRows,lmsReportingRows,secondHandRows,handphoneApprovalRows};
  const accountRoleRows=Object.entries(adminGroup(state.data.users,user=>user.role)).map(entry=>[entry[0],entry[1]]);
  const branchOptions=[...new Map([...reportTeam.filter(member=>member.branchId).map(member=>[member.branchId,member.branch||member.branchId]),...secondHandBase.filter(motor=>motor.branchId).map(motor=>[motor.branchId,motor.branch||motor.branchId])]).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  const staffOptions=reportTeam.filter(member=>branch==='ALL'||member.branchId===branch).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const stageOptions=[...new Set(state.data.applications.filter(application=>!isSyntheticApplication(application)&&regionAllowed(application.region||allLeadRegions[application.leadId])&&branchAllowed(application.branch)&&staffAllowed(application.sa)).map(application=>application.stage).filter(Boolean))].sort();
  const auditRows=activity.slice(0,15).map(event=>[when(event.time),pretty(event.type),event.applicationId||event.leadId||'—',event.description||'—',event.actor||'System']);

  app.innerHTML=head('Company Reports & Analytics','Administrator view across every region, branch, customer workflow, team and control record.')+
    '<div class="smart-toolbar report-toolbar"><label>Report period<select id="reportPeriod">'+
      reportOption('ALL','All time',period)+reportOption('7','Last 7 days',period)+reportOption('30','Last 30 days',period)+reportOption('90','Last 90 days',period)+
    '</select></label><label>Product view<select id="reportProductView">'+
      reportOption('ALL','All products',productView)+reportOption('MOTOR_TOTAL','Total motor (New + 2nd hand)',productView)+reportOption('NEW_MOTOR','New motor',productView)+reportOption('SECOND_HAND_MOTOR','2nd hand motor',productView)+reportOption('HANDPHONE','Handphone',productView)+
    '</select></label><label>Region<select id="reportRegion">'+
      reportOption('ALL','All regions',region)+reportOption('EAST_MALAYSIA','East Malaysia',region)+reportOption('WEST_MALAYSIA','West Malaysia',region)+
    '</select></label><label>Branch<select id="reportBranch">'+reportOption('ALL','All branches',branch)+branchOptions.map(option=>reportOption(option[0],option[1],branch)).join('')+
    '</select></label><label>Staff<select id="reportStaff">'+reportOption('ALL','All Staff',staff)+staffOptions.map(member=>reportOption(member.id,member.name+' · '+member.id,staff)).join('')+
    '</select></label><label>Stage<select id="reportStage">'+reportOption('ALL','All stages',stage)+stageOptions.map(value=>reportOption(value,pretty(value),stage)).join('')+
    '</select></label>'+(showSecondHandReport?'<label>2nd hand status<select id="reportSecondHandStatus">'+
      reportOption('ALL','All stock statuses',secondHandStatus)+reportOption('AVAILABLE','Available',secondHandStatus)+reportOption('RESERVED','Reserved',secondHandStatus)+reportOption('HOLD','Hold',secondHandStatus)+reportOption('SOLD','Sold',secondHandStatus)+reportOption('INACTIVE','Inactive',secondHandStatus)+
    '</select></label><label>2nd hand model / location<input id="reportSecondHandQuery" value="'+esc(state.reportSecondHandQuery||'')+'" placeholder="All models and locations"></label>':'')+'<div class="toolbar-spacer"></div>'+(showSecondHandReport?'<button class="secondary" data-clear-second-hand-report>Clear 2H filter</button>':'')+'<button class="secondary" data-export-admin-report>Download complete CSV</button></div>'+
    '<div class="security-banner admin-report-banner"><div><strong>Administrator company-wide visibility</strong><p>This report includes every permitted company record. Customer IC numbers, original document links, passwords and integration secrets remain protected.</p></div><span class="pill green">ALL COMPANY DATA</span></div>'+
    '<div class="metric-grid">'+
      metric('Leads',leads.length,leadComparison.label)+
      metric('Applications',applications.length,applicationComparison.label)+
      metric('Files received',documents.length,reportPercent(documentComplete.length,applications.length)+' cases complete')+
      metric('Ready for LMS',readyForLms.length,'Documents ready or queued')+
      metric('Approved',approvedApplications.length,'Loan application status')+
      metric('Completed',completedApplications.length,'Finished cases')+
      metric('AI exceptions',aiExceptions.length,'Requires exception handling')+
      metric('Human handovers',humanHandovers.length,'Manager attention')+
      metric('Unassigned',unassigned.length,'No Staff or branch owner')+
      metric('Overdue follow-ups',overdueFollowups.length,'Follow-up date has passed')+
      metric('Stalled 3+ days',stalledApplications.length,'Open applications without update')+
      metric('Average document time',averageDocumentDays+' days','Created to documents complete')+
      metric('Quoted deposits',`RM ${quotedDepositTotal.toLocaleString('en-MY')}`,averageDeposit?`RM ${averageDeposit.toLocaleString('en-MY')} average`:'No approved quote')+
      metric('Average instalment',averageMonthly?`RM ${averageMonthly.toLocaleString('en-MY')}`:'—',quotedApplications.length+' quoted applications')+
      metric('Promotions used',promotionApplications,'Applications with promotion')+
      metric('Failed messages',failedMessages.length,'Outbox recovery needed')+
      metric('New motor applications',newMotorApplications.length,'Selected product and operating filters')+
      metric('2nd hand applications',secondHandApplications.length,'Linked to a used motor record')+
      metric('Handphone applications',handphoneApplications.length,'Kept separate from motor totals')+
      metric('Phone catalog approval',handphoneCatalogPending.length,'Regional Manager or Admin review')+
      metric('Phone pricing approval',handphonePricingPending.length,handphoneAdminReview.length+' Admin price-floor exception')+
      (showSecondHandReport?metric('2nd hand units',secondHandMotors.length,'Current report filters')+
      metric('2nd hand available',secondHandAvailable.length,secondHandVisible.length+' AI-visible')+
      metric('Pending approval',secondHandPendingApproval.length,'Regional Manager or Admin review')+
      metric('Rejected submissions',secondHandRejected.length,'Branch correction required')+
      metric('2nd hand reserved',secondHandReserved.length,'Held units')+
      metric('2nd hand sold',secondHandSold.length,'Status records')+
      metric('2nd hand stock value',`RM ${secondHandStockValue.toLocaleString('en-MY')}`,'Available selling prices')+
      metric('2nd hand stale',secondHandStale.length,'Not verified for 7+ days')+
      metric('2nd hand photo issues',secondHandPhotoIssues.length,'Available but photo pending'):'')+
    '</div>'+
    '<div class="report-grid">'+
      '<section class="report-card"><h3>Product application mix</h3>'+adminBars(productMixGroups,10)+'</section>'+
      (showSecondHandReport?'<section class="report-card wide second-hand-report-card"><div class="panel-head"><div><h3>2nd hand inventory by region, branch and status</h3><p>Uses the selected period, Product view, Region, Branch, stock status and model/location filters together.</p></div></div><div class="report-split"><div><h4>Stock status</h4>'+adminBars(secondHandStatusGroups,10)+'</div><div><h4>Region</h4>'+adminBars(secondHandRegionGroups,5)+'</div></div>'+adminReportTable(['Inventory ID','Motor','Year','Region','Branch','Customer location','Status','Approval status','Condition','Mileage KM','Selling price','Customer visible','Image approval','Last verified'],secondHandRows)+'</section>':'')+
      integrationReportCard('WhatsApp Meta Cloud performance',metaIntegration,'<div class="metric-grid compact-metrics">'+
        metric('Cloud inbound',metaInbound.length,'Customer messages received')+
        metric('Cloud outbound',metaOutbound.length,'Messages sent through API')+
        metric('Delivery rate',reportPercent(metaDelivered.length,metaOutbound.length),metaDelivered.length+' delivered')+
        metric('Read rate',reportPercent(metaRead.length,metaDelivered.length),metaRead.length+' read')+
        metric('Customer replies',metaReplies.length,'Replies linked to outbound messages')+
        metric('AI processed',metaAiProcessed.length,metaHandovers.length+' human handovers')+
      '</div>','Delivery, read, reply, AI handling and human-handover metrics will activate automatically after the approved Meta Cloud connection is live.')+
      integrationReportCard('LMS submission and decision performance',lmsIntegration,'<div class="metric-grid compact-metrics">'+
        metric('Submitted',lmsSubmittedApplications.length,'Cases with an LMS reference')+
        metric('Pending decision',lmsPending.length,'Submitted and processing')+
        metric('Approved',lmsApproved.length,'LMS decisions received')+
        metric('Rejected',lmsRejected.length,'Reasons remain reportable')+
        metric('Submission errors',lmsErrors.length,'Error code and message captured')+
        metric('Average decision time',averageLmsDecisionDays+' days','Submission to final decision')+
      '</div>','Submission, financier, decision, turnaround and error metrics will activate automatically after the approved LMSPRO sandbox and production connection is live.')+
      '<section class="report-card wide"><h3>Lead and application trend</h3><div class="report-split"><div><h4>New leads</h4>'+adminBars(leadTrendGroups,period==='90'?13:31)+'</div><div><h4>New applications</h4>'+adminBars(applicationTrendGroups,period==='90'?13:31)+'</div></div></section>'+
      '<section class="report-card"><h3>Open-case ageing</h3>'+adminBars(agingGroups,10)+'</section>'+
      '<section class="report-card"><h3>Missing document types</h3>'+adminBars(missingDocumentGroups,10)+'</section>'+
      '<section class="report-card"><h3>Lead sources</h3>'+adminBars(leadSourceGroups,15)+'</section>'+
      '<section class="report-card"><h3>Customer-to-completion funnel</h3>'+adminBars({'Leads':leads.length,'Applications':applications.length,'Documents complete':documentComplete.length,'Ready for LMS':readyForLms.length,'Approved':approvedApplications.length,'Completed':completedApplications.length},20)+'</section>'+
      '<section class="report-card"><h3>Applications by stage</h3>'+adminBars(adminGroup(applications,application=>application.stage),20)+'</section>'+
      '<section class="report-card"><h3>Loan application status</h3>'+adminBars(adminGroup(applications,application=>application.status),20)+'</section>'+
      '<section class="report-card"><h3>Eligibility status</h3>'+adminBars(adminGroup(applications,application=>application.eligibilityStatus),15)+'</section>'+
      '<section class="report-card"><h3>CAD status</h3>'+adminBars(adminGroup(applications,application=>application.cadStatus),15)+'</section>'+
      '<section class="report-card"><h3>Rejection and exception reasons</h3>'+adminBars(rejectionReasonGroups,15)+'</section>'+
      '<section class="report-card"><h3>LMS submission status</h3>'+adminBars(adminGroup(applications,application=>application.lmsSubmissionStatus),20)+'</section>'+
      '<section class="report-card"><h3>Document verification status</h3>'+adminBars(adminGroup(documents,document=>document.verification||document.quality||document.classification),20)+'</section>'+
      '<section class="report-card wide"><h3>Regional performance</h3>'+adminReportTable(['Region','Leads','Applications','Conversion','Documents complete','Ready for LMS','Overdue','Approved','Completed'],regionRows)+'</section>'+
      '<section class="report-card wide"><h3>Branch performance</h3>'+adminReportTable(['Branch','Region','Leads','Applications','Conversion','Staff','Documents complete','Ready for LMS','Overdue','Approved','Completed'],branchRows)+'</section>'+
      '<section class="report-card wide"><h3>Staff workload and performance</h3>'+adminReportTable(['Staff','SA ID','Branch','Accepting leads','Leads','Applications','Documents complete','Ready for LMS','AI exceptions','Overdue','Approved','Completed','Conversion'],staffRows)+'</section>'+
      '<section class="report-card"><h3>Motorcycle demand</h3>'+adminBars(adminGroup(applications,application=>application.product),15)+'</section>'+
      '<section class="report-card"><h3>Customer inbox status</h3>'+adminBars(adminGroup(inbox,message=>message.status),15)+'</section>'+
      '<section class="report-card"><h3>Message outbox status</h3>'+adminBars(adminGroup(outbox,message=>message.status),15)+'</section>'+
      '<section class="report-card"><h3>Accounts by role</h3>'+adminReportTable(['Role','Accounts'],accountRoleRows)+'</section>'+
      '<section class="report-card wide"><h3>Catalog, pricing and access health</h3><div class="metric-grid compact-metrics">'+
        metric('Catalog models',state.data.catalog.length,activeCatalog.length+' active')+
        metric('Image issues',catalogImageIssues.length,'Missing or not approved')+
        metric('Approved prices',activePricing.length,'Active customer quotes')+
        metric('Pricing gaps',pricingGaps.length,'Missing deposit or instalment')+
        metric('Live promotions',activePromotions.length,'Approved and active')+
        metric('Phone submissions pending',handphoneCatalogPending.length+handphonePricingPending.length,handphoneAdminReview.length+' require Admin')+
        metric('Phone submissions rejected',handphoneRejected.length,'Branch correction required')+
        metric('Enabled accounts',enabledAccounts.length,state.data.users.length+' total accounts')+
        metric('Staff accepting leads',acceptingStaff.length,team.length+' visible Staff')+
        metric('Branches',branchRows.length,'Company operating branches')+
      '</div></section>'+
      '<section class="report-card wide"><h3>Handphone approval queue</h3><p>Catalog, image, price and promotion submissions stay internal until an authorised reviewer approves them.</p>'+adminReportTable(['Type','Product / storage','Region','Submitted by','Required reviewer','Reason / notes'],handphoneApprovalRows)+'</section>'+
      '<section class="report-card wide"><h3>Recent audit activity</h3>'+adminReportTable(['Time','Activity','Lead / Application','Description','Actor'],auditRows)+'</section>'+
    '</div>';

  document.getElementById('reportPeriod').onchange=event=>{state.reportPeriod=event.target.value;reports()};
  document.getElementById('reportProductView').onchange=event=>{state.reportProductView=event.target.value;reports()};
  document.getElementById('reportRegion').onchange=event=>{state.reportRegion=event.target.value;state.reportBranch='ALL';state.reportStaff='ALL';reports()};
  document.getElementById('reportBranch').onchange=event=>{state.reportBranch=event.target.value;state.reportStaff='ALL';reports()};
  document.getElementById('reportStaff').onchange=event=>{state.reportStaff=event.target.value;reports()};
  document.getElementById('reportStage').onchange=event=>{state.reportStage=event.target.value;reports()};
  document.getElementById('reportSecondHandStatus')?.addEventListener('change',event=>{state.reportSecondHandStatus=event.target.value;reports()});
  document.getElementById('reportSecondHandQuery')?.addEventListener('change',event=>{state.reportSecondHandQuery=event.target.value;reports()});
  document.querySelector('[data-clear-second-hand-report]')?.addEventListener('click',()=>{state.reportSecondHandStatus='ALL';state.reportSecondHandQuery='';reports()});
  document.querySelector('[data-export-admin-report]').onclick=()=>downloadAdminReport(report);
}

function customer360TimeValue(value){const time=new Date(value||0).valueOf();return Number.isNaN(time)?0:time}
function resolveCustomer360(identity={}){
  let application=state.data.applications.find(item=>item.id===identity.applicationId);
  let lead=state.data.leads.find(item=>item.id===(identity.leadId||application?.leadId));
  let phone=normalizePhone(identity.phone||application?.phone||lead?.phone);
  if(!lead&&phone)lead=state.data.leads.find(item=>normalizePhone(item.phone)===phone);
  if(!application&&lead)application=state.data.applications.find(item=>item.leadId===lead.id)||state.data.applications.find(item=>normalizePhone(item.phone)===normalizePhone(lead.phone));
  if(!application&&phone)application=state.data.applications.find(item=>normalizePhone(item.phone)===phone);
  if(!lead&&application)lead=state.data.leads.find(item=>item.id===application.leadId)||state.data.leads.find(item=>normalizePhone(item.phone)===normalizePhone(application.phone));
  phone=normalizePhone(phone||application?.phone||lead?.phone);
  const applications=state.data.applications.filter(item=>(lead?.id&&item.leadId===lead.id)||(phone&&normalizePhone(item.phone)===phone)||(application&&item.id===application.id)).sort((a,b)=>customer360TimeValue(b.updated||b.created)-customer360TimeValue(a.updated||a.created));
  application=application||applications[0];
  const leadIds=new Set([lead?.id,application?.leadId,...applications.map(item=>item.leadId)].filter(Boolean));
  const applicationIds=new Set([application?.id,...applications.map(item=>item.id)].filter(Boolean));
  const names=new Set([lead?.name,application?.customer,...applications.map(item=>item.customer)].filter(Boolean).map(value=>String(value).trim().toLowerCase()));
  const matches=row=>applicationIds.has(row.applicationId)||leadIds.has(row.leadId)||(phone&&normalizePhone(row.phone||row.recipient)===phone)||names.has(String(row.customer||'').trim().toLowerCase());
  return {lead,application,applications,leadIds,applicationIds,phone,matches};
}
function customer360Conversation(context){
  const incoming=state.data.inbox.filter(context.matches).map(item=>({id:item.id,direction:'incoming',actor:'Customer',message:item.message,time:item.time,status:item.status,meta:[whatsappChannelLabel(item),item.messageType,item.attachmentType].filter(Boolean).join(' | '),humanRequired:item.humanRequired}));
  const outgoing=state.data.outbox.filter(context.matches).map(item=>{const route=String(item.routingStatus||'').toUpperCase(),manual=item.manual||/(MANUAL|STAFF|HUMAN|MANAGER)/.test(route);return{id:item.id,direction:'outgoing',actor:manual?'Staff / Manager':'AI / CRM',message:item.message,time:item.time,status:item.status,meta:[whatsappChannelLabel(item),item.routingStatus,item.deliveredAt?'Delivered':'',item.readAt?'Read':''].filter(Boolean).join(' | ')}});
  return [...incoming,...outgoing].sort((a,b)=>customer360TimeValue(a.time)-customer360TimeValue(b.time));
}
function customer360ApplicationList(applications,currentId){return `<section class="customer-360-section"><div class="customer-360-section-head"><div><span>Cases</span><h3>All applications</h3></div>${pill(`${applications.length} record${applications.length===1?'':'s'}`,true)}</div><div class="customer-360-applications">${applications.map(item=>`<button class="customer-360-application ${item.id===currentId?'active':''}" data-360-application="${esc(item.id)}"><span><strong>${esc(item.id)}</strong><small>${esc(item.product||'Motor not selected')}</small></span><span>${pill(item.stage||item.status||'Open',true)}<small>${esc(when(item.updated||item.created))}</small></span></button>`).join('')||'<div class="customer-360-empty"><strong>No application created yet</strong><p>The lead and conversation remain available in this Customer 360.</p></div>'}</div></section>`}
function customer360DocumentSection(documents){
  const required=['IC_FRONT','IC_BACK','INCOME_PROOF'],received=new Set(documents.map(item=>String(item.type||'').toUpperCase()));
  const checklist=required.map(type=>`<div class="check-row"><span>${received.has(type)?'OK':'--'}</span><strong>${pretty(type)}</strong>${pill(received.has(type)?'Received':'Missing',received.has(type))}</div>`).join('');
  return `<section class="customer-360-section"><div class="customer-360-section-head"><div><span>Secure files</span><h3>Documents and AI checks</h3></div>${pill(`${documents.length} received`,documents.length>0)}</div><div class="checklist">${checklist}</div><div class="customer-360-file-list">${documents.map(item=>`<div class="customer-360-file"><div><strong>${pretty(item.type||'Unclassified')}</strong><span>${esc(item.fileName||item.mimeType||'Secure document')} | ${esc(when(item.received||item.updated))}</span><small>${esc(item.remarks||'No exception remarks')}</small></div>${pill(item.verification||item.quality||item.classification||'Received',String(item.reviewRequired).toUpperCase()!=='TRUE')}</div>`).join('')||'<div class="customer-360-empty"><strong>No documents received yet</strong><p>AI collection progress and Staff uploads will appear here automatically.</p></div>'}</div></section>`;
}
function customer360ConversationSection(messages){return `<section class="customer-360-section customer-360-conversation-section"><div class="customer-360-section-head"><div><span>One conversation</span><h3>WhatsApp, AI and human replies</h3></div>${pill(`${messages.length} message${messages.length===1?'':'s'}`,true)}</div><div class="customer-360-conversation">${messages.map(item=>`<article class="customer-360-message ${item.direction} ${item.humanRequired?'needs-human':''}"><div class="customer-360-message-meta"><strong>${esc(item.actor)}</strong><time>${esc(when(item.time))}</time></div><p>${esc(item.message||'Message content not recorded')}</p><div class="customer-360-message-status"><span>${pretty(item.status||'Recorded')}</span>${item.meta?`<small>${esc(item.meta)}</small>`:''}</div></article>`).join('')||'<div class="customer-360-empty"><strong>No conversation recorded yet</strong><p>Incoming customer messages and outgoing AI or Staff replies will stay together here.</p></div>'}</div></section>`}
function customer360ActivitySection(events){return `<section class="customer-360-section"><div class="customer-360-section-head"><div><span>Audit trail</span><h3>Complete customer activity</h3></div>${pill(`${events.length} event${events.length===1?'':'s'}`,true)}</div><div class="customer-360-timeline">${events.map(item=>`<div class="customer-360-event"><span></span><div><strong>${pretty(item.type||'Activity')}</strong><p>${esc(item.description||'Activity recorded')}</p><small>${esc(when(item.time))} | ${esc(item.actor||'System')} | ${pretty(item.status||'Completed')}</small></div></div>`).join('')||'<div class="customer-360-empty"><strong>No activity recorded yet</strong></div>'}</div></section>`}
function bindCustomer360Actions(context){
  const target=context.application||context.lead&&{...context.lead,id:context.lead.id,leadId:context.lead.id,customer:context.lead.name,applicationId:''};
  document.querySelector('[data-360-whatsapp]')?.addEventListener('click',()=>manualWhatsApp(target));
  document.querySelector('[data-360-handover]')?.addEventListener('click',()=>requestHandover(target));
  document.querySelector('[data-360-edit-profile]')?.addEventListener('click',()=>editApplicantProfile(context.application));
  document.querySelector('[data-360-workflow]')?.addEventListener('click',()=>editApplication(context.application));
  document.querySelector('[data-360-upload]')?.addEventListener('click',()=>uploadDocument(context.application));
  document.querySelectorAll('[data-360-application]').forEach(button=>button.onclick=()=>openCustomer360({applicationId:button.dataset.application}));
}
async function openCustomer360(identity={}){
  drawer('Customer 360','Loading the complete customer record...','<div class="customer-360-loading"><div class="spinner"></div><p>Joining profile, applications, documents, messages and activity...</p></div>');
  document.querySelector('.drawer')?.classList.add('customer-360-drawer');
  await ensureCustomer360Data();
  const context=resolveCustomer360(identity),lead=context.lead,application=context.application;
  if(!lead&&!application){drawer('Customer 360','Customer not found','<div class="customer-360-empty"><strong>This customer is not available in your permitted scope.</strong><p>Refresh the CRM and try again.</p></div>');return}
  const documents=state.data.documents.filter(item=>context.applicationIds.has(item.applicationId)||context.leadIds.has(item.leadId)).sort((a,b)=>customer360TimeValue(b.received||b.updated)-customer360TimeValue(a.received||a.updated));
  const messages=customer360Conversation(context);
  const events=state.data.activity.filter(context.matches).sort((a,b)=>customer360TimeValue(b.time)-customer360TimeValue(a.time));
  const name=application?.customer||lead?.name||'Customer',phone=application?.phone||lead?.phone||identity.phone||'Not provided';
  const owner=application?.sa||lead?.sa||'Unassigned',branch=application?.branch||lead?.branch||'Pending';
  const openHandover=state.data.inbox.filter(context.matches).some(item=>item.humanRequired&&String(item.status).toUpperCase()!=='RESOLVED');
  const documentComplete=String(application?.minimumDocumentsComplete).toUpperCase()==='TRUE'||application?.aiDocumentsComplete;
  const actions=`<div class="customer-360-actions"><button class="whatsapp-action" data-360-whatsapp>Reply WhatsApp</button><button data-360-handover>Request Manager</button>${application?'<button data-360-edit-profile>Edit customer</button><button class="secondary" data-360-workflow>Workflow & assignment</button><button class="secondary" data-360-upload>Upload document</button>':''}</div>`;
  const hero=`<section class="customer-360-hero"><div class="customer-360-avatar">${esc(String(name).split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase()||'JK')}</div><div class="customer-360-identity"><span>Single customer record</span><h2>${esc(name)}</h2><p>${esc(phone)}${lead?.id?` | ${esc(lead.id)}`:''}${application?.id?` | ${esc(application.id)}`:''}</p></div><div class="customer-360-hero-status">${pill(openHandover?'Human handover':'AI managed',!openHandover)}${pill(documentComplete?'Documents complete':application?.documentStatus||'Documents pending',documentComplete)}</div></section>`;
  const summary=`<div class="customer-360-summary"><div><span>Lead status</span><strong>${pretty(lead?.status||'Not created')}</strong></div><div><span>Application stage</span><strong>${pretty(application?.stage||application?.status||'Not created')}</strong></div><div><span>Owner</span><strong>${esc(owner)}</strong></div><div><span>Branch</span><strong>${esc(branch)}</strong></div><div><span>Motor</span><strong>${esc(application?.product||lead?.model||'Not selected')}</strong></div><div><span>Next follow-up</span><strong>${esc(when(application?.nextFollowUp||lead?.nextFollowUp))}</strong></div></div>`;
  const customerDetails=profileBlock('Customer and lead details',[['Phone',phone],['IC number',application?.icMasked],['Email',application?.email],['Home address',application?.homeAddress],['Lead source',lead?.source],['Region / city',[pretty(application?.region||lead?.region),lead?.city].filter(Boolean).join(' | ')],['Lead notes',lead?.notes],['Created',when(lead?.created||application?.created)]]);
  const financing=profileBlock('Motorcycle and financing',[['Motor',application?.product||lead?.model],['Deposit',application?.deposit?money(application.deposit):'Pending'],['Monthly instalment',application?.monthly?money(application.monthly):'Pending'],['Tenure',application?.tenure?`${application.tenure} years`:'Pending'],['Promotion',application?.promotion],['Price zone',pretty(application?.priceZone||application?.region||lead?.region)],['Financier',application?.financier],['Application status',pretty(application?.status)]]);
  const employment=application?profileBlock('Employment, income and references',[['Employer',application.employerName],['Job position',application.jobPosition],['Employment duration',application.employmentDurationMonths?`${application.employmentDurationMonths} months`:null],['Basic salary',application.basicSalary?money(application.basicSalary):null],['Salary method',application.salaryPaymentMethod],['Occupation',application.occupationCategory],['Reference 1',[application.reference1Name,application.reference1Phone,application.reference1Relationship].filter(Boolean).join(' | ')],['Reference 2',[application.reference2Name,application.reference2Phone,application.reference2Relationship].filter(Boolean).join(' | ')] ]):'';
  const readiness=application?profileBlock('Readiness, LMS and follow-up',[['Document status',pretty(application.documentStatus)],['Missing documents',application.missingDocuments||'None'],['Eligibility',pretty(application.eligibilityStatus)],['Bank account',pretty(application.bankAccountAvailable)],['Direct Debit',pretty(application.directDebitStatus)],['Agreement',pretty(application.agreementStatus)],['LMS case',application.lmsCaseId],['LMS status',pretty(application.lmsSubmissionStatus)],['CAD status',pretty(application.cadStatus)],['CAD remarks',application.cadRemarks],['Missing application fields',application.missingApplicationFields||'None'],['Handover reason',application.handoverReason||'None'],['Assigned supervisor',application.assignedSupervisorId],['Processing mode',pretty(application.processingMode)] ]):'';
  drawer(esc(name),`${esc(phone)} | Complete Customer 360`,`${actions}${hero}${summary}<div class="customer-360-grid"><div>${customerDetails}${financing}${employment}${readiness}</div><div>${customer360DocumentSection(documents)}${customer360ConversationSection(messages)}${customer360ApplicationList(context.applications,application?.id)}${customer360ActivitySection(events)}</div></div><p class="customer-360-security">Sensitive IC data stays masked. Secure document links are not exposed. Every item shown is already filtered by the logged-in user's permitted region, branch or assignment.</p>`);
  document.querySelector('.drawer')?.classList.add('customer-360-drawer');
  bindCustomer360Actions(context);
}
async function openLead(id){return openCustomer360({leadId:id})}
async function openApp(id){return openCustomer360({applicationId:id})}

const customer360Demos=[
  {
    id:'demo-complete',label:'AI complete - Ready for LMS',tone:'complete',
    lead:{id:'DEMO-LEAD-001',name:'Alicia Sample',phone:'60123456001',region:'EAST_MALAYSIA',source:'Facebook Ads',model:'Yamaha Y16ZR Standard',status:'QUALIFIED',applicationId:'DEMO-APP-001',applicationStatus:'READY_FOR_LMS',sa:'AI Automation',branch:'BR-EM-SATOK',city:'Kuching',notes:'Customer prefers a five-year financing plan and blue motorcycle.',nextFollowUp:'2026-08-10T10:30:00+08:00',created:'2026-08-09T09:10:00+08:00',time:'2026-08-10T09:25:00+08:00'},
    application:{id:'DEMO-APP-001',leadId:'DEMO-LEAD-001',customer:'Alicia Sample',phone:'60123456001',region:'EAST_MALAYSIA',stage:'READY_FOR_LMS',status:'DOCUMENTS_COMPLETE',sa:'AI Automation',product:'Yamaha Y16ZR Standard',brand:'Yamaha',model:'Y16ZR',variant:'Standard',tenure:'5',deposit:'1200',monthly:'318',priceZone:'EAST_MALAYSIA',promotion:'August Low Deposit',branch:'BR-EM-SATOK',nextFollowUp:'2026-08-10T10:30:00+08:00',documentStatus:'AI_VERIFIED_COMPLETE',minimumDocumentsComplete:'TRUE',missingDocuments:'',documentsReceived:3,documentNeedsReview:false,aiDocumentsComplete:true,icMasked:'******6789',homeAddress:'Tabuan Jaya, Kuching, Sarawak',email:'alicia.sample@example.com',employerName:'Borneo Retail Sdn Bhd',employmentDurationMonths:'38',jobPosition:'Store Supervisor',basicSalary:'3200',salaryPaymentMethod:'BANK_TRANSFER',occupationCategory:'SALARIED',reference1Name:'Michelle Sample',reference1Phone:'60123456011',reference1Relationship:'Sister',reference2Name:'Daniel Sample',reference2Phone:'60123456012',reference2Relationship:'Colleague',eligibilityStatus:'ELIGIBLE',bankAccountAvailable:'YES',directDebitStatus:'READY',agreementStatus:'PENDING_SIGNATURE',lmsCaseId:'PREVIEW-LMS-001',lmsSubmissionStatus:'READY_FOR_LMS',cadStatus:'NOT_SUBMITTED',cadRemarks:'Waiting for LMS API activation.',missingApplicationFields:'',handoverReason:'',assignedSupervisorId:'',processingMode:'AI_AUTOMATION',created:'2026-08-09T09:12:00+08:00',updated:'2026-08-10T09:25:00+08:00'},
    documents:[
      {id:'DEMO-DOC-001',applicationId:'DEMO-APP-001',leadId:'DEMO-LEAD-001',type:'IC_FRONT',received:'2026-08-09T09:42:00+08:00',fileName:'sample-ic-front.jpg',classification:'IC_FRONT',quality:'GOOD',verification:'VERIFIED',reviewRequired:'FALSE',remarks:'AI verified image clarity and document type.'},
      {id:'DEMO-DOC-002',applicationId:'DEMO-APP-001',leadId:'DEMO-LEAD-001',type:'IC_BACK',received:'2026-08-09T09:43:00+08:00',fileName:'sample-ic-back.jpg',classification:'IC_BACK',quality:'GOOD',verification:'VERIFIED',reviewRequired:'FALSE',remarks:'AI verified image clarity and document type.'},
      {id:'DEMO-DOC-003',applicationId:'DEMO-APP-001',leadId:'DEMO-LEAD-001',type:'INCOME_PROOF',received:'2026-08-10T09:03:00+08:00',fileName:'sample-payslip-july.pdf',classification:'INCOME_PROOF',quality:'GOOD',verification:'VERIFIED',reviewRequired:'FALSE',remarks:'Salary amount and employer matched the application.'}
    ],
    inbox:[
      {id:'DEMO-IN-001',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',customer:'Alicia Sample',phone:'60123456001',message:'Hi, I am interested in Yamaha Y16ZR. How much is the monthly payment?',status:'AI_PROCESSED',time:'2026-08-09T09:10:00+08:00',channel:'WHATSAPP',messageType:'TEXT',humanRequired:false},
      {id:'DEMO-IN-002',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',customer:'Alicia Sample',phone:'60123456001',message:'Five years is okay. I have uploaded my IC and payslip.',status:'AI_PROCESSED',time:'2026-08-10T09:04:00+08:00',channel:'WHATSAPP',messageType:'TEXT_AND_DOCUMENTS',humanRequired:false}
    ],
    outbox:[
      {id:'DEMO-OUT-001',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',recipient:'60123456001',message:'Hi Alicia. For the Yamaha Y16ZR sample quote, the estimated five-year instalment is RM318 per month with RM1,200 deposit. Final pricing and stock require branch confirmation.',status:'DELIVERED',time:'2026-08-09T09:11:00+08:00',routingStatus:'AI_AUTOMATION',deliveredAt:'2026-08-09T09:11:08+08:00',readAt:'2026-08-09T09:12:00+08:00',manual:false},
      {id:'DEMO-OUT-002',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',recipient:'60123456001',message:'Thank you. Your IC front, IC back and income proof have passed the AI checks. Your application is now ready for LMS submission.',status:'READ',time:'2026-08-10T09:25:00+08:00',routingStatus:'AI_AUTOMATION',deliveredAt:'2026-08-10T09:25:06+08:00',readAt:'2026-08-10T09:26:00+08:00',manual:false}
    ],
    activity:[
      {id:'DEMO-ACT-001',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',type:'LEAD_CREATED',description:'Lead created from Facebook campaign.',actor:'AI Intake',status:'COMPLETED',time:'2026-08-09T09:10:00+08:00'},
      {id:'DEMO-ACT-002',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',type:'DOCUMENTS_AI_VERIFIED',description:'All minimum documents passed classification and quality checks.',actor:'Document AI',status:'COMPLETED',time:'2026-08-10T09:24:00+08:00'},
      {id:'DEMO-ACT-003',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',type:'READY_FOR_LMS',description:'Application is complete and waiting for the LMS API connection.',actor:'CRM Automation',status:'COMPLETED',time:'2026-08-10T09:25:00+08:00'}
    ]
  },
  {
    id:'demo-handover',label:'AI exception - Human follow-up',tone:'attention',
    lead:{id:'DEMO-LEAD-002',name:'Jason Sample',phone:'60123456002',region:'EAST_MALAYSIA',source:'Website Enquiry',model:'Honda RS-X Winner',status:'FOLLOW_UP_REQUIRED',applicationId:'DEMO-APP-002',applicationStatus:'AI_EXCEPTION',sa:'SA-DEMO-014',branch:'BR-EM-BATU_KAWA',city:'Kuching',notes:'Customer uploaded only IC front. AI follow-up failed twice and customer requested a person.',nextFollowUp:'2026-08-10T11:00:00+08:00',created:'2026-08-08T14:20:00+08:00',time:'2026-08-10T09:40:00+08:00'},
    application:{id:'DEMO-APP-002',leadId:'DEMO-LEAD-002',customer:'Jason Sample',phone:'60123456002',region:'EAST_MALAYSIA',stage:'HUMAN_FOLLOW_UP',status:'DOCUMENTS_INCOMPLETE',sa:'SA-DEMO-014',product:'Honda RS-X Winner Standard',brand:'Honda',model:'RS-X Winner',variant:'Standard',tenure:'4',deposit:'900',monthly:'286',priceZone:'EAST_MALAYSIA',promotion:'',branch:'BR-EM-BATU_KAWA',nextFollowUp:'2026-08-10T11:00:00+08:00',documentStatus:'AI_EXCEPTION',minimumDocumentsComplete:'FALSE',missingDocuments:'IC_BACK, INCOME_PROOF',documentsReceived:1,documentNeedsReview:false,aiDocumentsComplete:false,icMasked:'******4321',homeAddress:'Pending customer confirmation',email:'',employerName:'Pending',employmentDurationMonths:'',jobPosition:'',basicSalary:'',salaryPaymentMethod:'',occupationCategory:'',reference1Name:'',reference1Phone:'',reference1Relationship:'',reference2Name:'',reference2Phone:'',reference2Relationship:'',eligibilityStatus:'PENDING_DOCUMENTS',bankAccountAvailable:'UNKNOWN',directDebitStatus:'NOT_STARTED',agreementStatus:'NOT_STARTED',lmsCaseId:'',lmsSubmissionStatus:'WAITING_FOR_AI_DOCUMENTS',cadStatus:'NOT_SUBMITTED',cadRemarks:'',missingApplicationFields:'Employment, income and references',handoverReason:'AI could not collect the remaining documents and customer requested human help.',assignedSupervisorId:'east.manager',processingMode:'AI_EXCEPTION_TO_STAFF',created:'2026-08-08T14:22:00+08:00',updated:'2026-08-10T09:40:00+08:00'},
    documents:[{id:'DEMO-DOC-004',applicationId:'DEMO-APP-002',leadId:'DEMO-LEAD-002',type:'IC_FRONT',received:'2026-08-08T14:35:00+08:00',fileName:'sample-jason-ic-front.jpg',classification:'IC_FRONT',quality:'GOOD',verification:'VERIFIED',reviewRequired:'FALSE',remarks:'IC front verified. Remaining documents are still missing.'}],
    inbox:[
      {id:'DEMO-IN-003',leadId:'DEMO-LEAD-002',applicationId:'DEMO-APP-002',customer:'Jason Sample',phone:'60123456002',message:'I want the Honda RS-X Winner. I only have my IC photo now.',status:'AI_PROCESSED',time:'2026-08-08T14:20:00+08:00',channel:'WHATSAPP',messageType:'TEXT_AND_DOCUMENT',humanRequired:false},
      {id:'DEMO-IN-004',leadId:'DEMO-LEAD-002',applicationId:'DEMO-APP-002',customer:'Jason Sample',phone:'60123456002',message:'Can a person call me? I am not sure which salary document to send.',status:'HUMAN_HANDOVER_REQUIRED',time:'2026-08-10T09:40:00+08:00',channel:'WHATSAPP',messageType:'TEXT',humanRequired:true}
    ],
    outbox:[
      {id:'DEMO-OUT-003',leadId:'DEMO-LEAD-002',applicationId:'DEMO-APP-002',recipient:'60123456002',message:'Thank you Jason. I received your IC front. Please send the IC back and your latest salary proof to continue.',status:'READ',time:'2026-08-08T14:36:00+08:00',routingStatus:'AI_AUTOMATION',deliveredAt:'2026-08-08T14:36:05+08:00',readAt:'2026-08-08T14:38:00+08:00',manual:false},
      {id:'DEMO-OUT-004',leadId:'DEMO-LEAD-002',applicationId:'DEMO-APP-002',recipient:'60123456002',message:'No problem. I have sent your case to the Manager queue. A Staff member will follow up after assignment.',status:'DELIVERED',time:'2026-08-10T09:40:30+08:00',routingStatus:'AI_HANDOVER',deliveredAt:'2026-08-10T09:40:38+08:00',manual:false}
    ],
    activity:[
      {id:'DEMO-ACT-004',leadId:'DEMO-LEAD-002',applicationId:'DEMO-APP-002',type:'LEAD_CREATED',description:'Lead created from website enquiry.',actor:'AI Intake',status:'COMPLETED',time:'2026-08-08T14:20:00+08:00'},
      {id:'DEMO-ACT-005',leadId:'DEMO-LEAD-002',applicationId:'DEMO-APP-002',type:'DOCUMENT_COLLECTION_FAILED',description:'AI follow-up did not receive IC back or income proof.',actor:'CRM Automation',status:'EXCEPTION',time:'2026-08-10T09:35:00+08:00'},
      {id:'DEMO-ACT-006',leadId:'DEMO-LEAD-002',applicationId:'DEMO-APP-002',type:'HUMAN_HANDOVER_REQUESTED',description:'Customer requested human assistance. Case entered the Manager queue.',actor:'CRM Automation',status:'OPEN',time:'2026-08-10T09:40:00+08:00'},
      {id:'DEMO-ACT-007',leadId:'DEMO-LEAD-002',applicationId:'DEMO-APP-002',type:'HANDOVER_ASSIGNED',description:'Manager assigned the exception case to SA-DEMO-014.',actor:'East Manager',status:'COMPLETED',time:'2026-08-10T09:45:00+08:00'}
    ]
  }
];
function customer360DemoPanel(){if(state.user?.role!=='ADMIN')return'';return `<section class="panel customer-360-demo-panel"><div class="customer-360-demo-head"><div><span>Safe preview data</span><h3>Customer 360 samples</h3><p>Open both examples to compare an AI-complete case with a human follow-up exception. Samples are visible across the CRM but are never saved or exported.</p></div>${pill('Preview only',true)}</div><div class="customer-360-demo-grid">${customer360Demos.map(demo=>`<button class="customer-360-demo-card ${demo.tone}" data-demo-customer="${esc(demo.id)}"><span class="customer-360-demo-icon">${demo.tone==='complete'?'AI':'HF'}</span><span><strong>${esc(demo.application.customer)}</strong><small>${esc(demo.application.product)}</small><em>${esc(demo.label)}</em></span><b>Open sample</b></button>`).join('')}</div></section>`}
function bindCustomer360Demos(){document.querySelectorAll('[data-demo-customer]').forEach(button=>button.onclick=()=>openCustomer360Demo(button.dataset.demoCustomer).catch(error=>alert(error.message)))}
async function openCustomer360Demo(id){
  const demo=customer360Demos.find(item=>item.id===id);if(!demo)return;
  await ensureCustomer360Data();
  const keys=['leads','applications','documents','inbox','outbox','activity'],backup=Object.fromEntries(keys.map(key=>[key,state.data[key]]));
  state.data.leads=[demo.lead,...backup.leads];state.data.applications=[demo.application,...backup.applications];state.data.documents=[...demo.documents,...backup.documents];state.data.inbox=[...demo.inbox,...backup.inbox];state.data.outbox=[...demo.outbox,...backup.outbox];state.data.activity=[...demo.activity,...backup.activity];
  try{await openCustomer360({leadId:demo.lead.id})}finally{keys.forEach(key=>{state.data[key]=backup[key]})}
  const drawerElement=document.querySelector('.customer-360-drawer');if(!drawerElement)return;
  drawerElement.querySelector('.drawer-head h2').textContent=`${demo.application.customer} - Demo`;
  drawerElement.querySelector('.drawer-head small').textContent='Preview only | Not saved to Google Sheets';
  const actions=drawerElement.querySelector('.customer-360-actions');if(actions)actions.innerHTML='<div class="customer-360-demo-notice"><strong>Demo preview</strong><span>Buttons that write data or send WhatsApp are disabled.</span></div>';
  drawerElement.querySelectorAll('[data-360-application]').forEach(button=>{button.disabled=true;button.removeAttribute('data-360-application')});
  drawerElement.querySelector('.drawer-body')?.insertAdjacentHTML('afterbegin',`<div class="customer-360-demo-banner"><strong>${esc(demo.label)}</strong><span>This sample exists only in your browser for design review. It does not affect CRM totals, reports, Google Sheets, Make or WhatsApp.</span></div>`);
}
function dashboard(){const s=state.summary;app.innerHTML=head('Command Centre','AI-managed applications, exception queues and LMS readiness in your permitted scope.')+`<div class="metric-grid">${metric('Total leads',s.leads,'Your permitted scope')}${metric('Applications',s.applications,'Financing cases')}${metric('AI exceptions',s.aiExceptions||0,'Assigned only when AI cannot finish')}${metric('Ready for LMS',s.lmsReady||0,'Documents verified complete')}${metric('Human handovers',s.humanHandovers,'Manager attention')}${metric('Needs attention',s.needsAttention,'Exceptions and recovery')}${metric('Completed',s.completed,'Finished cases')}${metric('Unread inbox',s.unreadInbox,'Customer replies')}</div>${customer360DemoPanel()}<section class="panel" style="margin-top:16px"><div class="panel-head"><h3>Latest applications</h3></div>${applicationTable(state.data.applications.slice(0,10))}</section>`;bindCustomer360Demos()}

// Client-only feature samples. They are injected after live reads and never pass through a write API.
const demoFeatureResources=['leads','applications','documents','inbox','outbox','activity'];
const demoFeatureViews=new Set(['dashboard','workbench','reports','leads','applications','documents','inbox','outbox','activity']);
function demoRecordId(record){return String(record?.id||'').toUpperCase()}
function isDemoRecord(record){return Boolean(record?.demo)||demoRecordId(record).startsWith('DEMO-')}
function demoForIdentity({leadId='',applicationId='',phone='',id=''}={}){const normalized=normalizePhone(phone);return customer360Demos.find(demo=>demo.lead.id===leadId||demo.application.id===applicationId||demoRecordId({id})===demoRecordId(demo.lead)||demoRecordId({id})===demoRecordId(demo.application)||(normalized&&normalizePhone(demo.lead.phone)===normalized))}
function demoForRecord(record){return demoForIdentity({leadId:record?.leadId||record?.id,applicationId:record?.applicationId||record?.id,phone:record?.phone||record?.recipient,id:record?.id})}
function demoClone(record,demo){return{...record,demo:true,demoCustomerId:demo.id}}
function syncDemoFeatureData(){
  demoFeatureResources.forEach(resource=>{state.data[resource]=(state.data[resource]||[]).filter(record=>!isDemoRecord(record))});
  if(state.user?.role!=='ADMIN')return;
  const preview={leads:[],applications:[],documents:[],inbox:[],outbox:[],activity:[]};
  customer360Demos.forEach(demo=>{
    preview.leads.push(demoClone(demo.lead,demo));
    preview.applications.push(demoClone(demo.application,demo));
    preview.documents.push(...demo.documents.map(record=>demoClone(record,demo)));
    preview.inbox.push(...demo.inbox.map(record=>demoClone({...record,assignedSa:record.assignedSa||demo.application.sa},demo)));
    preview.outbox.push(...demo.outbox.map(record=>demoClone(record,demo)));
    preview.activity.push(...demo.activity.map(record=>demoClone(record,demo)));
  });
  demoFeatureResources.forEach(resource=>{state.data[resource]=[...preview[resource],...state.data[resource]]});
}
function demoLabel(record){const demo=demoForRecord(record);return demo?`<span class="demo-label ${demo.tone}">DEMO · ${esc(demo.application.customer)}</span>`:''}
function demoOpenButton(record,label='Open demo'){const demo=demoForRecord(record);return `<button class="row-action demo-open" data-demo-customer="${esc(demo?.id||record?.demoCustomerId||'')}">${esc(label)}</button>`}
function demoFeatureBanner(){return `<section class="demo-feature-banner"><span class="demo-feature-icon">DEMO</span><div><strong>Feature preview with 2 connected sample customers</strong><p>Alicia shows an AI-complete case; Jason shows an incomplete-document human handover. Preview rows are never saved to Google Sheets, sent to WhatsApp, written to Make, or included in CSV exports.</p></div><button class="secondary" data-demo-customer="demo-complete">Open complete case</button><button class="secondary" data-demo-customer="demo-handover">Open handover case</button></section>`}
function applyDemoFeatureBanner(){
  if(state.user?.role!=='ADMIN'||!demoFeatureViews.has(state.view))return;
  if(state.view==='dashboard'){bindCustomer360Demos();return;}
  const strip=app.querySelector('.status-strip');if(strip&&!app.querySelector('.demo-feature-banner'))strip.insertAdjacentHTML('afterend',demoFeatureBanner());
  const toolbarCount=app.querySelector('.smart-toolbar .pill');
  if(toolbarCount&&state.view==='leads')toolbarCount.textContent=`${state.data.leads.filter(record=>!isDemoRecord(record)).length} live + ${state.data.leads.filter(isDemoRecord).length} demo`;
  if(toolbarCount&&state.view==='applications')toolbarCount.textContent=`${state.data.applications.filter(record=>!isDemoRecord(record)).length} live + ${state.data.applications.filter(isDemoRecord).length} demo`;
  bindCustomer360Demos();
}
function leadTable(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer</th><th>Motor</th><th>Application</th><th>Region</th><th>Status</th><th>Owner</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr class="${isDemoRecord(x)?'demo-row':''}"><td>${demoLabel(x)}<strong>${esc(x.name)}</strong><small>${esc(x.id)} · ${esc(x.phone)}</small></td><td>${esc(x.model)}</td><td>${x.applicationId?`${esc(x.applicationId)}<br>${pretty(x.applicationStatus)}`:'—'}</td><td>${pretty(x.region)}</td><td>${pill(x.status,true)}</td><td>${esc(x.sa)}</td><td>${isDemoRecord(x)?demoOpenButton(x):`<button class="row-action" data-lead="${esc(x.id)}">Open</button>`}</td></tr>`).join('')||empty(7)}</tbody></table></div>`}
function applicationTable(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer</th><th>Motor</th><th>Financing</th><th>Documents</th><th>Missing</th><th>Stage</th><th>Owner</th><th>Actions</th></tr></thead><tbody>${rows.map(a=>`<tr class="${isDemoRecord(a)?'demo-row':''}"><td>${demoLabel(a)}<strong>${esc(a.customer)}</strong><small>${esc(a.id)}</small></td><td><strong>${esc(a.product||'Not selected')}</strong><small>${pretty(a.priceZone||a.region)}</small></td><td>${money(a.deposit)} deposit<br>${a.monthly?`${money(a.monthly)}/month · ${esc(a.tenure)} years`:'Quote pending'}</td><td><strong>${a.documentsReceived||0}</strong> received<br>${pretty(a.documentStatus||'Pending')}</td><td>${esc(a.missingDocuments||'None recorded')}</td><td>${pill(a.stage,true)}<br>${pretty(a.status)}</td><td>${esc(a.sa)}</td><td><div class="row-actions">${isDemoRecord(a)?demoOpenButton(a,'Customer 360 demo'):`<button class="row-action whatsapp-action" data-whatsapp="${esc(a.id)}">WhatsApp</button><button class="row-action" data-upload="${esc(a.id)}">Upload</button><button class="row-action secondary" data-app="${esc(a.id)}">Manage</button>`}</div></td></tr>`).join('')||empty(8)}</tbody></table></div>`}
function documentTable(rows){const canReview=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer / Application</th><th>Document</th><th>Received</th><th>AI status</th><th>Remarks</th><th>Actions</th></tr></thead><tbody>${rows.map(d=>{const a=state.data.applications.find(x=>x.id===d.applicationId||x.leadId===d.leadId);return `<tr class="${isDemoRecord(d)?'demo-row':''}"><td>${demoLabel(d)}<strong>${esc(a?.customer||d.leadId||'Customer')}</strong><small>${esc(d.applicationId||a?.id||d.leadId)}</small></td><td><strong>${pretty(d.type||'Unclassified')}</strong><small>${esc(d.fileName||d.mimeType||'File recorded')}</small></td><td>${esc(when(d.received||d.updated))}</td><td>${pill(d.verification||d.quality||d.classification||'AI queued',String(d.reviewRequired).toUpperCase()!=='TRUE')}</td><td>${esc(d.remarks||'—')}</td><td><div class="row-actions">${isDemoRecord(d)?demoOpenButton(d,'Customer 360 demo'):`${canReview?`<button class="row-action" data-review="${esc(d.id)}">Resolve AI exception</button>`:'<span class="pill">Manager decision required</span>'}${a?`<button class="row-action secondary" data-app="${esc(a.id)}">Open application</button>`:''}`}</div></td></tr>`}).join('')||empty(6)}</tbody></table></div>`}
function inboxTable(rows){const manager=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Time</th><th>Customer</th><th>Message</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>${rows.map(x=>{const status=String(x.status).toUpperCase(),staffCanHandle=manager||!x.humanRequired||status==='ASSIGNED_TO_STAFF';return `<tr class="${x.humanRequired?'handover-row ':''}${isDemoRecord(x)?'demo-row':''}"><td>${esc(when(x.time))}</td><td>${demoLabel(x)}<strong>${esc(x.customer)}</strong><small>${esc(x.phone)}</small></td><td>${esc(x.message)}</td><td>${pill(x.status,!x.humanRequired)}</td><td>${esc(x.assignedSa||'Manager queue')}</td><td><div class="row-actions">${isDemoRecord(x)?demoOpenButton(x,'Customer 360 demo'):`<button class="row-action secondary" data-customer-profile data-lead-id="${esc(x.leadId||'')}" data-application-id="${esc(x.applicationId||'')}" data-phone="${esc(x.phone||'')}">Customer 360</button>${staffCanHandle?`<button class="row-action whatsapp-action" data-inbox-reply="${esc(x.id)}">Reply</button>`:'<span class="pill">Waiting for Manager</span>'}${manager&&status==='HUMAN_HANDOVER_REQUIRED'?`<button class="row-action" data-take-handover="${esc(x.id)}">Manager take over</button><button class="row-action secondary" data-assign-handover="${esc(x.id)}">Assign staff</button>`:''}${status!=='RESOLVED'&&(manager||status==='ASSIGNED_TO_STAFF')?`<button class="row-action secondary" data-resolve-handover="${esc(x.id)}">Resolve</button>`:''}`}</div></td></tr>`}).join('')||empty(6)}</tbody></table></div>`}
function outbox(){app.innerHTML=head('Message Outbox','Manual WhatsApp Business and future Meta Cloud messages use one controlled queue.')+`<div class="security-banner"><div><strong>Manual WhatsApp ready</strong><p>Open WhatsApp, send the prepared message, then mark it sent so the audit trail stays complete.</p></div><button data-new-message>New message</button></div><section class="panel table-card"><table class="data-table"><thead><tr><th>Time</th><th>Recipient</th><th>Message</th><th>Lead / Application</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.data.outbox.map(x=>`<tr class="${isDemoRecord(x)?'demo-row':''}"><td>${esc(when(x.time))}</td><td>${demoLabel(x)}${esc(x.recipient)}</td><td>${esc(x.message)}</td><td>${esc(x.leadId||x.applicationId)}</td><td>${pill(x.status,String(x.status).toUpperCase()!=='FAILED')}</td><td><div class="row-actions">${isDemoRecord(x)?demoOpenButton(x,'Customer 360 demo'):`<button class="row-action secondary" data-customer-profile data-lead-id="${esc(x.leadId||'')}" data-application-id="${esc(x.applicationId||'')}" data-phone="${esc(x.recipient||'')}">Customer 360</button>${String(x.status).toUpperCase()==='MANUAL_PENDING'?`<button class="row-action whatsapp-action" data-open-outbox="${esc(x.id)}">Open WhatsApp</button><button class="row-action" data-mark-sent="${esc(x.id)}">Mark sent</button>`:''}`}</div></td></tr>`).join('')||empty(6)}</tbody></table></section>`;document.querySelector('[data-new-message]').onclick=()=>manualWhatsApp();bindMessaging()}
function activity(){simple('Activity & Audit','Operational events for the permitted regional scope.',['Time','Activity','Lead','Application','Description','Actor'],state.data.activity.map(x=>`<tr class="${isDemoRecord(x)?'demo-row':''}"><td>${esc(when(x.time))}</td><td>${demoLabel(x)}${pretty(x.type)}</td><td>${esc(x.leadId)}</td><td>${esc(x.applicationId)}</td><td>${esc(x.description)}</td><td>${esc(x.actor)}${isDemoRecord(x)?`<div>${demoOpenButton(x,'View demo')}</div>`:''}</td></tr>`).join(''))}
function bindCustomerProfileButtons(){document.querySelectorAll('[data-customer-profile]').forEach(button=>button.onclick=()=>{const identity={leadId:button.dataset.leadId||'',applicationId:button.dataset.applicationId||'',phone:button.dataset.phone||''},demo=demoForIdentity(identity);return(demo?openCustomer360Demo(demo.id):openCustomer360(identity)).catch(error=>alert(error.message))})}
async function openCustomer360Demo(id){
  const demo=customer360Demos.find(item=>item.id===id);if(!demo)return;
  await ensureCustomer360Data();syncDemoFeatureData();await openCustomer360({leadId:demo.lead.id});
  const drawerElement=document.querySelector('.customer-360-drawer');if(!drawerElement)return;
  drawerElement.querySelector('.drawer-head h2').textContent=`${demo.application.customer} - Demo`;
  drawerElement.querySelector('.drawer-head small').textContent='Preview only | Not saved to Google Sheets';
  const actions=drawerElement.querySelector('.customer-360-actions');if(actions)actions.innerHTML='<div class="customer-360-demo-notice"><strong>Demo preview</strong><span>Buttons that write data, upload files or send WhatsApp are disabled.</span></div>';
  drawerElement.querySelectorAll('button[data-360-application]').forEach(button=>{button.disabled=true;button.removeAttribute('data-360-application')});
  drawerElement.querySelector('.drawer-body')?.insertAdjacentHTML('afterbegin',`<div class="customer-360-demo-banner"><strong>${esc(demo.label)}</strong><span>This connected sample exists only in your browser. It never affects live totals, Google Sheets, Make, WhatsApp or exports.</span></div>`);
}
function bind(){
  document.querySelectorAll('[data-lead]').forEach(button=>button.onclick=()=>{const record=state.data.leads.find(item=>item.id===button.dataset.lead),demo=demoForRecord(record);return demo?openCustomer360Demo(demo.id):openLead(button.dataset.lead)});
  document.querySelectorAll('[data-app]').forEach(button=>button.onclick=()=>{const record=state.data.applications.find(item=>item.id===button.dataset.app),demo=demoForRecord(record);return demo?openCustomer360Demo(demo.id):openApp(button.dataset.app)});
  document.querySelectorAll('[data-upload]').forEach(button=>button.onclick=()=>{const record=state.data.applications.find(item=>item.id===button.dataset.upload);return isDemoRecord(record)?openCustomer360Demo(record.demoCustomerId):uploadDocument(record)});
  document.querySelectorAll('[data-review]').forEach(button=>button.onclick=()=>{const record=state.data.documents.find(item=>item.id===button.dataset.review);return isDemoRecord(record)?openCustomer360Demo(record.demoCustomerId):reviewDocument(record)});
  document.querySelectorAll('[data-whatsapp]').forEach(button=>button.onclick=()=>{const record=state.data.applications.find(item=>item.id===button.dataset.whatsapp);return isDemoRecord(record)?openCustomer360Demo(record.demoCustomerId):manualWhatsApp(record)});
  document.querySelectorAll('[data-refresh]').forEach(button=>button.onclick=async()=>{await load();await ensureViewData(state.view);render()});
  bindMessaging();bindCustomer360Demos();
}
function render(){
  syncDemoFeatureData();
  const documentBadge=document.getElementById('documentBadge');if(documentBadge)documentBadge.textContent=state.data.documents.filter(record=>!isDemoRecord(record)).length;
  document.querySelectorAll('.nav-item').forEach(item=>{item.classList.toggle('active',item.dataset.view===state.view);item.onclick=async()=>{state.view=item.dataset.view;await ensureViewData(state.view);render();document.getElementById('sidebar').classList.remove('open')}});
  ({dashboard,workbench,reports,leads,applications,documents,inbox,outbox,catalog,pricing,handphoneCatalog:catalog,handphonePricing:pricing,team,users:usersAdmin,activity,settings}[state.view]||dashboard)();
  bind();applyDemoFeatureBanner();
}

function whatsappChannelLabel(record={}){
  return record.channelName||record.displayNumber||record.channelId||'Unassigned channel';
}

async function refreshWhatsAppChannels(){
  const response=await get('channels');state.data.channels=response.records||[];loadedResources.add('channels');
}

function editWhatsAppChannel(channel){
  const branchOptions=[...new Map(state.data.team.filter(member=>member.branchId).map(member=>[member.branchId,member.branch||member.branchId])).entries()].map(([id,name])=>`<option value="${esc(id)}">${esc(name)} · ${esc(id)}</option>`).join('');
  formModal('Configure official WhatsApp number',`<form id="whatsappChannelForm" class="crm-form"><div class="form-wide channel-binding-notice"><strong>${esc(channel.id)}</strong><span>This slot keeps every conversation bound to the official number that received it.</span></div><label>Channel name<input name="name" value="${esc(channel.name||'')}" required></label><label>Region<select name="region"><option value="EAST_MALAYSIA">East Malaysia</option><option value="WEST_MALAYSIA">West Malaysia</option></select></label><label>Business unit<select name="businessUnit"><option value="MOTOR">Motor</option><option value="HANDPHONE">Handphone</option></select></label><label>Team ID<input name="teamId" value="${esc(channel.teamId||'')}" placeholder="TEAM-HP-EAST"></label><label>Slot<input name="slot" value="${esc(channel.slot||'')}" readonly></label><label>Branch (optional)<select name="branchId"><option value="">Regional default</option>${branchOptions}</select></label><label>Official display number<input name="displayNumber" value="${esc(channel.displayNumber||'')}" placeholder="+60..."></label><label>Meta Phone Number ID<input name="phoneNumberId" value="${esc(channel.phoneNumberId||'')}" inputmode="numeric"></label><label>WABA ID<input name="wabaId" value="${esc(channel.wabaId||'')}" inputmode="numeric"></label><label>Meta App ID<input name="appId" value="${esc(channel.appId||'')}" inputmode="numeric"></label><label>Business Portfolio ID<input name="portfolioId" value="${esc(channel.portfolioId||'')}" inputmode="numeric"></label><label>Credential key<input name="credentialKey" value="${esc(channel.credentialKey||channel.id.replaceAll('-','_'))}" pattern="[A-Za-z0-9_]+"></label><label>Make connection alias<input name="connectionAlias" value="${esc(channel.connectionAlias||'')}"></label><label>Webhook route key<input name="webhookRouteKey" value="${esc(channel.webhookRouteKey||channel.id)}"></label><label>Environment<select name="environment"><option value="PRODUCTION">Production</option><option value="TEST">Test</option></select></label><label class="channel-check"><input name="active" type="checkbox"> Active channel</label><label class="channel-check"><input name="inboundEnabled" type="checkbox"> Receive inbound</label><label class="channel-check"><input name="outboundEnabled" type="checkbox"> Send outbound</label><label class="form-wide">Internal notes<textarea name="notes" rows="3">${esc(channel.notes||'')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save channel</button></div><p class="form-wide notice" id="formMessage">Access tokens are never entered here. The credential key points to a protected Vercel secret. A number cannot be activated until its display number and Meta Phone Number ID are present.</p></form>`);
  const form=document.getElementById('whatsappChannelForm');form.region.value=channel.region||'EAST_MALAYSIA';form.businessUnit.value=channel.businessUnit==='HANDPHONE'?'HANDPHONE':'MOTOR';form.branchId.value=channel.branchId||'';form.environment.value=channel.environment||'PRODUCTION';form.active.checked=!!channel.active;form.inboundEnabled.checked=!!channel.inboundEnabled;form.outboundEnabled.checked=!!channel.outboundEnabled;form.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),message=document.getElementById('formMessage'),values=Object.fromEntries(new FormData(form));button.disabled=true;try{await post('saveWhatsAppChannel',{channelId:channel.id,...values,active:form.active.checked,inboundEnabled:form.inboundEnabled.checked,outboundEnabled:form.outboundEnabled.checked});document.querySelector('.drawer-backdrop').remove();await refreshWhatsAppChannels();state.view='settings';render()}catch(error){message.textContent=error.message;button.disabled=false}};
}

function whatsappChannelManager(){
  const channels=[...(state.data.channels||[])].filter(channel=>/^JKM-WA-(EAST|WEST)-0[1-5]$/.test(String(channel.id||''))).sort((a,b)=>String(a.region).localeCompare(String(b.region))||String(a.slot).localeCompare(String(b.slot))||String(a.id).localeCompare(String(b.id)));
  const east=channels.filter(channel=>channel.region==='EAST_MALAYSIA'),west=channels.filter(channel=>channel.region==='WEST_MALAYSIA'),connected=channels.filter(channel=>channel.active&&channel.inboundEnabled&&channel.outboundEnabled);
  const rows=channels.map(channel=>`<tr><td><strong>${esc(channel.name||channel.id)}</strong><small>${esc(channel.id)}</small></td><td>${pretty(channel.region)}</td><td><strong>${pretty(channel.businessUnit||'UNASSIGNED')}</strong><small>${esc(channel.teamId||'No team assigned')}</small></td><td>${esc(channel.slot||'Legacy')}</td><td><strong>${esc(channel.displayNumber||'Waiting for official number')}</strong><small>${esc(channel.phoneNumberId?'Meta ID configured':'Phone Number ID pending')}</small></td><td>${pill(channel.active?'Active':channel.status||'Reserved',channel.active)}</td><td>${pill(channel.inboundEnabled?'On':'Off',channel.inboundEnabled)} / ${pill(channel.outboundEnabled?'On':'Off',channel.outboundEnabled)}</td><td>${pill(channel.credentialConfigured?'Protected secret ready':'Credential pending',channel.credentialConfigured)}</td><td>${state.user?.role==='ADMIN'?`<button class="row-action" data-edit-channel="${esc(channel.id)}">Configure</button>`:'Read only'}</td></tr>`).join('')||empty(9);
  const panel=`<section class="panel whatsapp-channel-panel"><div class="panel-head"><div><span class="eyebrow">MULTI-NUMBER ROUTING</span><h3>Official WhatsApp number control</h3><p>Capacity is reserved for five East Malaysia and five West Malaysia numbers. Only connected slots are used; customer replies stay on the exact number that received the conversation.</p></div><span class="pill green">${connected.length} LIVE / 10 RESERVED</span></div><div class="metric-grid compact-metrics">${metric('East Malaysia slots',east.length,east.filter(item=>item.active).length+' active')}${metric('West Malaysia slots',west.length,west.filter(item=>item.active).length+' active')}${metric('Same-number reply','ENFORCED','Inbound channel binding')}${metric('Secrets exposed','0','Tokens remain in Vercel')}</div><div class="table-card"><table class="data-table"><thead><tr><th>Channel</th><th>Region</th><th>Business / team</th><th>Slot</th><th>Official number</th><th>Status</th><th>Inbound / Outbound</th><th>Credential</th><th>Admin action</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  const integrationPanel=app.querySelector('.integration-readiness-panel');if(integrationPanel)integrationPanel.insertAdjacentHTML('afterend',panel);else app.insertAdjacentHTML('beforeend',panel);
  document.querySelectorAll('[data-edit-channel]').forEach(button=>button.onclick=()=>editWhatsAppChannel(channels.find(channel=>channel.id===button.dataset.editChannel)));
}

function settings(){
  settingsLegacy();
  if(state.user?.role==='ADMIN'&&loadedResources.has('channels'))whatsappChannelManager();
}

function channelReportSource(){
  return{leads:state.data.leads.filter(record=>!isDemoRecord(record)),applications:state.data.applications.filter(record=>!isDemoRecord(record)),documents:state.data.documents.filter(record=>!isDemoRecord(record)),inbox:state.data.inbox.filter(record=>!isDemoRecord(record)),outbox:state.data.outbox.filter(record=>!isDemoRecord(record)),activity:state.data.activity.filter(record=>!isDemoRecord(record))};
}

function appendWhatsAppChannelReport(source){
  if(state.user?.role!=='ADMIN'||!loadedResources.has('channels'))return;
  const region=state.reportRegion||'ALL',selected=state.reportChannel||'ALL';
  const channels=(state.data.channels||[]).filter(channel=>(region==='ALL'||channel.region===region)&&(selected==='ALL'||channel.id===selected));
  const leadChannel=lead=>lead.primaryChannelId||lead.channelId;
  const rows=channels.map(channel=>{
    const leads=source.leads.filter(lead=>leadChannel(lead)===channel.id),leadIds=new Set(leads.map(lead=>lead.id)),applications=source.applications.filter(item=>leadIds.has(item.leadId));
    const inbox=source.inbox.filter(message=>message.channelId===channel.id),outbox=source.outbox.filter(message=>message.channelId===channel.id),delivered=outbox.filter(message=>message.deliveredAt||['DELIVERED','READ'].includes(String(message.status).toUpperCase())),read=outbox.filter(message=>message.readAt||String(message.status).toUpperCase()==='READ'),failed=outbox.filter(message=>['FAILED','ERROR'].includes(String(message.status).toUpperCase())),handovers=inbox.filter(message=>message.humanRequired);
    return[channel.name||channel.id,pretty(channel.region),pretty(channel.businessUnit||'UNASSIGNED'),channel.teamId||'No team',channel.displayNumber||'Pending',channel.active?'Active':'Reserved',leads.length,inbox.length,outbox.length,reportPercent(delivered.length,outbox.length),reportPercent(read.length,delivered.length),failed.length,handovers.length,applications.length,reportPercent(applications.length,leads.length)];
  });
  const toolbar=app.querySelector('.report-toolbar'),spacer=toolbar?.querySelector('.toolbar-spacer');
  if(spacer&&!document.getElementById('reportChannel')){
    const options=(state.data.channels||[]).filter(channel=>region==='ALL'||channel.region===region).map(channel=>reportOption(channel.id,`${channel.name||channel.id}${channel.displayNumber?' · '+channel.displayNumber:''}`,selected)).join('');
    spacer.insertAdjacentHTML('beforebegin',`<label>WhatsApp number<select id="reportChannel">${reportOption('ALL','All official numbers',selected)}${options}</select></label>`);
    document.getElementById('reportChannel').onchange=event=>{state.reportChannel=event.target.value;reports()};
    const regionSelect=document.getElementById('reportRegion'),original=regionSelect?.onchange;if(regionSelect&&original)regionSelect.onchange=event=>{const next=event.target.value,current=(state.data.channels||[]).find(channel=>channel.id===state.reportChannel);if(current&&next!=='ALL'&&current.region!==next)state.reportChannel='ALL';original(event)};
  }
  const grid=app.querySelector('.admin-report-grid');if(grid)grid.insertAdjacentHTML('afterbegin',`<section class="report-card wide whatsapp-number-report"><div class="panel-head"><div><h3>WhatsApp number performance</h3><p>Every result stays separated by region, business unit, team and the exact official number.</p></div></div>${adminReportTable(['Official channel','Region','Business','Team','Number','Status','Leads','Inbound','Outbound','Delivery rate','Read rate','Failed','Handovers','Applications','Lead conversion'],rows)}</section>`);
}

function reports(){
  const source=channelReportSource(),selected=state.reportChannel||'ALL';
  const backup={leads:state.data.leads,applications:state.data.applications,documents:state.data.documents,inbox:state.data.inbox,outbox:state.data.outbox,activity:state.data.activity};
  Object.assign(state.data,source);
  if(state.user?.role==='ADMIN'&&selected!=='ALL'&&loadedResources.has('channels')){
    const leadIds=new Set(source.leads.filter(lead=>(lead.primaryChannelId||lead.channelId)===selected).map(lead=>lead.id));
    const applications=source.applications.filter(item=>leadIds.has(item.leadId)),applicationIds=new Set(applications.map(item=>item.id));
    state.data.leads=source.leads.filter(lead=>leadIds.has(lead.id));state.data.applications=applications;state.data.documents=source.documents.filter(item=>leadIds.has(item.leadId)||applicationIds.has(item.applicationId));state.data.inbox=source.inbox.filter(item=>item.channelId===selected);state.data.outbox=source.outbox.filter(item=>item.channelId===selected);state.data.activity=source.activity.filter(item=>leadIds.has(item.leadId)||applicationIds.has(item.applicationId));
  }
  reportsLegacy();
  Object.assign(state.data,backup);
  appendWhatsAppChannelReport(source);
}

function inboxTable(rows){
  const manager=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Time</th><th>Customer</th><th>Official number</th><th>Message</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>${rows.map(item=>{const status=String(item.status).toUpperCase(),staffCanHandle=manager||!item.humanRequired||status==='ASSIGNED_TO_STAFF';return `<tr class="${item.humanRequired?'handover-row ':''}${isDemoRecord(item)?'demo-row':''}"><td>${esc(when(item.time))}</td><td>${demoLabel(item)}<strong>${esc(item.customer)}</strong><small>${esc(item.phone)}</small></td><td><strong>${esc(whatsappChannelLabel(item))}</strong><small>${esc(item.routingStatus||'Bound automatically')}</small></td><td>${esc(item.message)}</td><td>${pill(item.status,!item.humanRequired)}</td><td>${esc(item.assignedSa||'Manager queue')}</td><td><div class="row-actions">${isDemoRecord(item)?demoOpenButton(item,'Customer 360 demo'):`<button class="row-action secondary" data-customer-profile data-lead-id="${esc(item.leadId||'')}" data-application-id="${esc(item.applicationId||'')}" data-phone="${esc(item.phone||'')}">Customer 360</button>${staffCanHandle?`<button class="row-action whatsapp-action" data-inbox-reply="${esc(item.id)}">Reply from same number</button>`:'<span class="pill">Waiting for Manager</span>'}${manager&&status==='HUMAN_HANDOVER_REQUIRED'?`<button class="row-action" data-take-handover="${esc(item.id)}">Manager take over</button><button class="row-action secondary" data-assign-handover="${esc(item.id)}">Assign staff</button>`:''}${status!=='RESOLVED'&&(manager||status==='ASSIGNED_TO_STAFF')?`<button class="row-action secondary" data-resolve-handover="${esc(item.id)}">Resolve</button>`:''}`}</div></td></tr>`}).join('')||empty(7)}</tbody></table></div>`;
}

function outbox(){
  app.innerHTML=head('Message Outbox','Every reply is bound to the official WhatsApp number that received the customer conversation.')+`<div class="security-banner"><div><strong>Same-number reply protection</strong><p>CRM records the source channel and prevents Cloud API replies from silently switching to a different East or West Malaysia number.</p></div><button data-new-message>New message</button></div><section class="panel table-card"><table class="data-table"><thead><tr><th>Time</th><th>Recipient</th><th>Official number</th><th>Message</th><th>Lead / Application</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.data.outbox.map(item=>`<tr class="${isDemoRecord(item)?'demo-row':''}"><td>${esc(when(item.time))}</td><td>${demoLabel(item)}${esc(item.recipient)}</td><td><strong>${esc(whatsappChannelLabel(item))}</strong><small>${esc(item.routingStatus||'')}</small></td><td>${esc(item.message)}</td><td>${esc(item.leadId||item.applicationId)}</td><td>${pill(item.status,String(item.status).toUpperCase()!=='FAILED')}</td><td><div class="row-actions">${isDemoRecord(item)?demoOpenButton(item,'Customer 360 demo'):`<button class="row-action secondary" data-customer-profile data-lead-id="${esc(item.leadId||'')}" data-application-id="${esc(item.applicationId||'')}" data-phone="${esc(item.recipient||'')}">Customer 360</button>${String(item.status).toUpperCase()==='MANUAL_PENDING'?`<button class="row-action whatsapp-action" data-open-outbox="${esc(item.id)}">Open WhatsApp</button><button class="row-action" data-mark-sent="${esc(item.id)}">Mark sent</button>`:''}`}</div></td></tr>`).join('')||empty(7)}</tbody></table></section>`;document.querySelector('[data-new-message]').onclick=()=>manualWhatsApp();bindMessaging();
}

function manualWhatsApp(target){
  const selected=target?.id?target:null,isInbox=!!selected&&state.data.inbox.some(item=>item.id===selected.id),selectedApplication=selected&&state.data.applications.find(item=>item.id===selected.id),selectedLead=selected&&state.data.leads.find(item=>item.id===selected.id),boundLabel=whatsappChannelLabel(selected||{});
  formModal('Reply customer',`<form id="manualWhatsAppForm" class="crm-form"><label class="form-wide">Customer<select name="customer" ${selected?'disabled':''}>${selected?`<option value="${esc(selected.id)}">${esc(selected.customer||selected.name||selected.phone)}</option>`:customerOptions()}</select></label><label class="form-wide">Phone number<input name="phone" value="${esc(selected?.phone||'')}" required></label><label class="form-wide">Official reply number<input value="${esc(selected&&boundLabel!=='Unassigned channel'?boundLabel:'CRM will use the customer’s latest bound channel')}" readonly></label><label>Reply type<select name="messageType"><option value="TEXT">Normal reply</option><option value="TEMPLATE">Approved Meta template</option></select></label><label>Template language<input name="language" value="en_US"></label><label class="form-wide template-field" hidden>Approved template name<input name="templateName"></label><label class="form-wide">Message<textarea name="message" rows="6" required placeholder="Type the customer reply here"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Open WhatsApp Business</button></div><p class="form-wide notice" id="formMessage">When Meta Cloud is active, CRM sends from the exact official number that received this conversation. If that channel is disabled, the reply is stopped until Admin approves a transfer.</p></form>`);
  const form=document.getElementById('manualWhatsAppForm'),templateField=form.querySelector('.template-field');if(state.user?.whatsappMode==='CLOUD')form.querySelector('[type=submit]').textContent='Send from same official number';form.messageType.onchange=()=>{templateField.hidden=form.messageType.value!=='TEMPLATE';form.templateName.required=form.messageType.value==='TEMPLATE'};
  const applyTarget=()=>{const item=selected||customerTarget(form.customer.value);if(item)form.phone.value=item.phone||''};if(!selected)form.customer.onchange=applyTarget;applyTarget();form.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),message=document.getElementById('formMessage'),item=selected||customerTarget(form.customer.value),manualWindow=state.user?.whatsappMode==='MANUAL'?window.open('about:blank','_blank'):null;const leadId=item?.leadId||selectedLead?.id||selectedApplication?.leadId||'',applicationId=item?.applicationId||selectedApplication?.id||'';button.disabled=true;try{const saved=await post('sendCustomerMessage',{leadId,applicationId,phone:form.phone.value,message:form.message.value,messageType:form.messageType.value,templateName:form.templateName.value,language:form.language.value,channelId:item?.channelId||'',replyToMessageId:isInbox?selected.id:''});if(saved.mode==='MANUAL'&&saved.whatsappUrl){if(manualWindow)manualWindow.location=saved.whatsappUrl;else window.location.href=saved.whatsappUrl}else manualWindow?.close();document.querySelector('.drawer-backdrop').remove();await refreshMessaging('outbox')}catch(error){manualWindow?.close();message.textContent=error.message;button.disabled=false}};
}
