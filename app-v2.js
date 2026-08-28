const state={user:null,summary:{},data:{leads:[],applications:[],documents:[],inbox:[],outbox:[],catalog:[],pricing:[],team:[],users:[],activity:[],integrations:[],channels:[],qa:[],followUpSettings:[]},view:'dashboard',loaded:false,reportCategory:'EXECUTIVE'};
const loadedResources=new Set();
const app=document.getElementById('appView'),shell=document.getElementById('appShell'),gate=document.getElementById('loginGate'),form=document.getElementById('loginForm');
let tableScrollDock=null,tableScrollDockTrack=null,activeHorizontalTable=null,tableScrollDockFrame=0,tableScrollDockSyncing=false;
function ensureTableScrollDock(){
  if(tableScrollDock)return tableScrollDock;
  tableScrollDock=document.createElement('div');
  tableScrollDock.id='tableScrollDock';
  tableScrollDock.className='table-scroll-dock';
  tableScrollDock.hidden=true;
  tableScrollDock.tabIndex=0;
  tableScrollDock.setAttribute('role','region');
  tableScrollDock.setAttribute('aria-label','Scroll the visible table left or right');
  tableScrollDock.innerHTML='<div class="table-scroll-dock-track"></div>';
  tableScrollDockTrack=tableScrollDock.firstElementChild;
  document.body.appendChild(tableScrollDock);
  tableScrollDock.addEventListener('scroll',()=>{
    if(!activeHorizontalTable||tableScrollDockSyncing)return;
    tableScrollDockSyncing=true;
    activeHorizontalTable.scrollLeft=tableScrollDock.scrollLeft;
    tableScrollDockSyncing=false;
  },{passive:true});
  return tableScrollDock;
}
function horizontalTableVisibility(card){
  if(!card||card.offsetParent===null||card.scrollWidth<=card.clientWidth+2)return 0;
  const rect=card.getBoundingClientRect(),top=Math.max(rect.top,72),bottom=Math.min(rect.bottom,window.innerHeight-12);
  return Math.max(0,bottom-top);
}
function syncTableScrollDock(){
  tableScrollDockFrame=0;
  const dock=ensureTableScrollDock(),cards=[...document.querySelectorAll('.table-card')];
  const target=cards.map(card=>({card,score:horizontalTableVisibility(card)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score)[0]?.card||null;
  if(!target){activeHorizontalTable=null;dock.hidden=true;return}
  activeHorizontalTable=target;
  const rect=target.getBoundingClientRect(),left=Math.max(12,rect.left),right=Math.min(window.innerWidth-12,rect.right),width=Math.max(120,right-left);
  dock.style.left=`${left}px`;dock.style.width=`${width}px`;dock.hidden=false;
  const overflow=Math.max(0,target.scrollWidth-target.clientWidth);
  tableScrollDockTrack.style.width=`${Math.ceil(width+overflow)}px`;
  tableScrollDockSyncing=true;dock.scrollLeft=target.scrollLeft;tableScrollDockSyncing=false;
  if(!target.dataset.scrollDockBound){
    target.dataset.scrollDockBound='true';
    target.addEventListener('scroll',()=>{
      if(activeHorizontalTable!==target||tableScrollDockSyncing)return;
      tableScrollDockSyncing=true;dock.scrollLeft=target.scrollLeft;tableScrollDockSyncing=false;
    },{passive:true});
  }
}
function scheduleTableScrollDock(){if(!tableScrollDockFrame)tableScrollDockFrame=requestAnimationFrame(syncTableScrollDock)}
function initializeTableScrollAccess(){
  ensureTableScrollDock();
  window.addEventListener('scroll',scheduleTableScrollDock,{passive:true});
  window.addEventListener('resize',scheduleTableScrollDock,{passive:true});
  new MutationObserver(scheduleTableScrollDock).observe(app,{childList:true,subtree:true});
  scheduleTableScrollDock();
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const pretty=value=>{
  const labels={AI:'AI',API:'API',CAD:'CAD',CCRIS:'CCRIS',CRM:'CRM',CSV:'CSV',CTOS:'CTOS',EPF:'EPF',GB:'GB',IC:'IC',ID:'ID',LMS:'LMS',PDF:'PDF',SA:'SA',SKU:'SKU',WHATSAPP:'WhatsApp'};
  return String(value||'—').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,character=>character.toUpperCase()).replace(/\b(Ai|Api|Cad|Ccris|Crm|Csv|Ctos|Epf|Gb|Ic|Id|Lms|Pdf|Sa|Sku|Whatsapp)\b/g,word=>labels[word.toUpperCase()]||word);
};
const when=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.valueOf())?String(v):new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(d)};
const money=v=>v?`RM ${esc(v)}`:'—';
const pill=(v,good=false)=>`<span class="pill ${good?'green':''}">${pretty(v)}</span>`;
const empty=n=>`<tr><td colspan="${n}">No live records found.</td></tr>`;
const isSyntheticLead=lead=>Boolean(lead?.synthetic)||/^(CODEX|QA|UAT)\s+TEST\b/i.test(String(lead?.name||''))||/^(SYNTHETIC|TEST|QA|UAT)$/i.test(String(lead?.source||''));
const isSyntheticApplication=application=>Boolean(application?.synthetic)||/^(CODEX|QA|UAT)\s+TEST\b/i.test(String(application?.customer||''))||/^TEST\s+BRAND$/i.test(String(application?.brand||''));
const businessLeads=()=>state.data.leads.filter(lead=>!isSyntheticLead(lead));
const businessApplications=()=>state.data.applications.filter(application=>!isSyntheticApplication(application));
const businessDocuments=()=>{const syntheticApplicationIds=new Set(state.data.applications.filter(isSyntheticApplication).map(application=>application.id)),syntheticLeadIds=new Set(state.data.leads.filter(isSyntheticLead).map(lead=>lead.id));return state.data.documents.filter(document=>!syntheticApplicationIds.has(document.applicationId)&&!syntheticLeadIds.has(document.leadId))};
const primaryViewFor=view=>({pipeline:'customers',leads:'customers',applications:'customers',documents:'customers',inbox:'customers',outbox:'customers',catalog:'products',pricing:'products',usedMotorInventory:'products',handphoneCatalog:'products',handphonePricing:'products',team:'management',users:'management',activity:'management',settings:'management'}[view]||view);
const primaryViewsForRole=role=>{
  const normalized=String(role||'').toUpperCase().replace('BRANCH_MANAGER','BRANCH_SUPERVISOR');
  if(normalized==='STAFF')return new Set(['dashboard','customers','workbench','followup','products']);
  if(['BRANCH_SUPERVISOR','BUSINESS_MANAGER'].includes(normalized))return new Set(['dashboard','customers','workbench','followup','products','reports','management']);
  return new Set(['dashboard','customers','workbench','followup','products','reports','management']);
};
function syncPrimaryNavigation(){const visible=primaryViewsForRole(state.user?.role);document.querySelectorAll('.nav-item[data-view]').forEach(item=>{item.hidden=!visible.has(item.dataset.view);item.classList.toggle('active',item.dataset.view===primaryViewFor(state.view))})}
function setNavBadge(id,value){const badge=document.getElementById(id);if(!badge)return;const count=Math.max(0,Number(value||0));badge.textContent=count;badge.hidden=count===0}
async function navigateToView(view){state.view=view;await ensureViewData(view);render();document.getElementById('sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'auto'})}
function bindHubNavigation(){document.querySelectorAll('[data-open-view]').forEach(button=>button.onclick=()=>navigateToView(button.dataset.openView).catch(error=>showWorkspaceError(error.message)));document.querySelectorAll('[data-open-customer]').forEach(button=>button.onclick=()=>runGlobalSearch(button.dataset.openCustomer||'').catch(error=>showWorkspaceError(error.message)))}
const head=(title,desc)=>`<div class="page-head"><div>${state.view!=='dashboard'?'<button class="page-breadcrumb" data-open-view="dashboard">Home / <span>'+esc(title)+'</span></button>':'<div class="eyebrow">JomKaki Rider CRM</div>'}<h1>${title}</h1><p>${desc}</p></div><div class="page-actions"><button class="secondary" data-refresh>Refresh data</button></div></div><div class="status-strip"><span class="live-dot"></span><strong>Live CRM connected</strong><span>${esc(state.user?.role||'')}</span></div>`;
const metric=(label,value,note)=>`<article class="metric-card"><span>${label}</span><strong>${value??0}</strong><small>${note}</small></article>`;
const operationalValue=value=>String(value||'').trim().toUpperCase();
const hasMeaningfulValue=value=>value!==undefined&&value!==null&&String(value).trim()!==''&&!['NONE','NONE RECORDED','NOT PROVIDED','UNKNOWN','—'].includes(operationalValue(value));
const isCompletedCase=application=>{const values=[operationalValue(application?.stage),operationalValue(application?.status)],terminal=['COMPLETED','REJECTED','CANCELLED','CLOSED'].some(value=>values.includes(value));if(terminal)return true;if(!values.includes('APPROVED'))return false;return['COMPLETED','ACTIVE'].includes(operationalValue(application?.directDebitStatus))&&['SIGNED','COMPLETED','APPROVED'].includes(operationalValue(application?.agreementStatus))};
function customerNextAction(application={}){
  const stage=operationalValue(application.stage),status=operationalValue(application.status),followUp=operationalValue(application.followUpStatus),lms=operationalValue(application.lmsSubmissionStatus),consent=operationalValue(application.creditConsentStatus||application.consentStatus),directDebit=operationalValue(application.directDebitStatus),agreement=operationalValue(application.agreementStatus),approvedJourney=status==='APPROVED'||/(APPROVED|ACCEPTED|SUCCESS)/.test(operationalValue(application.cadStatus))||['APPROVED','ACCEPTED','SUCCESS','COMPLETED'].includes(lms);
  const documents=Number(application.documentsReceived||0),missing=hasMeaningfulValue(application.missingDocuments)?String(application.missingDocuments):'',missingFields=hasMeaningfulValue(application.missingApplicationFields)?String(application.missingApplicationFields):'';
  const review=application.documentNeedsReview||operationalValue(application.reviewRequired)==='TRUE'||['REJECTED','POOR','MANUAL_REVIEW'].includes(operationalValue(application.documentStatus));
  if(isCompletedCase(application))return{key:'complete',label:'No action required',detail:`Case ${pretty(application.status||application.stage)}`,tone:'complete',priority:0,view:'applications'};
  if(application.handoverReason||stage.includes('HUMAN')||status.includes('HANDOVER'))return{key:'handover',label:'Handle customer now',detail:application.handoverReason||'Customer needs a human reply',tone:'urgent',priority:100,view:'workbench'};
  if(['FAILED','ERROR','TEMPLATE_REQUIRED','HANDED_OVER'].includes(followUp))return{key:'followup',label:'Resolve follow-up issue',detail:application.followUpPauseReason||'Automatic follow-up could not continue',tone:'urgent',priority:95,view:'followup'};
  if(review)return{key:'review',label:'Review document exception',detail:'AI could not verify one or more files',tone:'urgent',priority:90,view:'documents'};
  if(['READY_FOR_LMS','READY','QUEUED'].includes(lms)||stage==='READY_FOR_LMS')return{key:'lms',label:'Submit to LMS',detail:'Customer file is ready for submission',tone:'ready',priority:85,view:'applications'};
  if(!documents||missing)return{key:'documents',label:'Collect remaining documents',detail:missing||'Ask customer to send IC and income proof',tone:'attention',priority:80,view:'followup'};
  if(!['SIGNED','VERIFIED','COMPLETED','APPROVED'].includes(consent))return{key:'consent',label:'Send or collect signed consent',detail:'Consent can be signed while other details are completed',tone:'attention',priority:75,view:'followup'};
  if(missingFields)return{key:'information',label:'Complete application information',detail:missingFields,tone:'attention',priority:70,view:'applications'};
  if(application.verificationPendingDocuments)return{key:'verification',label:'Finish document verification',detail:'Received files are waiting for AI verification',tone:'attention',priority:65,view:'documents'};
  if(approvedJourney&&!['COMPLETED','ACTIVE'].includes(directDebit))return{key:'completion',label:'Complete Direct Debit',detail:'Customer action is still required after approval',tone:'attention',priority:68,view:'followup'};
  if(approvedJourney&&!['SIGNED','COMPLETED','APPROVED'].includes(agreement))return{key:'completion',label:'Collect signed agreement',detail:'Agreement is still waiting for the customer',tone:'attention',priority:67,view:'followup'};
  if(application.nextFollowUp){const overdue=new Date(application.nextFollowUp).valueOf()<=Date.now();return{key:'followup',label:overdue?'Follow up now':'Follow up customer',detail:overdue?'Reminder is overdue':`Scheduled ${when(application.nextFollowUp)}`,tone:overdue?'urgent':'normal',priority:overdue?60:35,view:'followup'};}
  if(!application.sa||operationalValue(application.sa)==='UNASSIGNED')return{key:'owner',label:'Assign an owner',detail:'No Sales Advisor is responsible for this case',tone:'attention',priority:55,view:'workbench'};
  return{key:'contact',label:'Continue customer conversation',detail:'Answer questions and move the application forward',tone:'normal',priority:30,view:'inbox'};
}
function nextActionCell(application){const action=customerNextAction(application);return `<div class="next-action ${esc(action.tone)}"><strong>${esc(action.label)}</strong><small>${esc(action.detail)}</small>${application.nextFollowUp?`<span>${esc(when(application.nextFollowUp))}</span>`:''}</div>`}
function operationalApplications(){return businessApplications().filter(application=>!isCompletedCase(application)).map(application=>({application,action:customerNextAction(application)})).sort((a,b)=>b.action.priority-a.action.priority||customer360TimeValue(a.application.nextFollowUp||a.application.updated)-customer360TimeValue(b.application.nextFollowUp||b.application.updated))}
function pipelineStageFor(application={}){
  const action=customerNextAction(application),stage=operationalValue(application.stage),status=operationalValue(application.status),lms=operationalValue(application.lmsSubmissionStatus);
  if(isCompletedCase(application))return'COMPLETED';
  if(['handover','followup'].includes(action.key)&&action.priority>=90)return'ATTENTION';
  if(action.key==='completion')return'ATTENTION';
  if(['lms'].includes(action.key)||['SUBMITTED','PROCESSING','APPROVED','REJECTED'].includes(lms))return'READY_FOR_LMS';
  if(action.key==='verification')return'VERIFICATION';
  if(action.key==='consent'||stage.includes('CONSENT'))return'CONSENT';
  if(action.key==='documents'||action.key==='review'||stage.includes('DOCUMENT'))return'DOCUMENTS';
  if(action.key==='information'||stage.includes('INFORMATION')||status.includes('INCOMPLETE'))return'INFORMATION';
  return'NEW';
}
const pipelineColumns=[['NEW','New / qualified'],['INFORMATION','Information'],['DOCUMENTS','Documents'],['CONSENT','Consent'],['VERIFICATION','Verification'],['ATTENTION','Needs attention'],['READY_FOR_LMS','Ready / LMS'],['COMPLETED','Decision / done']];
function customerMessagePreview(item={},fallback='Open the conversation'){
  const message=String(item.message||'').trim(),placeholder=message.match(/^\[([^\]]+)\]$/);
  if(message&&!placeholder)return message;
  const type=operationalValue(item.attachmentType||item.messageType||placeholder?.[1]);
  const labels={IMAGE:'Photo received',DOCUMENT:'Document received',AUDIO:'Voice note received',VOICE:'Voice note received',VIDEO:'Video received',STICKER:'Sticker received',LOCATION:'Location received',CONTACT:'Contact received',CONTACTS:'Contact received',REACTION:'WhatsApp reaction received'};
  return labels[type]||((placeholder||type==='UNSUPPORTED')?'WhatsApp attachment or action received':fallback);
}
function customerMessageTypeLabel(item={}){
  const type=operationalValue(item.attachmentType||item.messageType);
  const labels={TEXT:'Text',IMAGE:'Photo',DOCUMENT:'Document',AUDIO:'Voice note',VOICE:'Voice note',VIDEO:'Video',STICKER:'Sticker',LOCATION:'Location',CONTACT:'Contact',CONTACTS:'Contact',REACTION:'Reaction'};
  if(!type||type==='UNSUPPORTED')return'';
  return labels[type]||pretty(type);
}
function customerSourceLabel(value=''){
  const source=operationalValue(value),labels={WHATSAPP_CLOUD:'WhatsApp Cloud',WHATSAPP:'WhatsApp',WEBSITE_ENQUIRY:'Website enquiry',WALK_IN:'Walk-in',CRM_MANUAL:'CRM manual entry'};
  return labels[source]||pretty(value||'Not provided');
}
function crmNotifications(){
  const items=[],seen=new Set(),push=item=>{const key=item.key||`${item.type}-${item.applicationId||item.leadId||item.id}`;if(!seen.has(key)){seen.add(key);items.push({...item,key})}};
  state.data.inbox.filter(item=>!isDemoRecord(item)&&(item.humanRequired||['UNREAD','NEW','RECEIVED','HUMAN_HANDOVER_REQUIRED'].includes(operationalValue(item.status)))).forEach(item=>push({key:item.applicationId?`customer-${item.applicationId}`:`message-${item.id}`,type:'message',group:'Customer replies',customer:item.customer||item.phone||'Customer',context:'Unread WhatsApp reply',title:item.humanRequired?'Human reply requested':'Reply customer now',detail:customerMessagePreview(item,'Open the conversation and answer the customer'),tone:item.humanRequired?'urgent':'normal',priority:item.humanRequired?100:80,leadId:item.leadId,applicationId:item.applicationId,phone:item.phone,view:'inbox',id:item.id}));
  operationalApplications().filter(({action})=>action.priority>=60).forEach(({application,action})=>push({key:`customer-${application.id}`,type:action.key,group:action.key==='lms'?'Ready for LMS':'Customer actions',customer:application.customer||application.phone||application.id,context:application.product||application.id,title:action.label,detail:action.detail,tone:action.tone,priority:action.priority,leadId:application.leadId,applicationId:application.id,phone:application.phone,view:action.view}));
  state.data.outbox.filter(item=>!isDemoRecord(item)&&['FAILED','ERROR'].includes(operationalValue(item.status))).forEach(item=>push({type:'delivery',group:'Delivery issues',customer:item.recipient||'Customer',context:'WhatsApp delivery',title:'Resolve failed message',detail:item.message||'Open sent messages and retry safely',tone:'urgent',priority:92,leadId:item.leadId,applicationId:item.applicationId,phone:item.recipient,view:'outbox',id:item.id}));
  return items.sort((a,b)=>b.priority-a.priority);
}
function notificationCount(){const loaded=loadedResources.has('inbox')||loadedResources.has('outbox');return loaded?crmNotifications().length:Math.max(Number(state.summary.needsAttention||0),Number(state.summary.unreadInbox||0))}
function updateNotificationBadge(){const badge=document.querySelector('[aria-label="Notifications"] em');if(!badge)return;const count=notificationCount();badge.textContent=count;badge.hidden=count===0}
async function openNotificationCentre(){
  const resources=['inbox','outbox','activity'],missing=resources.filter(resource=>!loadedResources.has(resource));
  if(missing.length){const responses=await Promise.all(missing.map(resource=>optional(resource,{timeoutMs:6000})));missing.forEach((resource,index)=>{state.data[resource]=responses[index].records||[];if(!responses[index].unavailable)loadedResources.add(resource)})}
  const items=crmNotifications(),groups=[...new Set(items.map(item=>item.group))];updateNotificationBadge();
  drawer('Notification Centre',`${items.length} action${items.length===1?'':'s'} across customer replies, documents, follow-up and LMS`,`<div class="notification-summary"><strong>Everything requiring action is collected here</strong><span>Open the customer or jump directly to the correct workspace.</span></div>${groups.map(group=>`<section class="notification-group"><header><h3>${esc(group)}</h3><span>${items.filter(item=>item.group===group).length}</span></header>${items.filter(item=>item.group===group).map(item=>`<button class="notification-row ${esc(item.tone)}" data-notification-customer data-lead-id="${esc(item.leadId||'')}" data-application-id="${esc(item.applicationId||'')}" data-phone="${esc(item.phone||'')}" data-notification-view="${esc(item.view||'workbench')}"><span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span><em>Open →</em></button>`).join('')}</section>`).join('')||'<div class="notification-empty"><strong>You are all caught up</strong><p>New replies, overdue follow-ups, document exceptions and LMS-ready cases will appear here.</p></div>'}`);
  document.querySelectorAll('[data-notification-customer]').forEach(button=>button.onclick=async()=>{document.querySelector('.drawer-backdrop')?.remove();if(button.dataset.leadId||button.dataset.applicationId||button.dataset.phone)return openCustomer360({leadId:button.dataset.leadId,applicationId:button.dataset.applicationId,phone:button.dataset.phone});return navigateToView(button.dataset.notificationView)});
}
async function get(resource,{timeoutMs=20000}={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const r=await fetch(`/api/crm?resource=${resource}&_=${Date.now()}`,{cache:'no-store',signal:controller.signal});if(r.status===401)throw new Error('AUTH');const p=await r.json();if(!r.ok||!p.live)throw new Error(p.error||'Unable to load data');return p}catch(error){if(error?.name==='AbortError')throw new Error('TIMEOUT');throw error}finally{clearTimeout(timer)}}
async function optional(resource,options={}){try{return await get(resource,options)}catch(e){if(e.message==='AUTH')throw e;return{records:[],unavailable:true,error:e.message||'Unable to load data'}}}
async function post(action,payload){const r=await fetch('/api/crm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});const p=await r.json();if(!r.ok||!p.live)throw new Error(p.error||'Unable to save');return p}
const MAX_UPLOAD_BYTES=3*1024*1024;
const allowedUploadTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']);
const validateBrowserFile=(file,{imageOnly=false}={})=>{if(!file)throw new Error('Choose a file first.');const type=String(file.type||'').toLowerCase();if(!allowedUploadTypes.has(type)||(imageOnly&&!type.startsWith('image/')))throw new Error(imageOnly?'Use a JPG, PNG, WebP or HEIC photo.':'Use a PDF, JPG, PNG, WebP or HEIC document.');if(!file.size||file.size>MAX_UPLOAD_BYTES)throw new Error('Each file must be between 1 byte and 3 MB.');return file};
const fileData=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
async function ensureCatalogForForms(){if(loadedResources.has('catalog')&&state.data.catalog.length)return;const response=await get('catalog');state.data.catalog=response.records||[];loadedResources.add('catalog')}
const catalogOptions=(selected={})=>state.data.catalog.filter(item=>item.active).map(item=>{const matches=selected.catalogId===item.id||(!selected.catalogId&&String(selected.brand||'').toLowerCase()===String(item.brand||'').toLowerCase()&&String(selected.model||'').toLowerCase()===String(item.model||'').toLowerCase()&&String(selected.variant||'Standard').toLowerCase()===String(item.variant||'Standard').toLowerCase());return `<option value="${esc(item.id)}" ${matches?'selected':''}>${esc([item.brand,item.model,item.variant].filter(Boolean).join(' '))} · ${esc(item.id)}</option>`}).join('');
const normalizePhone=value=>{let digits=String(value||'').replace(/\D/g,'');if(digits.startsWith('0'))digits=`60${digits.slice(1)}`;return digits};
async function ensureCustomer360Data(){const resources=['inbox','outbox','activity'],missing=resources.filter(resource=>!loadedResources.has(resource));if(!missing.length)return{unavailable:[]};const responses=await Promise.all(missing.map(resource=>optional(resource,{timeoutMs:6000}))),unavailable=[];missing.forEach((resource,index)=>{const response=responses[index];state.data[resource]=response.records||[];if(response.unavailable)unavailable.push(resource);else loadedResources.add(resource)});return{unavailable}}
function customerSearchCandidates(){const seen=new Set(),results=[];const add=item=>{const key=item.leadId||item.applicationId||normalizePhone(item.phone)||String(item.name||'').toLowerCase();if(!key||seen.has(key))return;seen.add(key);results.push(item)};state.data.leads.forEach(lead=>add({leadId:lead.id,applicationId:lead.applicationId,phone:lead.phone,name:lead.name,motor:lead.model,status:lead.status,search:Object.values(lead).join(' ')}));state.data.applications.forEach(application=>add({leadId:application.leadId,applicationId:application.id,phone:application.phone,name:application.customer,motor:application.product,status:application.stage||application.status,search:Object.values(application).join(' ')}));state.data.inbox.forEach(message=>add({leadId:message.leadId,applicationId:message.applicationId,phone:message.phone,name:message.customer,motor:'',status:message.status,search:Object.values(message).join(' ')}));return results}
function bindCustomerProfileButtonsLegacy(){document.querySelectorAll('[data-customer-profile]').forEach(button=>button.onclick=()=>openCustomer360({leadId:button.dataset.leadId||'',applicationId:button.dataset.applicationId||'',phone:button.dataset.phone||''}).catch(error=>alert(error.message)))}
async function runGlobalSearch(query){const q=String(query||'').trim();if(!q)return;await ensureCustomer360Data();const matches=customerSearchCandidates().filter(item=>`${item.name} ${item.phone} ${item.motor} ${item.status} ${item.search}`.toLowerCase().includes(q.toLowerCase())).slice(0,40);drawer('Customer search',`${matches.length} result${matches.length===1?'':'s'} for "${esc(q)}"`,`<div class="customer-search-results">${matches.map(item=>`<button class="customer-search-card" data-customer-profile data-lead-id="${esc(item.leadId||'')}" data-application-id="${esc(item.applicationId||'')}" data-phone="${esc(item.phone||'')}"><span><strong>${esc(item.name||item.phone||'Customer')}</strong><small>${esc([item.phone,item.motor].filter(Boolean).join(' | '))}</small></span>${pill(item.status||'Open',true)}</button>`).join('')||'<div class="customer-360-empty"><strong>No matching customer found</strong><p>Try a name, phone number, Lead ID, Application ID or motorcycle model.</p></div>'}</div>`,'customer-search-drawer');bindCustomerProfileButtons()}
function showWorkspaceError(message='Unable to refresh CRM data'){
  const text=message==='TIMEOUT'?'The data source took too long to respond. Your login is still active.':message;
  app.insertAdjacentHTML('afterbegin',`<div class="refresh-error-banner" role="alert"><div><strong>Data refresh was not completed</strong><span>${esc(text||'Please try again in a moment. Your login is still active.')}</span></div><button class="secondary" data-retry-refresh>Try again</button></div>`);
  document.querySelector('[data-retry-refresh]')?.addEventListener('click',async()=>{if(await load()){await ensureViewData(state.view);render()}});
}
async function load(){
  const wasLoaded=state.loaded;
  app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading live CRM…</p></div>';
  try{
    const [session,dashboard,leads,applications,documents,team,inbox,outbox]=await Promise.all([get('session'),get('dashboard'),get('leads'),optional('applications'),optional('documents'),optional('team'),optional('inbox',{timeoutMs:6000}),optional('outbox',{timeoutMs:6000})]);
    state.user=session.user;state.summary=dashboard.summary;state.knowledge=dashboard.knowledge||null;state.lastLiveRefresh=dashboard.updatedAt||new Date().toISOString();
    Object.assign(state.data,{leads:leads.records||[],applications:applications.records||[],documents:documents.records||[],team:team.records||[],inbox:inbox.records||[],outbox:outbox.records||[],catalog:[],pricing:[],activity:[],integrations:[],channels:[],secondHandMotors:[],followUpSettings:[]});
    loadedResources.clear();['leads','applications','documents','team'].forEach(x=>loadedResources.add(x));if(!inbox.unavailable)loadedResources.add('inbox');if(!outbox.unavailable)loadedResources.add('outbox');state.loaded=true;shell.hidden=false;gate.classList.add('hidden');
    document.getElementById('profileName').textContent=state.user.name;
    document.getElementById('profileRole').textContent=state.user.role==='ADMIN'?'Administrator':state.user.role==='STAFF'?`Sales Advisor · ${state.user.saId}`:['BRANCH_MANAGER','BRANCH_SUPERVISOR'].includes(state.user.role)?`Branch Supervisor · ${state.user.branchId}`:`${pretty(state.user.region)} Manager`;
    document.querySelector('.integration-card small').textContent=state.user.whatsappMode==='CLOUD'?'Cloud API connected':'Manual ready · Cloud pending';
    setNavBadge('leadBadge',state.summary.leads);document.getElementById('applicationBadge').textContent=state.summary.applications||0;document.getElementById('inboxBadge').textContent=state.summary.unreadInbox||0;setNavBadge('workBadge',state.summary.needsAttention);updateNotificationBadge();
    syncPrimaryNavigation();render();return true;
  }catch(error){
    if(error?.message==='AUTH'){
      state.loaded=false;shell.hidden=true;gate.classList.remove('hidden');document.getElementById('loginError').textContent='Your session has expired. Please sign in again.';return false;
    }
    if(wasLoaded){shell.hidden=false;gate.classList.add('hidden');render();showWorkspaceError(error?.message);return false}
    shell.hidden=true;gate.classList.remove('hidden');document.getElementById('loginError').textContent='CRM data is temporarily unavailable. Your account was not rejected. Please try again.';return false;
  }
}
let liveRefreshBusy=false;
async function refreshLiveWorkspace(){
  if(liveRefreshBusy||!state.loaded||document.hidden||document.querySelector('.drawer-backdrop'))return;
  liveRefreshBusy=true;
  try{
    const [dashboard,leads,applications,documents,inbox,outbox]=await Promise.all([get('dashboard',{timeoutMs:10000}),get('leads',{timeoutMs:10000}),optional('applications',{timeoutMs:10000}),optional('documents',{timeoutMs:10000}),optional('inbox',{timeoutMs:10000}),optional('outbox',{timeoutMs:10000})]);
    state.summary=dashboard.summary||state.summary;state.knowledge=dashboard.knowledge||state.knowledge;state.lastLiveRefresh=dashboard.updatedAt||new Date().toISOString();
    state.data.leads=leads.records||state.data.leads;if(!applications.unavailable)state.data.applications=applications.records||[];if(!documents.unavailable)state.data.documents=documents.records||[];if(!inbox.unavailable)state.data.inbox=inbox.records||[];if(!outbox.unavailable)state.data.outbox=outbox.records||[];
    setNavBadge('leadBadge',state.summary.leads);document.getElementById('applicationBadge').textContent=state.summary.applications||0;document.getElementById('inboxBadge').textContent=state.summary.unreadInbox||0;setNavBadge('workBadge',state.summary.needsAttention);render();
  }catch(error){state.liveRefreshError=error.message||'Unable to refresh';}
  finally{liveRefreshBusy=false}
}
function dashboardLegacy(){const s=state.summary;app.innerHTML=head('Command Centre','AI-managed applications, exception queues and LMS readiness in your permitted scope.')+`<div class="metric-grid">${metric('Total leads',s.leads,'Your permitted scope')}${metric('Applications',s.applications,'Financing cases')}${metric('AI exceptions',s.aiExceptions||0,'Assigned only when AI cannot finish')}${metric('Ready for LMS',s.lmsReady||0,'Documents verified complete')}${metric('Human handovers',s.humanHandovers,'Manager attention')}${metric('Needs attention',s.needsAttention,'Exceptions and recovery')}${metric('Completed',s.completed,'Finished cases')}${metric('Unread inbox',s.unreadInbox,'Customer replies')}</div><section class="panel" style="margin-top:16px"><div class="panel-head"><h3>Latest applications</h3></div>${applicationTable(state.data.applications.slice(0,10))}</section>`}
function leadTableLegacy(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer</th><th>Motor</th><th>Application</th><th>Region</th><th>Status</th><th>Owner</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.id)} · ${esc(x.phone)}</small></td><td>${esc(x.model)}</td><td>${x.applicationId?`${esc(x.applicationId)}<br>${pretty(x.applicationStatus)}`:'—'}</td><td>${pretty(x.region)}</td><td>${pill(x.status,true)}</td><td>${esc(x.sa)}</td><td><button class="row-action" data-lead="${esc(x.id)}">Open</button></td></tr>`).join('')||empty(7)}</tbody></table></div>`}
function leads(){app.innerHTML=head('Lead Pipeline','Customer, motorcycle interest, application status and ownership in one view.')+`<div class="smart-toolbar"><input id="search" placeholder="Search customer, phone, motorcycle or Lead ID"><div class="toolbar-spacer"></div>${pill(`${state.data.leads.length} live leads`,true)}</div><section class="panel" id="results">${leadTable(state.data.leads)}</section>`;document.getElementById('search').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('results').innerHTML=leadTable(state.data.leads.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q)))};bind()}
function applicationTableLegacy(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer</th><th>Motor</th><th>Financing</th><th>Documents</th><th>Missing</th><th>Stage</th><th>Owner</th><th>Actions</th></tr></thead><tbody>${rows.map(a=>`<tr><td><strong>${esc(a.customer)}</strong><small>${esc(a.id)}</small></td><td><strong>${esc(a.product||'Not selected')}</strong><small>${pretty(a.priceZone||a.region)}</small></td><td>${money(a.deposit)} deposit<br>${a.monthly?`${money(a.monthly)}/month · ${esc(a.tenure)} years`:'Quote pending'}</td><td><strong>${a.documentsReceived||0}</strong> received<br>${pretty(a.documentStatus||'Pending')}</td><td>${esc(a.missingDocuments||(a.verificationPendingDocuments?'Received · verification pending':'None'))}</td><td>${pill(a.stage,true)}<br>${pretty(a.status)}</td><td>${esc(a.sa)}</td><td><div class="row-actions"><button class="row-action whatsapp-action" data-whatsapp="${esc(a.id)}">WhatsApp</button><button class="row-action" data-upload="${esc(a.id)}">Upload</button><button class="row-action secondary" data-app="${esc(a.id)}">Manage</button></div></td></tr>`).join('')||empty(8)}</tbody></table></div>`}
function applicationFilterMatch(application,filter){const action=customerNextAction(application);return filter==='ALL'||(filter==='OPEN'&&!isCompletedCase(application))||(filter==='DOCUMENTS'&&['documents','review','verification'].includes(action.key))||(filter==='CONSENT'&&action.key==='consent')||(filter==='DUE'&&action.priority>=60)||(filter==='LMS'&&action.key==='lms')}
function applications(){
  const active=state.applicationFilter||'ALL',filters=[['ALL','All'],['OPEN','Open'],['DOCUMENTS','Needs documents'],['CONSENT','Consent'],['DUE','Due now'],['LMS','Ready for LMS']];
  const renderResults=query=>{const q=String(query||'').toLowerCase(),rows=state.data.applications.filter(application=>applicationFilterMatch(application,state.applicationFilter||'ALL')&&Object.values(application).join(' ').toLowerCase().includes(q));document.getElementById('results').innerHTML=applicationTable(rows);bind()};
  app.innerHTML=head('Applications','Motorcycle, document progress, AI exceptions and LMS readiness in one view.')+`<div class="security-banner upload-banner"><div><strong>One next action for every application</strong><p>Use the operational filters to find documents, consent, overdue work or LMS-ready cases without scanning every column.</p></div></div><div class="application-filter-tabs">${filters.map(([key,label])=>`<button class="${active===key?'active':''}" data-application-filter="${key}">${label}<span>${state.data.applications.filter(application=>applicationFilterMatch(application,key)).length}</span></button>`).join('')}</div><div class="smart-toolbar"><input id="search" placeholder="Search customer, application, motorcycle or status"><div class="toolbar-spacer"></div>${pill(`${state.data.applications.length} live applications`,true)}</div><section class="panel" id="results">${applicationTable(state.data.applications.filter(application=>applicationFilterMatch(application,active)))}</section>`;
  document.getElementById('search').oninput=event=>renderResults(event.target.value);document.querySelectorAll('[data-application-filter]').forEach(button=>button.onclick=()=>{state.applicationFilter=button.dataset.applicationFilter;applications();bind()});bind();
}
function workbench(){
  const ranked=operationalApplications(),handovers=state.data.inbox.filter(item=>!isDemoRecord(item)&&item.humanRequired);
  const documentCases=ranked.filter(({action})=>['documents','review','verification'].includes(action.key)),reviewCases=ranked.filter(({action})=>action.key==='review'),followUpCases=ranked.filter(({action})=>action.key==='followup'),actionCases=ranked.filter(({action})=>action.priority>=55).map(({application})=>application);
  app.innerHTML=head('Tasks & Approvals','Customer handovers, document exceptions and AI reviews requiring action inside your permitted scope.')+`<div class="metric-grid">${metric('Human handovers',handovers.length,state.user?.role==='STAFF'?'Visible only when assigned':'Manager action required')}${metric('Incomplete documents',documentCases.length,'Open cases only')}${metric('AI review exceptions',reviewCases.length,state.user?.role==='STAFF'?'Manager decision required':'Resolve failed AI checks')}${metric('Follow-ups',followUpCases.length,'Scheduled or failed follow-ups')}</div>${handovers.length?`<section class="panel urgent-panel"><div class="panel-head"><h3>Human handover queue</h3></div>${inboxTable(handovers)}</section>`:''}<section class="panel"><div class="panel-head"><div><h3>Cases requiring action</h3><p>Open customer cases ranked by the next action required. Completed and test records stay out of this queue.</p></div></div>${applicationTable(actionCases)}</section>`;
  bindMessaging();
}
const hubCard=(view,kicker,title,description,count='',action='Open')=>`<button class="hub-card" data-open-view="${esc(view)}"><span class="hub-kicker">${esc(kicker)}</span><strong>${esc(title)}</strong><p>${esc(description)}</p><span class="hub-card-footer">${count!==''?`<b>${esc(count)}</b>`:''}<em>${esc(action)} →</em></span></button>`;
function customers(){
  const customerDocuments=businessDocuments(),pendingDocuments=customerDocuments.filter(item=>String(item.reviewRequired).toUpperCase()==='TRUE'||['PENDING','PENDING_AI','AI_QUEUED'].includes(String(item.verification||item.classification||'').toUpperCase())).length;
  app.innerHTML=head('Customers','One starting point for every customer, application, file and conversation.')+
    `<section class="customer-hub-search"><div><span class="eyebrow">CUSTOMER 360</span><h2>Find the complete customer record</h2><p>Search once to see contact details, product, financing, documents, consent, WhatsApp history and LMS status together.</p></div><div class="hub-search-control"><input id="customerHubSearch" placeholder="Name, phone, Lead ID or Application ID"><button class="primary" data-search-customer>Search customer</button></div></section>`+
    `<div class="hub-grid">${hubCard('pipeline','PIPELINE','Customer progress','See every active customer by the next stage they must complete.',businessApplications().filter(application=>!isCompletedCase(application)).length)}${hubCard('leads','CUSTOMERS','All customers','Customer ownership, current interest and status.',businessLeads().length)}${hubCard('applications','FINANCING','Applications','Product, financing, consent and LMS progress.',businessApplications().length)}${hubCard('documents','SECURE FILES','Documents','Received files, AI checks and exceptions.',`${customerDocuments.length} files · ${pendingDocuments} pending`)}${hubCard('inbox','CONVERSATIONS','Customer messages','WhatsApp conversations and human handovers.',state.summary.unreadInbox||0)}${hubCard('outbox','DELIVERY','Sent & queued replies','Messages bound to the correct official number.',state.data.outbox.length)}</div>`+
    `<section class="panel hub-latest"><div class="panel-head"><div><h3>Latest applications</h3><p>Open any row for the complete Customer 360 record.</p></div><button class="secondary" data-open-view="applications">View all applications</button></div>${applicationTable(businessApplications().slice(0,8))}</section>`;
  const search=document.getElementById('customerHubSearch'),run=()=>runGlobalSearch(search.value).catch(error=>showWorkspaceError(error.message));
  document.querySelector('[data-search-customer]').onclick=run;search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();run()}};bindHubNavigation();bind();
}
function pipeline(){
  const applications=businessApplications(),leadIds=new Set(applications.map(application=>application.leadId).filter(Boolean));
  const unconverted=businessLeads().filter(lead=>!lead.applicationId&&!leadIds.has(lead.id));
  const counts=Object.fromEntries(pipelineColumns.map(([key])=>[key,applications.filter(application=>pipelineStageFor(application)===key).length+(key==='NEW'?unconverted.length:0)]));
  const columns=pipelineColumns.map(([key,label])=>{
    const applicationCards=applications.filter(application=>pipelineStageFor(application)===key).map(application=>{const action=customerNextAction(application);return `<article class="pipeline-card ${esc(action.tone)}"><header><span>${esc(application.id)}</span>${pill(application.stage||application.status||label,key==='COMPLETED')}</header><h4>${esc(application.customer||'Customer')}</h4><p>${esc(application.product||'Product not selected')}</p><div class="pipeline-next"><span>Next action</span><strong>${esc(action.label)}</strong><small>${esc(action.detail)}</small></div><footer><span>${esc(application.sa||'Unassigned')}</span><button class="row-action" data-customer-profile data-lead-id="${esc(application.leadId||'')}" data-application-id="${esc(application.id)}" data-phone="${esc(application.phone||'')}">Open</button></footer></article>`}).join('');
    const leadCards=key==='NEW'?unconverted.map(lead=>`<article class="pipeline-card normal"><header><span>${esc(lead.id)}</span>${pill(lead.status||'New')}</header><h4>${esc(lead.name||'Customer')}</h4><p>${esc(lead.model||'Product not selected')}</p><div class="pipeline-next"><span>Next action</span><strong>Continue conversation</strong><small>Qualify interest and start the application when ready</small></div><footer><span>${esc(lead.sa||'AI managed')}</span><button class="row-action" data-customer-profile data-lead-id="${esc(lead.id)}" data-phone="${esc(lead.phone||'')}">Open</button></footer></article>`).join(''):'';
    return `<section class="pipeline-column"><div class="pipeline-title"><strong>${esc(label)}</strong><span>${counts[key]}</span></div>${applicationCards}${leadCards||''}${!applicationCards&&!leadCards?'<div class="pipeline-empty">No customers here</div>':''}</section>`;
  }).join('');
  app.innerHTML=head('Customer Pipeline','Every active customer is placed by the next stage they need to complete, from first enquiry to LMS decision.')+`<div class="pipeline-summary">${pipelineColumns.map(([key,label])=>`<div><span>${esc(label)}</span><strong>${counts[key]}</strong></div>`).join('')}</div><div class="pipeline-board operational-pipeline">${columns}</div>`;
  bindCustomerProfileButtons();
}
function products(){
  const role=String(state.user?.role||'').toUpperCase(),access=['ADMIN','REGION_MANAGER'].includes(role)?'BOTH':String(state.user?.businessAccess||'BOTH').toUpperCase(),motorAllowed=access!=='HANDPHONE',handphoneAllowed=access!=='MOTOR';
  const visibleCatalogRecord=item=>!/TEMPLATE/i.test(String(item.id||''))&&String(item.approvalStatus||'APPROVED').toUpperCase()!=='MERGED',visiblePricingRecord=item=>!/TEMPLATE/i.test(String(item.id||''));
  const productCatalog=state.data.catalog.filter(visibleCatalogRecord),productPricing=state.data.pricing.filter(visiblePricingRecord),motorCatalog=productCatalog.filter(item=>String(item.businessUnit||'MOTOR').toUpperCase()!=='HANDPHONE').length,handphoneCatalog=productCatalog.filter(item=>String(item.businessUnit||'').toUpperCase()==='HANDPHONE').length;
  const cards=[];
  if(motorAllowed){cards.push(hubCard('catalog','NEW MOTOR','Motor catalog','Models, images, availability and approval status.',motorCatalog));cards.push(hubCard('pricing','FINANCING','Motor pricing & promotions','Deposits, monthly plans and approved promotions.',productPricing.filter(item=>String(item.businessUnit||'MOTOR').toUpperCase()!=='HANDPHONE').length));cards.push(hubCard('usedMotorInventory','2ND HAND','Used motor inventory','Branch stock, photos, prices and approval workflow.',state.data.secondHandMotors?.length||state.data.usedMotors?.length||0))}
  if(handphoneAllowed){cards.push(hubCard('handphoneCatalog','HANDPHONE','Handphone catalog','Models, storage, colours, images and approval.',handphoneCatalog));cards.push(hubCard('handphonePricing','MONTHLY ONLY','Handphone instalments','Approved monthly payments by model, storage and region.',productPricing.filter(item=>String(item.businessUnit||'').toUpperCase()==='HANDPHONE').length))}
  app.innerHTML=head('Products & Pricing','Motor, second-hand motor and handphone controls are grouped by business line.')+`<div class="hub-section-intro"><div><span class="eyebrow">PRODUCT CENTRE</span><h2>Choose the business line first</h2><p>Catalog, images, pricing, promotions and approvals stay together instead of appearing as unrelated sidebar pages.</p></div></div><div class="hub-grid product-hub-grid">${cards.join('')}</div>`;bindHubNavigation();bind();
}
function management(){
  const role=String(state.user?.role||'').toUpperCase().replace('BRANCH_MANAGER','BRANCH_SUPERVISOR'),admin=role==='ADMIN';
  const cards=[hubCard('team','PEOPLE','Branches & team','Staff availability, branch assignment and lead acceptance.',state.data.team.length),hubCard('activity','CONTROL','Activity & audit','Who changed what, when and for which customer.','')];
  if(admin){cards.unshift(hubCard('users','ACCESS','Users & access','Create accounts, reset passwords and manage permissions.',state.data.users.length));cards.push(hubCard('settings','SYSTEM','System settings','Integrations, WhatsApp numbers, safety and readiness.',''))}
  app.innerHTML=head('Management',admin?'Accounts, teams, audit and system controls in one administrative area.':'Team visibility and operational audit inside your permitted scope.')+`<div class="hub-section-intro"><div><span class="eyebrow">MANAGEMENT CENTRE</span><h2>${admin?'Company controls':'Your permitted management scope'}</h2><p>Daily customer work stays separate from account, team and system administration.</p></div></div><div class="hub-grid">${cards.join('')}</div>`;bindHubNavigation();bind();
}
function documentTableLegacy(rows){const canReview=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer / Application</th><th>Document</th><th>Received</th><th>AI status</th><th>Remarks</th><th>Actions</th></tr></thead><tbody>${rows.map(d=>{const a=state.data.applications.find(x=>x.id===d.applicationId||x.leadId===d.leadId);return `<tr><td><strong>${esc(a?.customer||d.leadId||'Customer')}</strong><small>${esc(d.applicationId||a?.id||d.leadId)}</small></td><td><strong>${pretty(d.type||'Unclassified')}</strong><small>${esc(d.fileName||d.mimeType||'File recorded')}</small></td><td>${esc(when(d.received||d.updated))}</td><td>${pill(d.verification||d.quality||d.classification||'AI queued',String(d.reviewRequired).toUpperCase()!=='TRUE')}</td><td>${esc(d.remarks||'—')}</td><td><div class="row-actions">${canReview?`<button class="row-action" data-review="${esc(d.id)}">Resolve AI exception</button>`:'<span class="pill">Manager decision required</span>'}${a?`<button class="row-action secondary" data-app="${esc(a.id)}">Open application</button>`:''}</div></td></tr>`}).join('')||empty(6)}</tbody></table></div>`}
const documentAiPending=document=>['PENDING','PENDING_AI','AI_QUEUED','AI_PROCESSING','ERROR','FAILED'].some(status=>[document.verification,document.classification,document.quality].map(value=>String(value||'').toUpperCase()).includes(status));
const documentAiStale=document=>documentAiPending(document)&&Date.now()-new Date(document.updated||document.received||0).valueOf()>15*60000;
function documents(){const badge=document.getElementById('documentBadge');if(badge)badge.textContent=state.data.documents.length;const pending=state.data.documents.filter(d=>String(d.reviewRequired).toUpperCase()==='TRUE'||documentAiPending(d)),stale=pending.filter(documentAiStale);app.innerHTML=head('Documents','Secure customer files with AI processing and exception status.')+`<div class="metric-grid">${metric('Files received',state.data.documents.length,'Customer file records')}${metric('AI processing / exceptions',pending.length,'No routine Staff review')}${metric('Queue overdue',stale.length,'Over 15 minutes')}${metric('Applications covered',new Set(state.data.documents.map(d=>d.applicationId).filter(Boolean)).size,'With at least one file')}</div>${stale.length?`<div class="refresh-error-banner" role="alert"><div><strong>${stale.length} document validation${stale.length===1?' is':'s are'} overdue</strong><span>Open the file first, then retry AI validation or resolve the exception. This queue is monitored instead of staying silently pending.</span></div></div>`:''}<div class="smart-toolbar"><input id="search" placeholder="Search customer, application, type or filename"><div class="toolbar-spacer"></div><button class="primary" data-new-upload>Upload document</button></div><section class="panel" id="results">${documentTable(state.data.documents)}</section>`;document.getElementById('search').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('results').innerHTML=documentTable(state.data.documents.filter(d=>{const a=state.data.applications.find(x=>x.id===d.applicationId);return `${Object.values(d).join(' ')} ${a?.customer||''}`.toLowerCase().includes(q)}));bind()};document.querySelector('[data-new-upload]').onclick=chooseUpload;bind()}
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
function bindUsers(){document.querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>editUser(state.data.users.find(x=>x.id===b.dataset.editUser)));document.querySelectorAll('[data-reset-user]').forEach(b=>b.onclick=async()=>{const u=state.data.users.find(x=>x.id===b.dataset.resetUser);b.disabled=true;try{const saved=await post('resetUserPassword',{accountId:u.id});u.passwordConfigured=true;u.mustChangePassword=true;u.failedAttempts=0;u.lockedUntil='';u.lastPasswordReset=new Date().toISOString();showTemporaryPassword('Password reset',u.username,saved.temporaryPassword)}catch(x){alert(x.message)}finally{b.disabled=false}});document.querySelectorAll('[data-unlock-user]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await post('unlockUser',{accountId:b.dataset.unlockUser});await refreshUsers()}catch(x){alert(x.message);b.disabled=false}});document.querySelectorAll('[data-toggle-user]').forEach(b=>b.onclick=async()=>{const u=state.data.users.find(x=>x.id===b.dataset.toggleUser);if(!confirm(`${u.loginEnabled?'Disable':'Enable'} ${u.username}?`))return;b.disabled=true;try{await post('setUserEnabled',{accountId:u.id,enabled:!u.loginEnabled});await refreshUsers()}catch(x){alert(x.message);b.disabled=false}})}
function simple(title,desc,headers,rows){app.innerHTML=head(title,desc)+`<section class="panel table-card"><table class="data-table"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows||empty(headers.length)}</tbody></table></section>`}
function inboxTableLegacyOne(rows){const manager=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Time</th><th>Customer</th><th>Message</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>${rows.map(x=>{const status=String(x.status).toUpperCase(),staffCanHandle=manager||!x.humanRequired||status==='ASSIGNED_TO_STAFF';return `<tr class="${x.humanRequired?'handover-row':''}"><td>${esc(when(x.time))}</td><td><strong>${esc(x.customer)}</strong><small>${esc(x.phone)}</small></td><td>${esc(x.message)}</td><td>${pill(x.status,!x.humanRequired)}</td><td>${esc(x.assignedSa||'Manager queue')}</td><td><div class="row-actions"><button class="row-action secondary" data-customer-profile data-lead-id="${esc(x.leadId||'')}" data-application-id="${esc(x.applicationId||'')}" data-phone="${esc(x.phone||'')}">Customer 360</button>${staffCanHandle?`<button class="row-action whatsapp-action" data-inbox-reply="${esc(x.id)}">Reply</button>`:'<span class="pill">Waiting for Manager</span>'}${manager&&status==='HUMAN_HANDOVER_REQUIRED'?`<button class="row-action" data-take-handover="${esc(x.id)}">Manager take over</button><button class="row-action secondary" data-assign-handover="${esc(x.id)}">Assign staff</button>`:''}${status!=='RESOLVED'&&(manager||status==='ASSIGNED_TO_STAFF')?`<button class="row-action secondary" data-resolve-handover="${esc(x.id)}">Resolve</button>`:''}</div></td></tr>`}).join('')||empty(6)}</tbody></table></div>`}
function inbox(){const human=state.data.inbox.filter(x=>x.humanRequired),cloud=state.user?.whatsappMode==='CLOUD',renderResults=()=>{const query=String(document.getElementById('inboxSearch')?.value||'').toLowerCase(),status=document.getElementById('inboxStatus')?.value||'OPEN',rows=state.data.inbox.filter(item=>(status==='ALL'||(status==='OPEN'&&String(item.status).toUpperCase()!=='RESOLVED')||String(item.status).toUpperCase()===status)&&Object.values(item).join(' ').toLowerCase().includes(query));document.getElementById('inboxResults').innerHTML=inboxTable(rows);bindMessaging()};app.innerHTML=head('Customer Inbox',state.user?.role==='STAFF'?'Only conversations assigned to your SA ID are visible.':'Human handovers arrive in the Manager queue before staff assignment.')+`<div class="metric-grid">${metric('Human handovers',human.length,'Manager controlled')}${metric('Visible messages',state.data.inbox.length,'Your permitted scope')}</div><div class="security-banner"><div><strong>${cloud?'WhatsApp Meta Cloud connected':'WhatsApp Business manual mode'}</strong><p>${cloud?'Customer messages arrive automatically. Replies are sent from the same official number that received the conversation.':'Use manual reply recording only while Meta Cloud is not active.'}</p></div>${cloud?'':'<button data-record-reply>Record customer reply</button>'}</div><div class="smart-toolbar"><input id="inboxSearch" placeholder="Search customer, phone, message or application"><label>Status<select id="inboxStatus"><option value="OPEN">Open / unread</option><option value="ALL">All messages</option><option value="RESOLVED">Resolved</option><option value="HUMAN_HANDOVER_REQUIRED">Human handover</option><option value="ASSIGNED_TO_STAFF">Assigned to Staff</option></select></label></div><section class="panel" id="inboxResults">${inboxTable(state.data.inbox.filter(item=>String(item.status).toUpperCase()!=='RESOLVED'))}</section>`;if(!cloud)document.querySelector('[data-record-reply]').onclick=()=>recordCustomerReply();document.getElementById('inboxSearch').oninput=renderResults;document.getElementById('inboxStatus').onchange=renderResults;bindMessaging()}
function outboxLegacyOne(){app.innerHTML=head('Message Outbox','Manual WhatsApp Business and future Meta Cloud messages use one controlled queue.')+`<div class="security-banner"><div><strong>Manual WhatsApp ready</strong><p>Open WhatsApp, send the prepared message, then mark it sent so the audit trail stays complete.</p></div><button data-new-message>New message</button></div><section class="panel table-card"><table class="data-table"><thead><tr><th>Time</th><th>Recipient</th><th>Message</th><th>Lead / Application</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.data.outbox.map(x=>`<tr><td>${esc(when(x.time))}</td><td>${esc(x.recipient)}</td><td>${esc(x.message)}</td><td>${esc(x.leadId||x.applicationId)}</td><td>${pill(x.status,String(x.status).toUpperCase()!=='FAILED')}</td><td><div class="row-actions"><button class="row-action secondary" data-customer-profile data-lead-id="${esc(x.leadId||'')}" data-application-id="${esc(x.applicationId||'')}" data-phone="${esc(x.recipient||'')}">Customer 360</button>${String(x.status).toUpperCase()==='MANUAL_PENDING'?`<button class="row-action whatsapp-action" data-open-outbox="${esc(x.id)}">Open WhatsApp</button><button class="row-action" data-mark-sent="${esc(x.id)}">Mark sent</button>`:''}</div></td></tr>`).join('')||empty(6)}</tbody></table></section>`;document.querySelector('[data-new-message]').onclick=()=>manualWhatsApp();bindMessaging()}
const customerOptions=()=>{const applications=state.data.applications.filter(a=>!a.demo),represented=new Set(applications.map(a=>a.leadId));return applications.map(a=>`<option value="${esc(a.id)}">${esc(a.customer)} · ${esc(a.phone)} · ${esc(a.product||'Motor pending')}</option>`).join('')+state.data.leads.filter(l=>!l.demo&&!represented.has(l.id)).map(l=>`<option value="${esc(l.id)}">${esc(l.name)} · ${esc(l.phone)} · Lead</option>`).join('')};
function customerTarget(value){const appRecord=state.data.applications.find(a=>a.id===value),leadRecord=state.data.leads.find(l=>l.id===value);return appRecord?{leadId:appRecord.leadId,applicationId:appRecord.id,phone:appRecord.phone,name:appRecord.customer}:leadRecord?{leadId:leadRecord.id,applicationId:leadRecord.applicationId||'',phone:leadRecord.phone,name:leadRecord.name}:null}
function manualWhatsAppLegacy(target){const selected=target?.id?target:null;formModal('Reply customer',`<form id="manualWhatsAppForm" class="crm-form"><label class="form-wide">Customer<select name="customer" ${selected?'disabled':''}>${selected?`<option value="${esc(selected.id)}">${esc(selected.customer||selected.name||selected.phone)}</option>`:customerOptions()}</select></label><label class="form-wide">Phone number<input name="phone" value="${esc(selected?.phone||'')}" required></label><label>Reply type<select name="messageType"><option value="TEXT">Normal reply</option><option value="TEMPLATE">Approved Meta template</option></select></label><label>Template language<input name="language" value="en_US"></label><label class="form-wide template-field" hidden>Approved template name<input name="templateName"></label><label class="form-wide">Message<textarea name="message" rows="6" required placeholder="Type the customer reply here"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Open WhatsApp Business</button></div><p class="form-wide notice" id="formMessage">The message is recorded in CRM before WhatsApp opens. Meta Cloud will use this same reply screen later; approved templates are supported for conversations outside the service window.</p></form>`);const f=document.getElementById('manualWhatsAppForm'),templateField=f.querySelector('.template-field');if(state.user?.whatsappMode==='CLOUD')f.querySelector('[type=submit]').textContent='Send WhatsApp reply';f.messageType.onchange=()=>{templateField.hidden=f.messageType.value!=='TEMPLATE';f.templateName.required=f.messageType.value==='TEMPLATE'};const applyTarget=()=>{const t=selected||customerTarget(f.customer.value);if(t)f.phone.value=t.phone||''};if(!selected)f.customer.onchange=applyTarget;applyTarget();f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage'),t=selected||customerTarget(f.customer.value),manualWindow=state.user?.whatsappMode==='MANUAL'?window.open('about:blank','_blank'):null;btn.disabled=true;try{const saved=await post('sendCustomerMessage',{leadId:t?.leadId||selected?.leadId||'',applicationId:t?.applicationId||selected?.applicationId||'',phone:f.phone.value,message:f.message.value,messageType:f.messageType.value,templateName:f.templateName.value,language:f.language.value});if(saved.mode==='MANUAL'&&saved.whatsappUrl){if(manualWindow)manualWindow.location=saved.whatsappUrl;else window.location.href=saved.whatsappUrl}else manualWindow?.close();document.querySelector('.drawer-backdrop').remove();await refreshMessaging('outbox')}catch(error){manualWindow?.close();msg.textContent=error.message;btn.disabled=false}}}
function recordCustomerReply(target){const selected=target?.id?target:null;formModal('Record customer reply',`<form id="recordReplyForm" class="crm-form"><label class="form-wide">Customer<select name="customer" ${selected?'disabled':''}>${selected?`<option value="${esc(selected.id)}">${esc(selected.customer||selected.name||selected.phone)}</option>`:customerOptions()}</select></label><label class="form-wide">Phone number<input name="phone" value="${esc(selected?.phone||'')}" required></label><label class="form-wide">Customer message<textarea name="message" rows="5" required></textarea></label><label class="form-wide checkbox-line"><input name="requiresManager" type="checkbox"> Customer requests Manager / human handover</label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save customer reply</button></div><p class="form-wide notice" id="formMessage">Human handovers go to the Manager queue. Staff only sees customers assigned to their own SA ID.</p></form>`);const f=document.getElementById('recordReplyForm');const applyTarget=()=>{const t=selected||customerTarget(f.customer.value);if(t)f.phone.value=t.phone||''};if(!selected)f.customer.onchange=applyTarget;applyTarget();f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage'),t=selected||customerTarget(f.customer.value);btn.disabled=true;try{await post('recordManualReply',{leadId:t?.leadId||selected?.leadId||'',applicationId:t?.applicationId||selected?.applicationId||'',phone:f.phone.value,message:f.message.value,requiresManager:f.requiresManager.checked});document.querySelector('.drawer-backdrop').remove();await refreshMessaging('inbox')}catch(error){msg.textContent=error.message;btn.disabled=false}}}
function requestHandover(target){formModal('Request Manager handover',`<form id="handoverRequestForm" class="crm-form"><label class="form-wide">Customer<input value="${esc(target.customer||target.name||target.phone)}" disabled></label><label class="form-wide">Reason<textarea name="reason" rows="5" required placeholder="Explain why Manager assistance is required"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Send to Manager queue</button></div><p class="form-wide notice" id="formMessage">The responsible Branch or Regional Manager will take over or assign this customer to a Staff member.</p></form>`);const f=document.getElementById('handoverRequestForm');f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('requestHumanHandover',{leadId:target.leadId,applicationId:target.applicationId||target.id,phone:target.phone,reason:f.reason.value});document.querySelector('.drawer-backdrop').remove();await refreshMessaging('workbench')}catch(error){msg.textContent=error.message;btn.disabled=false}}}
function assignHandover(item){const options=state.data.team.map(t=>`<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.id)} · ${esc(t.branch)}</option>`).join('');formModal('Assign human handover',`<form id="assignHandoverForm" class="crm-form"><label class="form-wide">Customer<input value="${esc(item.customer)}" disabled></label><label class="form-wide">Assign Staff<select name="saId" required><option value="">Select staff</option>${options}</select></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Assign customer</button></div><p class="form-wide notice" id="formMessage">After assignment, only that Staff member and authorized Managers can see and handle the customer.</p></form>`);const f=document.getElementById('assignHandoverForm');f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('assignHandover',{messageId:item.id,saId:f.saId.value});document.querySelector('.drawer-backdrop').remove();await loadMessagingView()}catch(error){msg.textContent=error.message;btn.disabled=false}}}
async function updateHandover(item,status){const customer=item.customer||item.phone||'this customer';if(!confirm(status==='RESOLVED'?`Mark ${customer} reply as handled?`:`Manager take over ${customer}?`))return;try{await post('updateHandover',{messageId:item.id,status});await loadMessagingView()}catch(error){alert(error.message)}}
async function refreshMessaging(view){const [inboxData,outboxData,dashboardData]=await Promise.all([optional('inbox'),optional('outbox'),get('dashboard')]);state.data.inbox=inboxData.records||[];state.data.outbox=outboxData.records||[];state.summary=dashboardData.summary||state.summary;loadedResources.add('inbox');loadedResources.add('outbox');state.view=view||state.view;document.getElementById('inboxBadge').textContent=state.summary.unreadInbox||0;setNavBadge('workBadge',state.summary.needsAttention);updateNotificationBadge();render()}
async function loadMessagingView(){await refreshMessaging(state.view)}
function bindMessaging(){bindCustomerProfileButtons();document.querySelectorAll('[data-inbox-reply]').forEach(button=>button.onclick=()=>manualWhatsApp(state.data.inbox.find(x=>x.id===button.dataset.inboxReply)));document.querySelectorAll('[data-take-handover]').forEach(button=>button.onclick=()=>updateHandover(state.data.inbox.find(x=>x.id===button.dataset.takeHandover),'MANAGER_IN_PROGRESS'));document.querySelectorAll('[data-assign-handover]').forEach(button=>button.onclick=()=>assignHandover(state.data.inbox.find(x=>x.id===button.dataset.assignHandover)));document.querySelectorAll('[data-resolve-handover]').forEach(button=>button.onclick=()=>updateHandover(state.data.inbox.find(x=>x.id===button.dataset.resolveHandover),'RESOLVED'));document.querySelectorAll('[data-open-outbox]').forEach(button=>button.onclick=()=>{const item=state.data.outbox.find(x=>x.id===button.dataset.openOutbox),phone=String(item.recipient||'').replace(/\D/g,'').replace(/^0/,'60');window.open(`https://wa.me/${phone}?text=${encodeURIComponent(item.message||'')}`,'_blank','noopener')});document.querySelectorAll('[data-mark-sent]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await post('markOutboxSent',{outboxId:button.dataset.markSent});await refreshMessaging('outbox')}catch(error){alert(error.message);button.disabled=false}});document.querySelectorAll('[data-retry-outbox]').forEach(button=>button.onclick=async()=>{if(!confirm('Retry this failed WhatsApp message once?'))return;button.disabled=true;try{await post('retryOutboxMessage',{outboxId:button.dataset.retryOutbox});await refreshMessaging('outbox')}catch(error){alert(error.message);button.disabled=false}})}
function catalogTable(rows){const admin=state.user?.role==='ADMIN';return `<div class="table-card"><table class="data-table"><thead><tr><th>Motor & Admin actions</th><th>Category</th><th>Image</th><th>Stock check</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.brand+' '+x.model)}</strong><small>${esc(x.variant)} · ${esc(x.id)}</small>${admin?`<div class="inline-admin-actions"><button class="row-action" data-edit-catalog="${esc(x.id)}">Edit</button><button class="row-action secondary" data-toggle-catalog="${esc(x.id)}">${x.active?'Disable':'Restore'}</button></div>`:''}</td><td>${pretty(x.category)}<small>${pretty(x.tier)}</small></td><td>${x.image?`<img src="${esc(x.image)}" alt="${esc(x.brand+' '+x.model)}" class="catalog-thumb">`:x.imageUrl?'Waiting for approval':'No image'}</td><td>${pretty(x.stock)}<small>${esc(x.branchAvailability||x.warehouseAvailability||'Confirm with branch')}</small></td><td>${pill(x.active?'Active':'Inactive',x.active)}<small>${x.imageApproved?'Image approved':'Image not approved'}</small></td></tr>`).join('')||empty(5)}</tbody></table></div>`}
function catalog(){const admin=state.user?.role==='ADMIN';app.innerHTML=head('Motor Catalog',admin?'Add, edit, approve images and activate motorcycle models directly in CRM.':'Approved active motorcycle models. Catalog changes are controlled by Administrator.')+`<div class="smart-toolbar"><input id="catalogSearch" placeholder="Search brand, model, category or Catalog ID"><div class="toolbar-spacer"></div>${admin?'<button class="primary" data-new-catalog>+ Add motor model</button>':''}</div><section class="panel" id="catalogResults">${catalogTable(state.data.catalog)}</section>`;document.getElementById('catalogSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('catalogResults').innerHTML=catalogTable(state.data.catalog.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q)));bindCatalog()};if(admin)document.querySelector('[data-new-catalog]').onclick=()=>editCatalogItem();bindCatalog()}
function bindCatalog(){document.querySelectorAll('[data-edit-catalog]').forEach(button=>button.onclick=()=>editCatalogItem(state.data.catalog.find(x=>x.id===button.dataset.editCatalog)));document.querySelectorAll('[data-toggle-catalog]').forEach(button=>button.onclick=()=>toggleCatalogItem(state.data.catalog.find(x=>x.id===button.dataset.toggleCatalog)))}
async function toggleCatalogItem(item){const enabled=!item.active;if(!confirm(`${enabled?'Restore':'Disable'} ${item.brand} ${item.model}?`))return;try{await post('setCatalogItemEnabled',{catalogId:item.id,enabled});await refreshCatalog()}catch(error){alert(error.message)}}
async function refreshCatalog(){const response=await get('catalog');state.data.catalog=response.records||[];loadedResources.add('catalog');state.view='catalog';render()}
function editCatalogItem(item={}){const editing=Boolean(item.id);formModal(editing?'Edit motor catalog':'Add motor model',`<form id="catalogForm" class="crm-form"><label>Brand<input name="brand" value="${esc(item.brand||'')}" required></label><label>Model<input name="model" value="${esc(item.model||'')}" required></label><label>Variant<input name="variant" value="${esc(item.variant||'Standard')}"></label><label>Category<input name="category" value="${esc(item.category||'MOPED')}" required placeholder="MOPED, CUB, SCOOTER"></label><label>Fuel type<select name="fuel"><option value="PETROL">Petrol</option></select></label><label>Popularity tier<select name="tier"><option value="PRIMARY">Primary</option><option value="SECONDARY">Secondary</option><option value="ON_REQUEST">On request</option></select></label><label>Stock check mode<select name="stock"><option value="CHECK_BRANCH">Check branch</option><option value="CHECK_WAREHOUSE">Check warehouse</option><option value="CONFIRMED_AVAILABLE">Confirmed available</option><option value="UNAVAILABLE">Unavailable</option></select></label><label>Catalog status<select name="active"><option value="TRUE">Active</option><option value="FALSE">Inactive</option></select></label><label class="form-wide">Product page URL<input name="productPageUrl" type="url" value="${esc(item.productPageUrl||'')}"></label><label class="form-wide">Image URL<input name="imageUrl" type="url" value="${esc(item.imageUrl||'')}"></label><label>Image approval<select name="imageApproved"><option value="FALSE">Not approved</option><option value="TRUE">Approved</option></select></label><label>Search keywords<input name="searchKeywords" value="${esc(item.searchKeywords||'')}"></label><label class="form-wide">Malay image caption<textarea name="imageCaption" rows="3">${esc(item.imageCaption||'')}</textarea></label><label>Branch availability<input name="branchAvailability" value="${esc(item.branchAvailability||'')}"></label><label>Warehouse availability<input name="warehouseAvailability" value="${esc(item.warehouseAvailability||'')}"></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing?'Save catalog changes':'Add motor model'}</button></div><p class="form-wide notice" id="formMessage">Only Administrator can save. Inactive models remain in the audit record but are hidden from other users.</p></form>`);const f=document.getElementById('catalogForm');f.tier.value=item.tier||'PRIMARY';f.stock.value=item.stock||'CHECK_BRANCH';f.active.value=item.id?(item.active?'TRUE':'FALSE'):'TRUE';f.imageApproved.value=item.imageApproved?'TRUE':'FALSE';f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('[type=submit]'),message=document.getElementById('formMessage');button.disabled=true;try{await post('saveCatalogItem',{catalogId:item.id||'',...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await refreshCatalog()}catch(error){message.textContent=error.message;button.disabled=false}}}
function availableMotorTerms(price){return [[3,price.year3],[4,price.year4],[5,price.year5]].filter(([,value])=>String(value??'').trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0).map(([years,value])=>`${money(value)}/month - ${years} years`).join(' · ')||'No monthly term available'}
function pricingTable(rows){const admin=state.user?.role==='ADMIN';return `<div class="table-card"><table class="data-table"><thead><tr><th>Motor & Admin actions</th><th>Zone</th><th>Standard financing</th><th>Promotion</th><th>Validity</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.brand+' '+x.model)}</strong><small>${esc(x.variant)} · ${esc(x.id)}</small>${admin?`<div class="inline-admin-actions"><button class="row-action" data-edit-pricing="${esc(x.id)}">Edit</button><button class="row-action secondary" data-toggle-pricing="${esc(x.id)}">${x.active?'Disable price':'Enable price'}</button>${x.promotion?`<button class="row-action secondary" data-toggle-promotion="${esc(x.id)}">${x.promotionActive?'Disable promotion':'Enable promotion'}</button>`:''}</div>`:''}</td><td>${pretty(x.zone)}</td><td>${money(x.baseDeposit||x.deposit)} deposit<small>${esc(availableMotorTerms(x))}</small></td><td><strong>${esc(x.promotion||'No promotion')}</strong><small>${x.promotionDeposit?money(x.promotionDeposit)+' deposit':''}${x.promotionStart||x.promotionEnd?` · ${esc(x.promotionStart||'Any time')} to ${esc(x.promotionEnd||'No end')}`:''}</small></td><td>${esc(x.effective||'No start')}<small>to ${esc(x.effectiveTo||'No end')}</small></td><td>${pill(x.active?x.status:'Inactive',x.active&&x.status==='APPROVED')}<small>${x.promotion?`Promotion: ${pretty(x.promotionStatus)} · ${x.promotionActive?'Enabled':'Disabled'}`:'Standard pricing'}</small></td></tr>`).join('')||empty(6)}</tbody></table></div>`}
function pricing(){const admin=state.user?.role==='ADMIN';app.innerHTML=head('Loan Pricing & Promotions',admin?'Add or edit approved customer pricing and promotions directly in CRM. Cash and selling prices remain excluded.':'Customer-safe approved pricing only. Cash and selling prices are excluded.')+`<div class="smart-toolbar"><input id="pricingSearch" placeholder="Search motor, zone, promotion or Pricing ID"><div class="toolbar-spacer"></div>${admin?'<button class="primary" data-new-pricing>+ Add price / promotion</button>':''}</div><section class="panel" id="pricingResults">${pricingTable(state.data.pricing)}</section>`;document.getElementById('pricingSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.getElementById('pricingResults').innerHTML=pricingTable(state.data.pricing.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q)));bindPricing()};if(admin)document.querySelector('[data-new-pricing]').onclick=()=>editPricingPromotion();bindPricing()}
function bindPricing(){document.querySelectorAll('[data-edit-pricing]').forEach(button=>button.onclick=()=>editPricingPromotion(state.data.pricing.find(x=>x.id===button.dataset.editPricing)));document.querySelectorAll('[data-toggle-pricing]').forEach(button=>button.onclick=()=>togglePricingItem(state.data.pricing.find(x=>x.id===button.dataset.togglePricing),'price'));document.querySelectorAll('[data-toggle-promotion]').forEach(button=>button.onclick=()=>togglePricingItem(state.data.pricing.find(x=>x.id===button.dataset.togglePromotion),'promotion'))}
async function togglePricingItem(item,type){const enabled=type==='price'?!item.active:!item.promotionActive,label=type==='price'?'price':'promotion';if(!confirm(`${enabled?'Enable':'Disable'} ${item.brand} ${item.model} ${label}?`))return;try{await post(type==='price'?'setPricingEnabled':'setPromotionEnabled',{pricingId:item.id,enabled});await refreshPricing()}catch(error){alert(error.message)}}
async function refreshPricing(){const response=await get('pricing');state.data.pricing=response.records||[];loadedResources.add('pricing');state.view='pricing';render()}
function editPricingPromotion(item={}){const editing=Boolean(item.id),catalogOptions=state.data.catalog.map(x=>`<option value="${esc(x.id)}">${esc(x.brand+' '+x.model+' '+x.variant)} · ${esc(x.id)}${x.active?'':' · INACTIVE'}</option>`).join('');formModal(editing?'Edit price and promotion':'Add price and promotion',`<form id="pricingForm" class="crm-form"><h3 class="form-wide">Motor and standard financing</h3><label class="form-wide">Catalog motorcycle<select name="catalogId" required><option value="">Select a motor model</option>${catalogOptions}</select></label><label>Price zone<input name="zone" list="priceZones" value="${esc(item.zone||'EAST_MALAYSIA')}" required><datalist id="priceZones"><option value="ALL_BRANCHES"><option value="WEST_MALAYSIA"><option value="EAST_MALAYSIA"><option value="SARAWAK"><option value="BR-WM-PJ"><option value="BR-EM-SATOK"><option value="BR-EM-BATU_KAWA"><option value="BR-EM-KOTA_SAMARAHAN"><option value="BR-EM-BINTULU"></datalist></label><label>Standard deposit (RM)<input name="deposit" type="number" min="0" step="0.01" value="${esc(item.baseDeposit??item.deposit??'')}" required></label><label>Monthly 3 years (RM)<input name="year3" type="number" min="0" step="0.01" value="${esc(item.year3||'')}" required></label><label>Monthly 4 years (RM)<input name="year4" type="number" min="0" step="0.01" value="${esc(item.year4||'')}" required></label><label>Monthly 5 years (RM)<input name="year5" type="number" min="0" step="0.01" value="${esc(item.year5||'')}" required></label><label>Pricing enabled<select name="active"><option value="TRUE">Enabled</option><option value="FALSE">Disabled</option></select></label><label>Quote approval<select name="quoteStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label>Effective from<input name="effectiveFrom" type="date" value="${esc(item.effective||'')}"></label><label>Effective to<input name="effectiveTo" type="date" value="${esc(item.effectiveTo||'')}"></label><label class="form-wide">Internal notes<textarea name="internalNotes" rows="2">${esc(item.internalNotes||'')}</textarea></label><h3 class="form-wide">Promotion</h3><label>Promotion name<input name="promotionName" value="${esc(item.promotion||'')}"></label><label>Promotion deposit (RM)<input name="promotionDeposit" type="number" min="0" step="0.01" value="${esc(item.promotionDeposit||'')}"></label><label>Promotion start<input name="promotionStart" type="date" value="${esc(item.promotionStart||'')}"></label><label>Promotion end<input name="promotionEnd" type="date" value="${esc(item.promotionEnd||'')}"></label><label>Promotion enabled<select name="promotionActive"><option value="FALSE">Disabled</option><option value="TRUE">Enabled</option></select></label><label>Promotion approval<select name="promotionStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label class="form-wide">Promotion notes<textarea name="promotionNotes" rows="3">${esc(item.promotionNotes||'')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing?'Save price / promotion':'Add price / promotion'}</button></div><p class="form-wide notice" id="formMessage">A promotion is customer-visible only when it is enabled, approved and within its date range. Every change is written to Activity & Audit.</p></form>`);const f=document.getElementById('pricingForm');f.catalogId.value=item.catalogId||'';f.active.value=item.id?(item.active?'TRUE':'FALSE'):'FALSE';f.quoteStatus.value=item.status||'DRAFT';f.promotionActive.value=item.promotionActive?'TRUE':'FALSE';f.promotionStatus.value=item.promotionStatus||'DRAFT';f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('[type=submit]'),message=document.getElementById('formMessage');button.disabled=true;try{await post('savePricingPromotion',{pricingId:item.id||'',...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await refreshPricing()}catch(error){message.textContent=error.message;button.disabled=false}}}
function team(){const canManage=state.user?.role==='ADMIN';app.innerHTML=head('Branches & Team','Active sales advisors and lead acceptance. Administrator can pause or resume automatic AI-exception assignment for each Staff member.')+`<div class="security-banner"><div><strong>${state.data.team.filter(x=>String(x.accepting).toUpperCase()==='TRUE').length} Staff accepting leads</strong><p>Paused Staff remain active and keep their existing assigned customers, but will not receive new automatic assignments.</p></div></div><div class="table-card"><table class="data-table"><thead><tr><th>SA ID</th><th>Name</th><th>Branch</th><th>Region</th><th>Accepting leads</th><th>Last assigned</th>${canManage?'<th>Admin action</th>':''}</tr></thead><tbody>${state.data.team.map(x=>{const accepting=String(x.accepting).toUpperCase()==='TRUE';return `<tr><td>${esc(x.id)}</td><td><strong>${esc(x.name)}</strong></td><td>${esc(x.branch)}</td><td>${pretty(x.region)}</td><td>${pill(accepting?'Yes':'Paused',accepting)}</td><td>${esc(when(x.lastAssigned))}</td>${canManage?`<td><button class="row-action ${accepting?'secondary':''}" data-toggle-accepting="${esc(x.id)}">${accepting?'Pause new leads':'Resume new leads'}</button></td>`:''}</tr>`}).join('')||empty(canManage?7:6)}</tbody></table></div>`;bindTeam()}
function bindTeam(){document.querySelectorAll('[data-toggle-accepting]').forEach(button=>button.onclick=async()=>{const member=state.data.team.find(x=>x.id===button.dataset.toggleAccepting),accepting=String(member?.accepting).toUpperCase()==='TRUE';if(!member||!confirm(`${accepting?'Pause':'Resume'} new automatic lead assignments for ${member.name}?`))return;button.disabled=true;try{await post('setAdvisorAccepting',{saId:member.id,accepting:!accepting});const response=await get('team');state.data.team=response.records||[];loadedResources.add('team');state.view='team';render()}catch(error){alert(error.message);button.disabled=false}})}
function activityLegacy(){simple('Activity & Audit','Operational events for the permitted regional scope.',['Time','Activity','Lead','Application','Description','Actor'],state.data.activity.map(x=>`<tr><td>${esc(when(x.time))}</td><td>${pretty(x.type)}</td><td>${esc(x.leadId)}</td><td>${esc(x.applicationId)}</td><td>${esc(x.description)}</td><td>${esc(x.actor)}</td></tr>`).join(''))}
const editPricingPromotionBase=editPricingPromotion;
editPricingPromotion=function(item={}){editPricingPromotionBase(item);const f=document.getElementById('pricingForm');if(!f)return;['year3','year4','year5'].forEach(name=>f.elements[name]?.removeAttribute('required'));f.elements.year5?.closest('label')?.insertAdjacentHTML('afterend','<p class="form-wide notice">Fill only the tenures offered for this motor. Leave unavailable tenures blank; at least one monthly instalment is required.</p>')};
function settingsLegacy(){
  const pricingAmountReady=value=>{const text=String(value??'').trim();return text!==''&&Number.isFinite(Number(text))&&Number(text)>=0};
  const approvedPricingMissingFields=price=>{
    if(String(price.businessUnit||'MOTOR').toUpperCase()==='HANDPHONE'){
      return [price.month12,price.month24,price.month36,price.month48,price.month60].some(pricingAmountReady)?[]:['At least one 1–5-year monthly payment'];
    }
    const missing=[];
    if(!pricingAmountReady(price.baseDeposit??price.deposit))missing.push('Deposit');
    if(![price.year3,price.year4,price.year5].some(pricingAmountReady))missing.push('At least one 3–5-year monthly payment');
    return missing;
  };
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
  const pendingIntegrationNames=pendingIntegrations.map(integration=>integration.name||integration.id).filter(Boolean).join(' and ');
  const followUpRules=state.data.followUpSettings||[],followUpGlobal=followUpRules[0]||{},followUpOperations=followUpControlData(followUpGlobal,followUpOperationalSnapshot(followUpRules));
  const followUpConfigured=followUpRules.length>0,followUpReady=followUpConfigured&&followUpGlobal.enabled&&followUpOperations.schedulerHealthy;
  const readinessItems=[
    ['Branch Manager coverage',missingManagerBranches.length?missingManagerBranches.length+' branches need an owner':'Complete',missingManagerBranches.length?'Owner confirmation required':'Every active branch has a Manager login',!missingManagerBranches.length],
    ['Active catalog images',activeImageIssues.length?activeImageIssues.length+' item needs attention':'Complete',activeImageIssues.length?'Open Motor Catalog to add or approve the image':'Every active model has an approved image',!activeImageIssues.length],
    ['Approved pricing completeness',approvedPricingGaps.length?approvedPricingGaps.length+' approved row needs attention':'Complete',approvedPricingGaps.length?'Motor requires a deposit plus at least one 3–5-year monthly payment; Handphone requires at least one approved 1–5-year monthly payment':'All active approved quotes are complete',!approvedPricingGaps.length],
    ['Account password readiness',passwordSetupGaps.length?passwordSetupGaps.length+' enabled accounts need setup':'Complete',passwordSetupGaps.length?'Open Users & Access and reset each affected account password':'Every enabled account has a secure CRM-managed password',!passwordSetupGaps.length],
    ['Synthetic QA isolation',syntheticRows.length+' records isolated','Excluded from daily workspaces, dashboard and business reports; retained only as traceable Admin evidence',true],
    ['Follow-up scheduler',followUpReady?'Healthy':followUpConfigured?followUpOperations.schedulerStatus:'Configuration unavailable',followUpReady?`Last completed run ${when(followUpOperations.lastRun)}`:followUpConfigured&&!followUpGlobal.enabled?'Automatic follow-up is paused':followUpConfigured?'No successful scheduler run was observed in the last 45 minutes':'Follow-up rules could not be loaded',followUpReady],
    ['External production connections',pendingIntegrations.length?pendingIntegrations.length+' waiting':'Complete',pendingIntegrations.length?`${pendingIntegrationNames||'Pending integrations'} remain safely gated until the required activation checks pass`:'All approved external connections are live',!pendingIntegrations.length]
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
    <details class="settings-policy-disclosure"><summary><span><strong>Policy &amp; access</strong><small>AI ownership, human handover and role visibility</small></span><span class="disclosure-hint">View governance rules</span></summary><div class="policy-access-grid"><article><span class="eyebrow">AI OWNERSHIP</span><h4>AI-first case ownership</h4><p>Normal leads remain unassigned while AI follows up and collects documents. Complete cases move directly to Ready for LMS. Only incomplete or failed cases enter the Staff queue.</p><button class="secondary" data-open-view="workbench">Open exception queue</button></article><article><span class="eyebrow">HANDOVER</span><h4>Human handover control</h4><p>Explicit customer requests enter the Manager queue. Maximum automatic attempts pause AI and route the case to eligible Staff through the existing assignment workflow.</p><button class="secondary" data-open-view="management">Open team routing</button></article><article><span class="eyebrow">PERMISSIONS</span><h4>Role visibility</h4><p>Admin sees all company cases; Regional Managers see their region; Branch Supervisors see their branch; Staff sees assigned or self-submitted cases only.</p><button class="secondary" data-open-view="users">Open Users &amp; Access</button></article></div></details>`;
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
function uploadDocument(a,initialType=''){formModal('Upload customer document',`<form id="documentUploadForm" class="crm-form"><label>Application<input value="${esc(a.id)}" disabled></label><label>Document type<select name="documentType" required><option value="IC_FRONT">IC front</option><option value="IC_BACK">IC back</option><option value="INCOME_PROOF">Income proof</option><option value="BANK_STATEMENT">Bank statement</option><option value="DRIVING_LICENSE">Driving licence</option><option value="CTOS_CCRIS_CONSENT">Signed CTOS / CCRIS consent</option><option value="OTHER">Other</option></select></label><label class="form-wide">Choose document<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" required></label><label class="form-wide">Remarks<textarea name="remarks" rows="3"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Upload securely</button></div><p class="form-wide notice" id="formMessage">Maximum 3 MB. PDF, JPG, PNG, WebP, HEIC and HEIF only. A signed CTOS/CCRIS consent is held for Manager verification and never triggers a credit check by itself.</p></form>`);const f=document.getElementById('documentUploadForm');if(initialType&&[...f.documentType.options].some(option=>option.value===initialType))f.documentType.value=initialType;f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage'),file=f.file.files[0];btn.disabled=true;try{validateBrowserFile(file);await post('uploadDocument',{applicationId:a.id,leadId:a.leadId,documentType:f.documentType.value,remarks:f.remarks.value,file:{name:file.name,type:file.type,data:await fileData(file)}});document.querySelector('.drawer-backdrop').remove();await load()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
function editApplication(a){const advisorOptions=`<option value="">Unassigned</option>${state.data.team.map(t=>`<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.id)}</option>`).join('')}`;formModal('Manage application',`<form id="applicationEditForm" class="crm-form"><label>Current stage<select name="stage"><option value="APPLICATION_DETAILS_PENDING">Application details pending</option><option value="DOCUMENT_COLLECTION">Document collection</option><option value="DOCUMENT_VERIFICATION">Document verification</option><option value="CREDIT_ASSESSMENT">Credit assessment</option><option value="BRANCH_HANDOVER">Branch handover</option><option value="RECOVERY_PENDING">Recovery pending</option><option value="COMPLETED">Completed</option></select></label><label>Status<select name="status"><option value="DRAFT">Draft</option><option value="IN_PROGRESS">In progress</option><option value="MANUAL_REVIEW">Manual review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label><label>Assigned sales advisor<select name="saId">${advisorOptions}</select></label><label>Branch ID<input name="branchId" value="${esc(a.branch||'')}"></label><label>Next follow-up<input name="nextFollowUp" type="datetime-local" value="${esc(String(a.nextFollowUp||'').slice(0,16))}"></label><label>AI exception review required<select name="reviewRequired"><option value="FALSE">No</option><option value="TRUE">Yes</option></select></label><label class="form-wide">Missing documents<input name="missingDocuments" value="${esc(a.missingDocuments||'')}"></label><label class="form-wide">Handover / exception reason<textarea name="handoverReason" rows="3"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save changes</button></div><p class="form-wide notice" id="formMessage">Every change is recorded in Activity & Audit.</p></form>`);const f=document.getElementById('applicationEditForm');f.stage.value=a.stage||'APPLICATION_DETAILS_PENDING';f.status.value=a.status||'DRAFT';f.saId.value=a.sa==='Unassigned'?'':a.sa;f.reviewRequired.value=String(a.reviewRequired).toUpperCase()==='TRUE'?'TRUE':'FALSE';if(state.user?.role==='STAFF'){['stage','status','saId','branchId','reviewRequired','handoverReason'].forEach(name=>f.elements[name].disabled=true);document.getElementById('formMessage').textContent='Staff may update follow-up dates and missing-document notes on assigned AI exceptions only. Manager approval controls stage, status, assignment and exception decisions.'}f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('updateApplication',{applicationId:a.id,...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await load();state.view='applications';render()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
function editApplicantProfile(a){const input=(label,name,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value||'')}" ${extra}></label>`;formModal('Applicant 360 profile',`<form id="applicantProfileForm" class="crm-form profile-form"><h3 class="form-wide">Customer details</h3>${input('Applicant name','applicantName',a.customer,'text','required')}${input('Phone number','phone',a.phone,'tel','required')}${input('IC number','applicantIcNumber','','text','placeholder="Leave blank to keep existing IC"')}${input('Email','email',a.email,'email')}${input('Home address','homeAddress',a.homeAddress)}<h3 class="form-wide">Employment & income</h3>${input('Employer name','employerName',a.employerName)}${input('Job position','jobPosition',a.jobPosition)}${input('Employer phone','employerPhone',a.employerPhone,'tel')}${input('Employment months','employmentDurationMonths',a.employmentDurationMonths,'number','min="0"')}${input('Basic salary (RM)','basicSalary',a.basicSalary,'number','min="0" step="0.01"')}${input('Salary payment method','salaryPaymentMethod',a.salaryPaymentMethod)}${input('Occupation category','occupationCategory',a.occupationCategory)}${input('Employer address','employerAddress',a.employerAddress)}<h3 class="form-wide">Motorcycle & loan</h3>${input('Motor brand','productBrand',a.brand,'text','required')}${input('Motor model','productModel',a.model,'text','required')}<label>Loan tenure<select name="loanTenureYears"><option value="">Not selected</option><option value="3">3 years</option><option value="4">4 years</option><option value="5">5 years</option></select></label><label>Bank account available<select name="bankAccountAvailable"><option value="">Unknown</option><option value="YES">Yes</option><option value="NO">No</option></select></label><label>Direct Debit status<select name="directDebitStatus"><option value="">Not started</option><option value="PENDING">Pending</option><option value="READY">Ready</option><option value="COMPLETED">Completed</option></select></label><label>Agreement status<select name="agreementStatus"><option value="">Not started</option><option value="PENDING">Pending</option><option value="READY">Ready</option><option value="SIGNED">Signed</option></select></label><input type="hidden" name="productCategory" value="MOTORCYCLE"><h3 class="form-wide">References</h3>${input('Reference 1 name','reference1Name',a.reference1Name)}${input('Reference 1 phone','reference1Phone',a.reference1Phone,'tel')}${input('Reference 1 relationship','reference1Relationship',a.reference1Relationship)}${input('Reference 2 name','reference2Name',a.reference2Name)}${input('Reference 2 phone','reference2Phone',a.reference2Phone,'tel')}${input('Reference 2 relationship','reference2Relationship',a.reference2Relationship)}<label class="form-wide">Missing application fields<textarea name="missingApplicationFields" rows="3">${esc(a.missingApplicationFields||'')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save Applicant 360</button></div><p class="form-wide notice" id="formMessage">IC is masked after saving. Every update is recorded in Activity & Audit.</p></form>`);const f=document.getElementById('applicantProfileForm');[['loanTenureYears',a.tenure],['bankAccountAvailable',a.bankAccountAvailable],['directDebitStatus',a.directDebitStatus],['agreementStatus',a.agreementStatus]].forEach(([n,v])=>{if(v&&f.elements[n])f.elements[n].value=String(v).toUpperCase()});f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('updateApplicantProfile',{applicationId:a.id,...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await load();state.view='applications';render()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
const editApplicantProfileLegacy=editApplicantProfile;
editApplicantProfile=async function(a){try{await ensureCatalogForForms();editApplicantProfileLegacy(a);const f=document.getElementById('applicantProfileForm'),brandLabel=f.elements.productBrand.closest('label'),modelLabel=f.elements.productModel.closest('label'),motorLabel=document.createElement('label');motorLabel.className='form-wide';motorLabel.innerHTML=`Motorcycle from catalog<select name="catalogId" required><option value="">Select an active motor model</option>${catalogOptions(a)}</select>`;brandLabel.replaceWith(motorLabel);modelLabel.remove();document.getElementById('formMessage').textContent='Motorcycle must come from the active Motor Catalog. IC is masked after saving and every update is audited.'}catch(error){alert(error.message)}};
function reviewDocument(d){formModal('Resolve AI document exception',`<form id="documentReviewForm" class="crm-form"><label>Document<input value="${esc(d.fileName||d.type||d.id)}" disabled></label><label>Verification<select name="verification"><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option></select></label><label>Quality<select name="quality"><option value="PENDING_REVIEW">Pending review</option><option value="GOOD">Good</option><option value="POOR">Poor / resubmission needed</option></select></label><label class="form-wide">Resolution remarks<textarea name="remarks" rows="4">${esc(d.remarks||'')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save exception decision</button></div><p class="form-wide notice" id="formMessage">Use this only when AI could not verify the file. The decision and Manager identity are written to Activity & Audit.</p></form>`);const f=document.getElementById('documentReviewForm');f.verification.value=['VERIFIED','REJECTED'].includes(String(d.verification).toUpperCase())?String(d.verification).toUpperCase():'PENDING';f.quality.value=['GOOD','POOR'].includes(String(d.quality).toUpperCase())?String(d.quality).toUpperCase():'PENDING_REVIEW';f.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('[type=submit]'),msg=document.getElementById('formMessage');btn.disabled=true;try{await post('reviewDocument',{documentId:d.id,...Object.fromEntries(new FormData(f))});document.querySelector('.drawer-backdrop').remove();await load();state.view='documents';render()}catch(x){msg.textContent=x.message}finally{btn.disabled=false}}}
async function openSecureDocument(documentId){const preview=window.open('about:blank','_blank');try{const access=await post('getDocumentAccess',{documentId}),url=new URL(access.url);if(url.protocol!=='https:')throw new Error('Only secure document links can be opened.');if(preview)preview.location=access.url;else window.open(access.url,'_blank','noopener')}catch(error){preview?.close();alert(error.message)}}
function bindDocumentPreviewButtons(){document.querySelectorAll('[data-open-document]').forEach(button=>button.onclick=()=>openSecureDocument(button.dataset.openDocument))}
function drawer(title,subtitle,body){document.querySelector('.drawer-backdrop')?.remove();document.body.insertAdjacentHTML('beforeend',`<div class="drawer-backdrop"><aside class="drawer"><header class="drawer-head"><div><h2>${title}</h2><small>${subtitle}</small></div><button class="modal-close" data-close>×</button></header><div class="drawer-body">${body}</div></aside></div>`);document.querySelector('[data-close]').onclick=()=>document.querySelector('.drawer-backdrop').remove()}
function openLead(id){const l=state.data.leads.find(x=>x.id===id);if(!l)return;const apps=state.data.applications.filter(a=>a.leadId===id);drawer(esc(l.name),`${esc(l.id)} · ${esc(l.phone)}`,`<div class="detail-grid">${[['Motor selected',l.model],['Lead status',pretty(l.status)],['Application',l.applicationId||'Not created'],['Loan tenure',l.tenure?l.tenure+' years':'Not selected'],['Assigned SA',l.sa],['Branch',l.branch||'Pending']].map(x=>`<div class="detail-card"><span>${x[0]}</span><strong>${esc(x[1])}</strong></div>`).join('')}</div><h3>Related applications</h3>${applicationTable(apps)}<p class="notice">Read-only view. Updates continue through approved workflows.</p>`);bind()}
function profileBlock(title,items){return `<section class="profile-section"><h3>${title}</h3><div class="detail-grid">${items.map(([label,value])=>`<div class="detail-card"><span>${label}</span><strong>${esc(value||'Not provided')}</strong></div>`).join('')}</div></section>`}
function openApp(id){const a=state.data.applications.find(x=>x.id===id);if(!a)return;const docs=state.data.documents.filter(d=>d.applicationId===id||(!d.applicationId&&d.leadId===a.leadId)),events=state.data.activity.filter(x=>x.applicationId===id).slice(0,12);const required=['IC_FRONT','IC_BACK','INCOME_PROOF'],received=new Set(docs.map(d=>String(d.type).toUpperCase())),checklist=required.map(type=>`<div class="check-row"><span>${received.has(type)?'✓':'○'}</span><strong>${pretty(type)}</strong>${pill(received.has(type)?'Received':'Missing',received.has(type))}</div>`).join('');drawer(esc(a.customer),`${esc(a.id)} · ${esc(a.product||'Motor pending')}`,`<div class="drawer-actions"><button class="whatsapp-action" data-whatsapp="${esc(a.id)}">Reply WhatsApp</button><button data-request-handover="${esc(a.id)}">Request Manager</button><button data-edit-profile="${esc(a.id)}">Edit Applicant 360</button><button class="secondary" data-edit-app="${esc(a.id)}">Workflow & assignment</button><button class="secondary" data-upload="${esc(a.id)}">Upload document</button></div>${profileBlock('Customer details',[['Phone',a.phone],['IC number',a.icMasked],['Email',a.email],['Home address',a.homeAddress]])}${profileBlock('Motorcycle & loan',[['Motor',a.product||'Not selected'],['Deposit',a.deposit?money(a.deposit):'Pending'],['Monthly instalment',a.monthly?money(a.monthly):'Pending'],['Tenure',a.tenure?a.tenure+' years':'Pending'],['Promotion',a.promotion],['Price zone',pretty(a.priceZone||a.region)]])}${profileBlock('Employment & income',[['Employer',a.employerName],['Job position',a.jobPosition],['Employment duration',a.employmentDurationMonths?a.employmentDurationMonths+' months':''],['Basic salary',a.basicSalary?money(a.basicSalary):''],['Salary method',a.salaryPaymentMethod],['Occupation',a.occupationCategory]])}${profileBlock('References',[['Reference 1',[a.reference1Name,a.reference1Phone,a.reference1Relationship].filter(Boolean).join(' · ')],['Reference 2',[a.reference2Name,a.reference2Phone,a.reference2Relationship].filter(Boolean).join(' · ')]])}<section class="profile-section"><h3>Documents checklist</h3><div class="checklist">${checklist}</div><div class="list">${docs.map(d=>`<div class="list-row"><div><strong>${esc(d.type||'Unclassified')}</strong><span>${esc(when(d.received||d.updated))}${d.fileName?' · '+esc(d.fileName):''}</span></div>${pill(d.verification||d.quality||d.classification||'Received',String(d.reviewRequired).toUpperCase()!=='TRUE')}</div>`).join('')||'<div class="list-row"><strong>No documents recorded yet</strong></div>'}</div></section>${profileBlock('Readiness & approval',[['Stage',pretty(a.stage)],['Status',pretty(a.status)],['Eligibility',pretty(a.eligibilityStatus)],['Bank account',pretty(a.bankAccountAvailable)],['Direct Debit',pretty(a.directDebitStatus)],['Agreement',pretty(a.agreementStatus)],['CAD status',pretty(a.cadStatus)],['LMS status',pretty(a.lmsSubmissionStatus)]])}${profileBlock('Assignment & follow-up',[['Assigned SA',a.sa],['Branch',a.branch],['Supervisor',a.assignedSupervisorId],['Next follow-up',when(a.nextFollowUp)],['Missing fields',a.missingApplicationFields],['Handover reason',a.handoverReason]])}<section class="profile-section"><h3>Application timeline</h3><div class="list">${events.map(e=>`<div class="list-row"><div><strong>${pretty(e.type)}</strong><span>${esc(when(e.time))} · ${esc(e.actor)}</span><small>${esc(e.description)}</small></div></div>`).join('')||'<div class="list-row"><strong>No activity recorded yet</strong></div>'}</div></section><p class="notice">IC is masked. Original document links and extracted identity data remain hidden. Stock, colour, approval, delivery date and final price require branch confirmation.</p>`);document.querySelector('[data-edit-profile]').onclick=()=>editApplicantProfile(a);document.querySelector('[data-edit-app]').onclick=()=>editApplication(a);document.querySelector('.drawer [data-upload]').onclick=()=>uploadDocument(a);document.querySelector('.drawer [data-whatsapp]').onclick=()=>manualWhatsApp(a);document.querySelector('.drawer [data-request-handover]').onclick=()=>requestHandover(a)}
function bindLegacy(){document.querySelectorAll('[data-lead]').forEach(b=>b.onclick=()=>openLead(b.dataset.lead));document.querySelectorAll('[data-app]').forEach(b=>b.onclick=()=>openApp(b.dataset.app));document.querySelectorAll('[data-upload]').forEach(b=>b.onclick=()=>uploadDocument(state.data.applications.find(a=>a.id===b.dataset.upload)));document.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>reviewDocument(state.data.documents.find(d=>d.id===b.dataset.review)));document.querySelectorAll('[data-whatsapp]').forEach(b=>b.onclick=()=>manualWhatsApp(state.data.applications.find(a=>a.id===b.dataset.whatsapp)));document.querySelectorAll('[data-refresh]').forEach(b=>b.onclick=async()=>{if(!await load())return;await ensureViewData(state.view);render()});bindHubNavigation();bindMessaging()}
async function ensureViewData(view){if(view==='workbench'){if(loadedResources.has('inbox')&&loadedResources.has('outbox'))return;app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading manager and follow-up queues…</p></div>';const [inboxData,outboxData]=await Promise.all([optional('inbox'),optional('outbox')]);state.data.inbox=inboxData.records||[];state.data.outbox=outboxData.records||[];loadedResources.add('inbox');loadedResources.add('outbox');return}if(view==='pricing'&&state.user?.role==='ADMIN'&&(!loadedResources.has('pricing')||!loadedResources.has('catalog'))){app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading catalog and promotions…</p></div>';const [pricingData,catalogData]=await Promise.all([get('pricing'),get('catalog')]);state.data.pricing=pricingData.records||[];state.data.catalog=catalogData.records||[];loadedResources.add('pricing');loadedResources.add('catalog');return}const resource={inbox:'inbox',outbox:'outbox',catalog:'catalog',pricing:'pricing',users:'users',activity:'activity',settings:'integrations'}[view];if(!resource||loadedResources.has(resource))return;app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading workspace…</p></div>';const response=resource==='users'?await get(resource):await optional(resource);state.data[resource]=response.records||[];loadedResources.add(resource)}
function renderLegacy(){const documentBadge=document.getElementById('documentBadge');if(documentBadge)documentBadge.textContent=state.data.documents.length;syncPrimaryNavigation();document.querySelectorAll('.nav-item:not([hidden])').forEach(n=>{n.onclick=()=>navigateToView(n.dataset.view).catch(error=>showWorkspaceError(error.message))});({dashboard,customers,pipeline,workbench,followup,products,reports,management,leads,applications,documents,inbox,outbox,catalog,pricing,handphoneCatalog:catalog,handphonePricing:pricing,team,users:usersAdmin,activity,settings}[state.view]||dashboard)();bind()}
document.getElementById('newLeadButton').textContent='+ New application';document.getElementById('newLeadButton').onclick=async()=>{try{await ensureCatalogForForms();newApplication()}catch(error){alert(error.message)}};document.getElementById('menuButton').onclick=()=>document.getElementById('sidebar').classList.toggle('open');
const globalSearch=document.getElementById('globalSearch');globalSearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runGlobalSearch(e.target.value).catch(error=>alert(error.message))}};document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!shell.hidden){e.preventDefault();globalSearch.focus();globalSearch.select()}});
document.getElementById('openMessageQueue').onclick=()=>navigateToView('outbox').catch(error=>showWorkspaceError(error.message));document.querySelector('[aria-label="Notifications"]').onclick=()=>openNotificationCentre().catch(error=>showWorkspaceError(error.message));
document.getElementById('logoutButton').onclick=async()=>{await fetch('/api/logout');state.loaded=false;shell.hidden=true;gate.classList.remove('hidden');form.reset()};
form.onsubmit=async e=>{e.preventDefault();const error=document.getElementById('loginError'),button=form.querySelector('button');button.disabled=true;error.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:document.getElementById('loginUsername').value,password:document.getElementById('loginPassword').value})});if(!r.ok)throw new Error('Incorrect username or password.');if(!await load())throw new Error('Unable to load CRM data.')}catch(x){error.textContent=x.message}finally{button.disabled=false}};
setInterval(()=>{if(state.loaded&&state.user?.mustChangePassword&&!document.querySelector('.drawer-backdrop'))changePassword(true)},500);
setInterval(refreshLiveWorkspace,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLiveWorkspace()});
const ensureViewDataBase=ensureViewData;
ensureViewData=async function(view){
  if(view==='followup'){
    app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading follow-up operations...</p></div>';
    const resources=['outbox','activity','followUpSettings'];
    const responses=await Promise.all(resources.map(resource=>loadedResources.has(resource)?{records:state.data[resource]||[]}:optional(resource,{timeoutMs:6000})));
    responses.forEach((response,index)=>{state.data[resources[index]]=response.records||[];if(!response.unavailable)loadedResources.add(resources[index])});
    return;
  }
  if(view==='customers'&&!loadedResources.has('inbox')){
    const response=await optional('inbox',{timeoutMs:6000});state.data.inbox=response.records||[];if(!response.unavailable)loadedResources.add('inbox');return;
  }
  if(view==='products'){
    const resources=['catalog','pricing','secondHandMotors'],missing=resources.filter(resource=>!loadedResources.has(resource));
    if(missing.length){app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading products and approved pricing...</p></div>';const responses=await Promise.all(missing.map(resource=>optional(resource)));missing.forEach((resource,index)=>{state.data[resource]=responses[index].records||[];if(!responses[index].unavailable)loadedResources.add(resource)})}
    return;
  }
  if(view==='management'&&state.user?.role==='ADMIN'&&!loadedResources.has('users')){
    const response=await optional('users');state.data.users=response.records||[];if(!response.unavailable)loadedResources.add('users');return;
  }
  if(view==='reports'&&!loadedResources.has('secondHandMotors')){
    const response=await optional('secondHandMotors');
    state.data.secondHandMotors=response.records||[];
    loadedResources.add('secondHandMotors');
  }
  if(view==='settings'&&state.user?.role==='ADMIN'&&!['integrations','catalog','pricing','users','qa','channels','outbox','activity','followUpSettings'].every(resource=>loadedResources.has(resource))){
    app.innerHTML='<div class="v2-loading"><div class="spinner"></div><p>Loading go-live readiness...</p></div>';
    const resources=['integrations','catalog','pricing','users','qa','channels','outbox','activity','followUpSettings'];
    const responses=await Promise.all(resources.map(resource=>loadedResources.has(resource)?{records:state.data[resource]||[]}:optional(resource)));
    responses.forEach((response,index)=>{state.data[resources[index]]=response.records||[];loadedResources.add(resources[index])});
    return;
  }
  const resourceView=view==='handphoneCatalog'?'catalog':view==='handphonePricing'?'pricing':view;
  return ensureViewDataBase(resourceView);
};
initializeTableScrollAccess();
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
function reportPhysicalBranch(id,name=''){
  const branchId=String(id||'').trim().toUpperCase(),label=String(name||'').trim().toUpperCase();
  return /^BR-/.test(branchId)&&!/(TEAM|VIRTUAL|IPHONE|HANDPHONE)/.test(`${branchId} ${label}`);
}
function reportOperationalChannel(channel={}){
  return Boolean(channel.id&&channel.active&&!/(RETIRED|LEGACY)/.test(`${channel.id} ${channel.name||''}`.toUpperCase()));
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
    ['JomKaki Rider CRM Operational Report'],
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
    ['JomKaki Rider CRM Administrator Report'],
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
  const pricingGaps=reportPricing.filter(price=>price.active&&String(price.status).toUpperCase()==='APPROVED'&&(String(price.businessUnit).toUpperCase()==='HANDPHONE'?![price.month12,price.month24,price.month36,price.month48,price.month60].some(Boolean):(!price.deposit||!price.year3||!price.year4||!price.year5)));
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
  const branchIds=[...new Set([...leads.map(lead=>lead.branch),...applications.map(application=>application.branch),...team.map(member=>member.branchId)].filter(branchId=>reportPhysicalBranch(branchId,branchNames[branchId])))];
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
  const branchOptions=[...new Map([...reportTeam.filter(member=>member.branchId).map(member=>[member.branchId,member.branch||member.branchId]),...secondHandBase.filter(motor=>motor.branchId).map(motor=>[motor.branchId,motor.branch||motor.branchId])]).entries()].filter(option=>reportPhysicalBranch(option[0],option[1])).sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
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
  const incoming=state.data.inbox.filter(context.matches).map(item=>({id:item.id,direction:'incoming',actor:'Customer',message:customerMessagePreview(item,'Message content not recorded'),time:item.time||item.received||item.created||context.lead?.lastInboundAt||context.lead?.lastCustomerReplyAt||context.lead?.time||context.lead?.created,status:item.status,meta:[whatsappChannelLabel(item),customerMessageTypeLabel(item)].filter(Boolean).join(' | '),humanRequired:item.humanRequired}));
  const outgoing=state.data.outbox.filter(context.matches).map(item=>{const route=String(item.routingStatus||'').toUpperCase(),manual=item.manual||/(MANUAL|STAFF|HUMAN|MANAGER)/.test(route);return{id:item.id,direction:'outgoing',actor:manual?'Staff / Manager':'AI / CRM',message:item.message,time:item.time,status:item.status,meta:[whatsappChannelLabel(item),item.deliveredAt?'Delivered':'',item.readAt?'Read':''].filter(Boolean).join(' | ')}});
  return [...incoming,...outgoing].sort((a,b)=>customer360TimeValue(a.time)-customer360TimeValue(b.time));
}
function customer360ApplicationList(applications,currentId){return `<section class="customer-360-section"><div class="customer-360-section-head"><div><span>Cases</span><h3>All applications</h3></div>${pill(`${applications.length} record${applications.length===1?'':'s'}`,true)}</div><div class="customer-360-applications">${applications.map(item=>`<button class="customer-360-application ${item.id===currentId?'active':''}" data-360-application="${esc(item.id)}"><span><strong>${esc(item.id)}</strong><small>${esc(item.product||'Motor not selected')}</small></span><span>${pill(item.stage||item.status||'Open',true)}<small>${esc(when(item.updated||item.created))}</small></span></button>`).join('')||'<div class="customer-360-empty"><strong>No application created yet</strong><p>The lead and conversation remain available in this Customer 360.</p></div>'}</div></section>`}
function customer360DocumentRequirement(documents,requirement){
  const identityTypes=new Set(['IDENTITY_DOCUMENT']),incomeTypes=new Set(['INCOME_PROOF','PAYSLIP','SALARY_SLIP','EPF','EPF_STATEMENT']);
  const matches=documents.filter(item=>{const type=String(item.type||'').toUpperCase();if(requirement==='IC_FRONT')return type==='IC_FRONT'||identityTypes.has(type);if(requirement==='IC_BACK')return type==='IC_BACK'||identityTypes.has(type);return incomeTypes.has(type)});
  if(!matches.length)return{label:'Missing',icon:'•',positive:false};
  const failed=matches.some(item=>/(REJECTED|FAILED|BLURRY|POOR)/.test(String(item.verification||item.quality||'').toUpperCase()));
  if(failed)return{label:'Needs resubmission',icon:'!',positive:false};
  const verified=matches.some(item=>/(VERIFIED|AI_VERIFIED|APPROVED|ACCEPTED)/.test(String(item.verification||'').toUpperCase()));
  return verified?{label:'Verified',icon:'✓',positive:true}:{label:'Received · Pending AI',icon:'✓',positive:true};
}
function customer360DocumentSection(documents){
  const required=['IC_FRONT','IC_BACK','INCOME_PROOF'];
  const labels={IC_FRONT:'IC Front',IC_BACK:'IC Back',INCOME_PROOF:'Income Proof'};
  const checklist=required.map(type=>{const status=customer360DocumentRequirement(documents,type);return `<div class="check-row"><span>${status.icon}</span><strong>${labels[type]}</strong>${pill(status.label,status.positive)}</div>`}).join('');
  return `<section class="customer-360-section"><div class="customer-360-section-head"><div><span>Secure files</span><h3>Documents and AI checks</h3></div>${pill(`${documents.length} received`,documents.length>0)}</div><div class="checklist">${checklist}</div><div class="customer-360-file-list">${documents.map(item=>`<div class="customer-360-file"><div><strong>${pretty(item.type||'Unclassified')}</strong><span>${esc(item.fileName||item.mimeType||'Secure document')} | ${esc(when(item.received||item.updated))}</span><small>${esc(item.remarks||'No exception remarks')}</small></div><div class="row-actions"><button class="row-action secondary" data-open-document="${esc(item.id)}">View file</button>${pill(item.verification||item.quality||item.classification||'Received',String(item.reviewRequired).toUpperCase()!=='TRUE')}</div></div>`).join('')||'<div class="customer-360-empty"><strong>No documents received yet</strong><p>AI collection progress and Staff uploads will appear here automatically.</p></div>'}</div></section>`;
}
function customer360ConversationSection(messages){return `<section class="customer-360-section customer-360-conversation-section"><div class="customer-360-section-head"><div><span>One conversation</span><h3>WhatsApp, AI and human replies</h3></div>${pill(`${messages.length} message${messages.length===1?'':'s'}`,true)}</div><div class="customer-360-conversation">${messages.map(item=>`<article class="customer-360-message ${item.direction} ${item.humanRequired?'needs-human':''}"><div class="customer-360-message-meta"><strong>${esc(item.actor)}</strong><time>${esc(when(item.time))}</time></div><p>${esc(item.message||'Message content not recorded')}</p><div class="customer-360-message-status"><span>${pretty(item.status||'Recorded')}</span>${item.meta?`<small>${esc(item.meta)}</small>`:''}</div></article>`).join('')||'<div class="customer-360-empty"><strong>No conversation recorded yet</strong><p>Incoming customer messages and outgoing AI or Staff replies will stay together here.</p></div>'}</div></section>`}
function customer360ActivitySection(events){return `<section class="customer-360-section"><div class="customer-360-section-head"><div><span>Audit trail</span><h3>Complete customer activity</h3></div>${pill(`${events.length} event${events.length===1?'':'s'}`,true)}</div><div class="customer-360-timeline">${events.map(item=>`<div class="customer-360-event"><span></span><div><strong>${pretty(item.type||'Activity')}</strong><p>${esc(item.description||'Activity recorded')}</p><small>${esc(when(item.time))} | ${esc(item.actor||'System')} | ${pretty(item.status||'Completed')}</small></div></div>`).join('')||'<div class="customer-360-empty"><strong>No activity recorded yet</strong></div>'}</div></section>`}
function bindCustomer360Actions(context,pendingReply){
  const target=context.application||context.lead&&{...context.lead,id:context.lead.id,leadId:context.lead.id,customer:context.lead.name,applicationId:''};
  document.querySelector('[data-360-whatsapp]')?.addEventListener('click',()=>manualWhatsApp(target));
  document.querySelector('[data-360-resolve-reply]')?.addEventListener('click',()=>updateHandover(pendingReply,'RESOLVED'));
  document.querySelector('[data-360-handover]')?.addEventListener('click',()=>requestHandover(target));
  document.querySelector('[data-360-edit-profile]')?.addEventListener('click',()=>editApplicantProfile(context.application));
  document.querySelector('[data-360-workflow]')?.addEventListener('click',()=>editApplication(context.application));
  document.querySelector('[data-360-upload]')?.addEventListener('click',()=>uploadDocument(context.application));
  document.querySelectorAll('[data-360-application]').forEach(button=>button.onclick=()=>openCustomer360({applicationId:button.dataset.application}));
  bindDocumentPreviewButtons();
}
async function openCustomer360(identity={}){
  drawer('Customer 360','Loading the complete customer record...','<div class="customer-360-loading"><div class="spinner"></div><p>Joining profile, applications, documents, messages and activity...</p></div>');
  document.querySelector('.drawer')?.classList.add('customer-360-drawer');
  let loadResult;
  try{loadResult=await ensureCustomer360Data()}catch(error){const auth=error?.message==='AUTH';drawer('Customer 360',auth?'Session expired':'Customer record unavailable',`<div class="customer-360-empty"><strong>${auth?'Please sign in again':'The customer record could not be loaded'}</strong><p>${auth?'Refresh the CRM and sign in before reopening Customer 360.':'Close this panel and try again. No customer data was changed.'}</p></div>`);return}
  const context=resolveCustomer360(identity),lead=context.lead,application=context.application;
  if(!lead&&!application){drawer('Customer 360','Customer not found','<div class="customer-360-empty"><strong>This customer is not available in your permitted scope.</strong><p>Refresh the CRM and try again.</p></div>');return}
  const documents=state.data.documents.filter(item=>context.applicationIds.has(item.applicationId)||context.leadIds.has(item.leadId)).sort((a,b)=>customer360TimeValue(b.received||b.updated)-customer360TimeValue(a.received||a.updated));
  const messages=customer360Conversation(context);
  const events=state.data.activity.filter(context.matches).sort((a,b)=>customer360TimeValue(b.time)-customer360TimeValue(a.time));
  const name=application?.customer||lead?.name||'Customer',phone=application?.phone||lead?.phone||identity.phone||'Not provided';
  const owner=application?.sa||lead?.sa||'Unassigned',branch=application?.branch||lead?.branch||'Pending';
  const unresolvedReplies=state.data.inbox.filter(item=>context.matches(item)&&String(item.status).toUpperCase()!=='RESOLVED').sort((a,b)=>customer360TimeValue(b.time)-customer360TimeValue(a.time)),pendingReply=unresolvedReplies[0];
  const openHandover=unresolvedReplies.some(item=>item.humanRequired);
  const documentComplete=String(application?.minimumDocumentsComplete).toUpperCase()==='TRUE'||application?.aiDocumentsComplete;
  const actions=`<div class="customer-360-actions"><button class="whatsapp-action" data-360-whatsapp>Reply WhatsApp</button>${pendingReply?'<button class="secondary" data-360-resolve-reply>Mark reply handled</button>':''}<button data-360-handover>Request Manager</button>${application?'<button data-360-edit-profile>Edit customer</button><button class="secondary" data-360-workflow>Workflow & assignment</button><button class="secondary" data-360-upload>Upload document</button>':''}</div>`;
  const unavailable=loadResult?.unavailable||[],loadWarning=unavailable.length?`<div class="customer-360-load-warning"><div><strong>Customer profile loaded</strong><span>${esc(unavailable.map(pretty).join(', '))} history is taking longer than expected. The available profile is shown below.</span></div><button class="secondary" data-360-retry>Retry missing history</button></div>`:'';
  const hero=`<section class="customer-360-hero"><div class="customer-360-avatar">${esc(String(name).split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase()||'JK')}</div><div class="customer-360-identity"><span>Single customer record</span><h2>${esc(name)}</h2><p>${esc(phone)}${lead?.id?` | ${esc(lead.id)}`:''}${application?.id?` | ${esc(application.id)}`:''}</p></div><div class="customer-360-hero-status">${pill(openHandover?'Human handover':'AI managed',!openHandover)}${pill(documentComplete?'Documents complete':application?.documentStatus||'Documents pending',documentComplete)}</div></section>`;
  const nextAction=application?customerNextAction(application):{label:'Continue customer conversation',detail:'Qualify interest and start the application'};
  const blocker=application?.handoverReason||application?.missingDocuments||application?.missingApplicationFields||(application?.verificationPendingDocuments?'Document verification pending':'None');
  const summary=`<div class="customer-360-summary"><div><span>Lead status</span><strong>${pretty(lead?.status||'Not created')}</strong></div><div><span>Application stage</span><strong>${pretty(application?.stage||application?.status||'Not created')}</strong></div><div class="customer-360-next-action"><span>Next action</span><strong>${esc(nextAction.label)}</strong><small>${esc(nextAction.detail)}</small></div><div><span>Current blocker</span><strong>${esc(blocker)}</strong></div><div><span>Owner</span><strong>${esc(owner)}</strong></div><div><span>Branch</span><strong>${esc(branch)}</strong></div><div><span>Motor</span><strong>${esc(application?.product||lead?.model||'Not selected')}</strong></div><div><span>Next follow-up</span><strong>${esc(when(application?.nextFollowUp||lead?.nextFollowUp))}</strong></div></div>`;
  const customerDetails=profileBlock('Customer and lead details',[['Phone',phone],['IC number',application?.icMasked],['Email',application?.email],['Home address',application?.homeAddress],['Lead source',customerSourceLabel(lead?.source)],['Region / city',[pretty(application?.region||lead?.region),lead?.city].filter(Boolean).join(' | ')],['Lead notes',lead?.notes],['Created',when(lead?.created||application?.created)]]);
  const financing=profileBlock('Motorcycle and financing',[['Motor',application?.product||lead?.model],['Deposit',application?.deposit?money(application.deposit):'Pending'],['Monthly instalment',application?.monthly?money(application.monthly):'Pending'],['Tenure',application?.tenure?`${application.tenure} years`:'Pending'],['Promotion',application?.promotion],['Price zone',pretty(application?.priceZone||application?.region||lead?.region)],['Financier',application?.financier],['Application status',pretty(application?.status)]]);
  const employment=application?profileBlock('Employment, income and references',[['Employer',application.employerName],['Job position',application.jobPosition],['Employment duration',application.employmentDurationMonths?`${application.employmentDurationMonths} months`:null],['Basic salary',application.basicSalary?money(application.basicSalary):null],['Salary method',application.salaryPaymentMethod],['Occupation',application.occupationCategory],['Reference 1',[application.reference1Name,application.reference1Phone,application.reference1Relationship].filter(Boolean).join(' | ')],['Reference 2',[application.reference2Name,application.reference2Phone,application.reference2Relationship].filter(Boolean).join(' | ')] ]):'';
  const readiness=application?profileBlock('Readiness, LMS and follow-up',[['Document status',pretty(application.documentStatus)],['Missing documents',application.missingDocuments||(application.verificationPendingDocuments?'Received — verification pending':'None')],['Verification pending',pretty(application.verificationPendingDocuments)],['Eligibility',pretty(application.eligibilityStatus)],['Bank account',pretty(application.bankAccountAvailable)],['Direct Debit',pretty(application.directDebitStatus)],['Agreement',pretty(application.agreementStatus)],['LMS case',application.lmsCaseId],['LMS status',pretty(application.lmsSubmissionStatus)],['CAD status',pretty(application.cadStatus)],['CAD remarks',application.cadRemarks],['Missing application fields',application.missingApplicationFields||'None'],['Handover reason',application.handoverReason||'None'],['Assigned supervisor',application.assignedSupervisorId],['Processing mode',pretty(application.processingMode)] ]):'';
  drawer(esc(name),`${esc(phone)} | Complete Customer 360`,`${actions}${loadWarning}${hero}${summary}<div class="customer-360-grid"><div>${customerDetails}${financing}${employment}${readiness}</div><div>${customer360DocumentSection(documents)}${customer360ConversationSection(messages)}${customer360ApplicationList(context.applications,application?.id)}${customer360ActivitySection(events)}</div></div><p class="customer-360-security">Sensitive IC data stays masked. Secure document links are not exposed. Every item shown is already filtered by the logged-in user's permitted region, branch or assignment.</p>`);
  document.querySelector('.drawer')?.classList.add('customer-360-drawer');
  bindCustomer360Actions(context,pendingReply);
  document.querySelector('[data-360-retry]')?.addEventListener('click',()=>openCustomer360(identity));
}
openLead=async function openLeadCustomer360(id){return openCustomer360({leadId:id})}
openApp=async function openApplicationCustomer360(id){return openCustomer360({applicationId:id})}

const archivedCustomer360Demos=[
  {
    id:'demo-complete',label:'AI complete - Ready for LMS',tone:'complete',
    lead:{id:'DEMO-LEAD-001',name:'Alicia Sample',phone:'60123456001',region:'EAST_MALAYSIA',source:'Facebook Ads',model:'Yamaha Y16ZR Standard',status:'QUALIFIED',applicationId:'DEMO-APP-001',applicationStatus:'READY_FOR_LMS',sa:'AI Automation',branch:'BR-EM-SATOK',city:'Kuching',notes:'Customer prefers a five-year financing plan and blue motorcycle.',nextFollowUp:'2026-08-10T10:30:00+08:00',created:'2026-08-09T09:10:00+08:00',time:'2026-08-10T09:25:00+08:00'},
    application:{id:'DEMO-APP-001',leadId:'DEMO-LEAD-001',customer:'Alicia Sample',phone:'60123456001',region:'EAST_MALAYSIA',stage:'READY_FOR_LMS',status:'DOCUMENTS_COMPLETE',sa:'AI Automation',product:'Yamaha Y16ZR Standard',brand:'Yamaha',model:'Y16ZR',variant:'Standard',tenure:'5',deposit:'1200',monthly:'318',priceZone:'EAST_MALAYSIA',promotion:'August Low Deposit',branch:'BR-EM-SATOK',nextFollowUp:'2026-08-10T10:30:00+08:00',documentStatus:'AI_VERIFIED_COMPLETE',minimumDocumentsComplete:'TRUE',missingDocuments:'',documentsReceived:4,documentNeedsReview:false,aiDocumentsComplete:true,creditConsentStatus:'VERIFIED',creditConsentTemplateVersion:'BPH_V4.0_01112020',creditConsentSentAt:'2026-08-10T09:24:00+08:00',creditConsentSignedAt:'2026-08-10T09:24:30+08:00',creditConsentVerifiedAt:'2026-08-10T09:24:50+08:00',creditConsentVerifiedBy:'Consent AI',creditCheckStatus:'READY_FOR_CREDIT_CHECK',creditCheckAllowed:true,icMasked:'******6789',homeAddress:'Tabuan Jaya, Kuching, Sarawak',email:'alicia.sample@example.com',employerName:'Borneo Retail Sdn Bhd',employmentDurationMonths:'38',jobPosition:'Store Supervisor',basicSalary:'3200',salaryPaymentMethod:'BANK_TRANSFER',occupationCategory:'SALARIED',reference1Name:'Michelle Sample',reference1Phone:'60123456011',reference1Relationship:'Sister',reference2Name:'Daniel Sample',reference2Phone:'60123456012',reference2Relationship:'Colleague',eligibilityStatus:'ELIGIBLE',bankAccountAvailable:'YES',directDebitStatus:'READY',agreementStatus:'PENDING_SIGNATURE',lmsCaseId:'PREVIEW-LMS-001',lmsSubmissionStatus:'READY_FOR_LMS',cadStatus:'NOT_SUBMITTED',cadRemarks:'Waiting for LMS API activation.',missingApplicationFields:'',handoverReason:'',assignedSupervisorId:'',processingMode:'AI_AUTOMATION',created:'2026-08-09T09:12:00+08:00',updated:'2026-08-10T09:25:00+08:00'},
    documents:[
      {id:'DEMO-DOC-001',applicationId:'DEMO-APP-001',leadId:'DEMO-LEAD-001',type:'IC_FRONT',received:'2026-08-09T09:42:00+08:00',fileName:'sample-ic-front.jpg',classification:'IC_FRONT',quality:'GOOD',verification:'VERIFIED',reviewRequired:'FALSE',remarks:'AI verified image clarity and document type.'},
      {id:'DEMO-DOC-002',applicationId:'DEMO-APP-001',leadId:'DEMO-LEAD-001',type:'IC_BACK',received:'2026-08-09T09:43:00+08:00',fileName:'sample-ic-back.jpg',classification:'IC_BACK',quality:'GOOD',verification:'VERIFIED',reviewRequired:'FALSE',remarks:'AI verified image clarity and document type.'},
      {id:'DEMO-DOC-003',applicationId:'DEMO-APP-001',leadId:'DEMO-LEAD-001',type:'INCOME_PROOF',received:'2026-08-10T09:03:00+08:00',fileName:'sample-payslip-july.pdf',classification:'INCOME_PROOF',quality:'GOOD',verification:'VERIFIED',reviewRequired:'FALSE',remarks:'Salary amount and employer matched the application.'},
      {id:'DEMO-DOC-CONSENT-001',applicationId:'DEMO-APP-001',leadId:'DEMO-LEAD-001',type:'CREDIT_CONSENT',received:'2026-08-10T09:24:30+08:00',fileName:'sample-signed-ctos-ccris-consent.pdf',classification:'SIGNED_CREDIT_CONSENT',quality:'GOOD',verification:'VERIFIED',reviewRequired:'FALSE',remarks:'Signed consent matched the applicant and passed automated verification.'}
    ],
    inbox:[
      {id:'DEMO-IN-001',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',customer:'Alicia Sample',phone:'60123456001',message:'Hi, I am interested in Yamaha Y16ZR. How much is the monthly payment?',status:'AI_PROCESSED',time:'2026-08-09T09:10:00+08:00',channel:'WHATSAPP',messageType:'TEXT',humanRequired:false},
      {id:'DEMO-IN-002',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',customer:'Alicia Sample',phone:'60123456001',message:'Five years is okay. I have uploaded my IC and payslip.',status:'AI_PROCESSED',time:'2026-08-10T09:04:00+08:00',channel:'WHATSAPP',messageType:'TEXT_AND_DOCUMENTS',humanRequired:false}
    ],
    outbox:[
      {id:'DEMO-OUT-001',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',recipient:'60123456001',message:'Hi Alicia. For the Yamaha Y16ZR sample quote, the estimated five-year instalment is RM318 per month with RM1,200 deposit. Final pricing and stock require branch confirmation.',status:'DELIVERED',time:'2026-08-09T09:11:00+08:00',routingStatus:'AI_AUTOMATION',deliveredAt:'2026-08-09T09:11:08+08:00',readAt:'2026-08-09T09:12:00+08:00',manual:false},
      {id:'DEMO-OUT-CONSENT-001',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',recipient:'60123456001',message:'Your required documents passed the AI checks. I have sent the CTOS/CCRIS consent letter. Please sign it and return the signed copy here.',status:'READ',time:'2026-08-10T09:24:00+08:00',routingStatus:'AI_AUTOMATION',deliveredAt:'2026-08-10T09:24:06+08:00',readAt:'2026-08-10T09:24:12+08:00',manual:false},
      {id:'DEMO-OUT-002',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',recipient:'60123456001',message:'Thank you. Your signed consent has been verified. Your application is now ready for LMS submission.',status:'READ',time:'2026-08-10T09:25:00+08:00',routingStatus:'AI_AUTOMATION',deliveredAt:'2026-08-10T09:25:06+08:00',readAt:'2026-08-10T09:26:00+08:00',manual:false}
    ],
    activity:[
      {id:'DEMO-ACT-001',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',type:'LEAD_CREATED',description:'Lead created from Facebook campaign.',actor:'AI Intake',status:'COMPLETED',time:'2026-08-09T09:10:00+08:00'},
      {id:'DEMO-ACT-002',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',type:'DOCUMENTS_AI_VERIFIED',description:'All minimum documents passed classification and quality checks.',actor:'Document AI',status:'COMPLETED',time:'2026-08-10T09:24:00+08:00'},
      {id:'DEMO-ACT-CONSENT-001',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',type:'CONSENT_SENT_AUTOMATICALLY',description:'The approved CTOS/CCRIS consent template was sent automatically after document completion.',actor:'Consent Automation',status:'COMPLETED',time:'2026-08-10T09:24:00+08:00'},
      {id:'DEMO-ACT-CONSENT-002',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',type:'CONSENT_AI_VERIFIED',description:'The signed consent was returned and verified automatically.',actor:'Consent AI',status:'COMPLETED',time:'2026-08-10T09:24:50+08:00'},
      {id:'DEMO-ACT-003',leadId:'DEMO-LEAD-001',applicationId:'DEMO-APP-001',type:'READY_FOR_LMS',description:'Documents and signed consent are complete; the case is waiting for the LMS API connection.',actor:'CRM Automation',status:'COMPLETED',time:'2026-08-10T09:25:00+08:00'}
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
const customer360Demos=[];
function customer360DemoPanel(){return''}
function bindCustomer360Demos(){document.querySelectorAll('[data-demo-customer]').forEach(button=>button.onclick=()=>openCustomer360Demo(button.dataset.demoCustomer).catch(error=>alert(error.message)))}
async function openCustomer360DemoLegacy(id){
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
function dashboard(){
  const s=state.summary,queue=crmNotifications().slice(0,8),all=businessApplications(),ready=all.filter(application=>customerNextAction(application).key==='lms').length,urgent=crmNotifications().filter(item=>item.priority>=60).length;
  const pipelineCounts=Object.fromEntries(pipelineColumns.map(([key])=>[key,all.filter(application=>pipelineStageFor(application)===key).length]));
  const taskRows=queue.map(item=>{const identity=item.leadId||item.applicationId||item.phone,open=identity?`data-customer-profile data-lead-id="${esc(item.leadId||'')}" data-application-id="${esc(item.applicationId||'')}" data-phone="${esc(item.phone||'')}"`:`data-open-view="${esc(item.view||'workbench')}"`;return `<button class="today-task ${esc(item.tone)}" ${open}><span class="today-task-priority">${item.priority>=90?'NOW':item.priority>=60?'TODAY':'NEXT'}</span><span class="today-task-customer"><strong>${esc(item.customer||'Customer')}</strong><small>${esc(item.context||item.group||'Customer action')}</small></span><span class="today-task-action"><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span><span class="today-task-owner">${esc(item.group||'Customer action')}</span><em>Open →</em></button>`}).join('');
  app.innerHTML=head('Today Command Centre','Start here: the CRM ranks customer replies, documents, consent, follow-up and LMS work in the order it should be handled.')+
    `<section class="today-hero"><div><span class="eyebrow">TODAY'S PRIORITY</span><h2>${urgent?`${urgent} customer action${urgent===1?'':'s'} ${urgent===1?'needs':'need'} attention`:'No urgent customer action is waiting'}</h2><p>${urgent?'Open the ranked queue below and complete the next action shown for each customer.':'Continue new conversations or review the full customer pipeline.'}</p><div class="today-actions"><button class="primary" data-open-view="followup">Open follow-up</button><button class="secondary" data-open-view="pipeline">View full pipeline</button><button class="secondary" data-open-notifications>Notification Centre</button></div></div><div class="today-score"><span>Ready for LMS</span><strong>${ready}</strong><small>${ready?'Submit complete cases next':'No complete cases waiting'}</small></div></section>`+
    `<div class="today-metrics">${metric('Actions due',urgent,'Ranked by customer urgency')}${metric('Unread replies',s.unreadInbox||0,'Answer customer questions first')}${metric('Human handovers',s.humanHandovers||0,'Manager or Staff response')}${metric('Ready for LMS',ready,'Complete and ready to submit')}</div>`+
    `<section class="panel today-queue"><div class="panel-head"><div><span class="eyebrow">DO THIS NEXT</span><h3>Ranked customer actions</h3><p>One clear next step replaces separate document, consent and follow-up guessing.</p></div>${pill(`${queue.length} active`,queue.length===0)}</div><div class="today-task-list">${taskRows||'<div class="today-empty"><strong>No active application needs action</strong><p>Open Customers to start or continue a customer application.</p><button class="secondary" data-open-view="customers">Open Customers</button></div>'}</div></section>`+
    `<section class="panel today-pipeline"><div class="panel-head"><div><span class="eyebrow">CUSTOMER FLOW</span><h3>Pipeline at a glance</h3></div><button class="secondary" data-open-view="pipeline">Open pipeline</button></div><div class="pipeline-summary">${pipelineColumns.map(([key,label])=>`<div><span>${esc(label)}</span><strong>${pipelineCounts[key]||0}</strong></div>`).join('')}</div></section>`+
    `<section class="today-health"><div><span class="live-dot"></span><strong>CRM data</strong><small>Live</small></div><div><span class="live-dot"></span><strong>WhatsApp</strong><small>${state.user?.whatsappMode==='CLOUD'?'Cloud connected':'Manual ready'}</small></div><div><span class="live-dot"></span><strong>Follow-up</strong><small>Rules active</small></div><button class="secondary" data-open-view="workbench">Open Tasks &amp; Approvals</button></section>`;
  document.querySelector('[data-open-notifications]')?.addEventListener('click',()=>openNotificationCentre().catch(error=>showWorkspaceError(error.message)));
}

// Client-only feature samples. They are injected after live reads and never pass through a write API.
const demoFeatureResources=['leads','applications','documents','inbox','outbox','activity'];
const demoFeatureViews=new Set();
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
function demoFeatureBanner(){return''}
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
function followUpCell(a){const status=String(a.followUpStatus||'ACTIVE').toUpperCase(),paused=['PAUSED','STOPPED','TEMPLATE_REQUIRED','HANDED_OVER'].includes(status);return `<strong>${esc(pretty(status))}</strong><small>${a.nextFollowUp?`Next: ${esc(when(a.nextFollowUp))}`:'No reminder queued'} · ${Number(a.followUpAttempts||0)}/3 attempts</small>${a.followUpPauseReason?`<small>${esc(a.followUpPauseReason)}</small>`:''}<div class="row-actions"><button class="row-action" data-followup-now="${esc(a.id)}">Queue now</button><button class="row-action secondary" data-followup-snooze="${esc(a.id)}">+24h</button><button class="row-action secondary" data-followup-toggle="${esc(a.id)}" data-followup-command="${paused?'RESUME':'PAUSE'}">${paused?'Resume':'Pause'}</button></div>`}
function applicationTable(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer</th><th>Motor</th><th>Financing</th><th>Documents</th><th>Missing</th><th>Stage</th><th>Next action</th><th>Owner</th><th>Actions</th></tr></thead><tbody>${rows.map(a=>`<tr class="${isDemoRecord(a)?'demo-row':''}"><td>${demoLabel(a)}<strong>${esc(a.customer)}</strong><small>${esc(a.id)}</small></td><td><strong>${esc(a.product||'Not selected')}</strong><small>${pretty(a.priceZone||a.region)}</small></td><td>${money(a.deposit)} deposit<br>${a.monthly?`${money(a.monthly)}/month · ${esc(a.tenure)} years`:'Quote pending'}</td><td><strong>${a.documentsReceived||0}</strong> received<br>${pretty(a.documentStatus||'Pending')}</td><td>${esc(a.missingDocuments||(a.verificationPendingDocuments?'Received · verification pending':'None'))}</td><td>${pill(a.stage,true)}<br>${pretty(a.status)}</td><td>${isDemoRecord(a)?'Demo only':nextActionCell(a)}</td><td>${esc(a.sa)}</td><td><div class="row-actions">${isDemoRecord(a)?demoOpenButton(a,'Customer 360 demo'):`<button class="row-action whatsapp-action" data-whatsapp="${esc(a.id)}">WhatsApp</button><button class="row-action" data-upload="${esc(a.id)}">Upload</button><button class="row-action secondary" data-app="${esc(a.id)}">Manage</button>`}</div></td></tr>`).join('')||empty(9)}</tbody></table></div>`}
function documentTable(rows){const canReview=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Customer / Application</th><th>Document</th><th>Received</th><th>AI status</th><th>Remarks</th><th>Actions</th></tr></thead><tbody>${rows.map(d=>{const a=state.data.applications.find(x=>x.id===d.applicationId||x.leadId===d.leadId);return `<tr class="${isDemoRecord(d)?'demo-row':''}"><td>${demoLabel(d)}<strong>${esc(a?.customer||d.leadId||'Customer')}</strong><small>${esc(d.applicationId||a?.id||d.leadId)}</small></td><td><strong>${pretty(d.type||'Unclassified')}</strong><small>${esc(d.fileName||d.mimeType||'File recorded')}</small></td><td>${esc(when(d.received||d.updated))}</td><td>${pill(d.verification||d.quality||d.classification||'AI queued',String(d.reviewRequired).toUpperCase()!=='TRUE')}</td><td>${esc(d.remarks||'—')}</td><td><div class="row-actions">${isDemoRecord(d)?demoOpenButton(d,'Customer 360 demo'):`<button class="row-action secondary" data-open-document="${esc(d.id)}">View secure file</button>${canReview&&documentAiPending(d)&&String(d.type||'').toUpperCase()!=='CTOS_CCRIS_CONSENT'?`<button class="row-action secondary" data-retry-document-ai="${esc(d.id)}">Retry AI check</button>`:''}${canReview?`<button class="row-action" data-review="${esc(d.id)}">Resolve AI exception</button>`:'<span class="pill">Manager decision required</span>'}${a?`<button class="row-action secondary" data-app="${esc(a.id)}">Open application</button>`:''}`}</div></td></tr>`}).join('')||empty(6)}</tbody></table></div>`}
function inboxTableLegacyTwo(rows){const manager=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Time</th><th>Customer</th><th>Message</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>${rows.map(x=>{const status=String(x.status).toUpperCase(),staffCanHandle=manager||!x.humanRequired||status==='ASSIGNED_TO_STAFF';return `<tr class="${x.humanRequired?'handover-row ':''}${isDemoRecord(x)?'demo-row':''}"><td>${esc(when(x.time))}</td><td>${demoLabel(x)}<strong>${esc(x.customer)}</strong><small>${esc(x.phone)}</small></td><td>${esc(x.message)}</td><td>${pill(x.status,!x.humanRequired)}</td><td>${esc(x.assignedSa||'Manager queue')}</td><td><div class="row-actions">${isDemoRecord(x)?demoOpenButton(x,'Customer 360 demo'):`<button class="row-action secondary" data-customer-profile data-lead-id="${esc(x.leadId||'')}" data-application-id="${esc(x.applicationId||'')}" data-phone="${esc(x.phone||'')}">Customer 360</button>${staffCanHandle?`<button class="row-action whatsapp-action" data-inbox-reply="${esc(x.id)}">Reply</button>`:'<span class="pill">Waiting for Manager</span>'}${manager&&status==='HUMAN_HANDOVER_REQUIRED'?`<button class="row-action" data-take-handover="${esc(x.id)}">Manager take over</button><button class="row-action secondary" data-assign-handover="${esc(x.id)}">Assign staff</button>`:''}${status!=='RESOLVED'&&(manager||status==='ASSIGNED_TO_STAFF')?`<button class="row-action secondary" data-resolve-handover="${esc(x.id)}">Resolve</button>`:''}`}</div></td></tr>`}).join('')||empty(6)}</tbody></table></div>`}
function outboxLegacyTwo(){app.innerHTML=head('Message Outbox','Manual WhatsApp Business and future Meta Cloud messages use one controlled queue.')+`<div class="security-banner"><div><strong>Manual WhatsApp ready</strong><p>Open WhatsApp, send the prepared message, then mark it sent so the audit trail stays complete.</p></div><button data-new-message>New message</button></div><section class="panel table-card"><table class="data-table"><thead><tr><th>Time</th><th>Recipient</th><th>Message</th><th>Lead / Application</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.data.outbox.map(x=>`<tr class="${isDemoRecord(x)?'demo-row':''}"><td>${esc(when(x.time))}</td><td>${demoLabel(x)}${esc(x.recipient)}</td><td>${esc(x.message)}</td><td>${esc(x.leadId||x.applicationId)}</td><td>${pill(x.status,String(x.status).toUpperCase()!=='FAILED')}</td><td><div class="row-actions">${isDemoRecord(x)?demoOpenButton(x,'Customer 360 demo'):`<button class="row-action secondary" data-customer-profile data-lead-id="${esc(x.leadId||'')}" data-application-id="${esc(x.applicationId||'')}" data-phone="${esc(x.recipient||'')}">Customer 360</button>${String(x.status).toUpperCase()==='MANUAL_PENDING'?`<button class="row-action whatsapp-action" data-open-outbox="${esc(x.id)}">Open WhatsApp</button><button class="row-action" data-mark-sent="${esc(x.id)}">Mark sent</button>`:''}`}</div></td></tr>`).join('')||empty(6)}</tbody></table></section>`;document.querySelector('[data-new-message]').onclick=()=>manualWhatsApp();bindMessaging()}
function routineFollowUpHeartbeat(item){return String(item?.type||'').toUpperCase()==='FOLLOW_UP_RUN_COMPLETED'&&/checked\s+\d+\s+applications(?:\s+and\s+\d+\s+unconverted leads)?;\s*0 due,\s*0 sent,\s*0 queued,\s*0 blocked and\s*0 handed over/i.test(String(item?.description||''))}
function activity(){
  const all=state.data.activity||[],routine=all.filter(routineFollowUpHeartbeat),showRoutine=Boolean(state.showRoutineAudit),baseRows=showRoutine?all:all.filter(item=>!routineFollowUpHeartbeat(item));
  const rowMarkup=rows=>rows.map(x=>`<tr class="${isDemoRecord(x)?'demo-row':''}"><td>${esc(when(x.time))}</td><td>${demoLabel(x)}${pretty(x.type)}</td><td>${esc(x.leadId)}</td><td>${esc(x.applicationId)}</td><td>${esc(x.description)}</td><td>${esc(x.actor)}${isDemoRecord(x)?`<div>${demoOpenButton(x,'View demo')}</div>`:''}</td></tr>`).join('')||empty(6);
  const table=rows=>`<div class="table-card"><table class="data-table"><thead><tr><th>Time</th><th>Activity</th><th>Lead</th><th>Application</th><th>Description</th><th>Actor</th></tr></thead><tbody>${rowMarkup(rows)}</tbody></table></div>`;
  app.innerHTML=head('Activity & Audit','Important customer, staff and system events for the permitted scope. Routine successful scheduler checks are collapsed by default.')+`<div class="smart-toolbar"><input id="activitySearch" placeholder="Search activity, customer, application or actor"><button class="secondary" id="activityRoutineToggle">${showRoutine?'Hide':'Show'} ${routine.length} routine scheduler checks</button><div class="toolbar-spacer"></div>${pill(`${baseRows.length} visible events`,true)}</div><section class="panel" id="activityResults">${table(baseRows)}</section>`;
  document.getElementById('activityRoutineToggle').onclick=()=>{state.showRoutineAudit=!showRoutine;activity();bind()};
  document.getElementById('activitySearch').oninput=event=>{const query=event.target.value.trim().toLowerCase(),rows=query?baseRows.filter(item=>Object.values(item).join(' ').toLowerCase().includes(query)):baseRows;document.getElementById('activityResults').innerHTML=table(rows);bind()};
  bind();
}
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
async function controlApplicationFollowUp(recordId,command,hours,nextAt='',reason=''){
  const isLead=state.data.leads.some(item=>item.id===recordId&&!item.applicationId),labels={PAUSE:'Pause automatic follow-up for this customer?',RESUME:'Resume automatic follow-up for this customer?',SEND_NOW:'Queue this customer for the next automatic follow-up run?',SNOOZE:`Delay this follow-up by ${hours||24} hours?`,STOP:'Stop all automatic follow-up for this customer?',SCHEDULE:`Schedule this follow-up for ${nextAt?when(nextAt):'the selected time'}?`};
  if(!confirm(labels[command]||'Update this follow-up?'))return;
  await post('controlApplicationFollowUp',{[isLead?'leadId':'applicationId']:recordId,command,hours,nextAt,reason});
  const [applications,leads]=await Promise.all([get('applications'),get('leads')]);state.data.applications=applications.records||[];state.data.leads=leads.records||[];loadedResources.add('applications');loadedResources.add('leads');render();
}
function openFollowUpSchedule(recordId){
  const start=new Date(Date.now()+24*3600000),local=new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16),minimum=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  formModal('Schedule customer follow-up',`<form id="followUpScheduleForm" class="crm-form"><label class="form-wide">Follow-up date and time<input name="nextAt" type="datetime-local" min="${esc(minimum)}" value="${esc(local)}" required></label><label class="form-wide">Reason / next action<textarea name="reason" rows="4" placeholder="Example: Customer asked us to call after salary day"></textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save schedule</button></div><p class="form-wide notice" id="formMessage">The reminder will still respect business hours and approved sending days.</p></form>`);
  const form=document.getElementById('followUpScheduleForm');form.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),message=document.getElementById('formMessage'),nextAt=new Date(form.nextAt.value).toISOString();button.disabled=true;try{await controlApplicationFollowUp(recordId,'SCHEDULE',0,nextAt,form.reason.value.trim());document.querySelector('.drawer-backdrop')?.remove()}catch(error){message.textContent=error.message;button.disabled=false}};
}
function bindFollowUpControls(){
  document.querySelectorAll('[data-followup-now]').forEach(button=>button.onclick=()=>controlApplicationFollowUp(button.dataset.followupNow,'SEND_NOW').catch(error=>alert(error.message)));
  document.querySelectorAll('[data-followup-snooze]').forEach(button=>button.onclick=()=>controlApplicationFollowUp(button.dataset.followupSnooze,'SNOOZE',24).catch(error=>alert(error.message)));
  document.querySelectorAll('[data-followup-schedule]').forEach(button=>button.onclick=()=>openFollowUpSchedule(button.dataset.followupSchedule));
  document.querySelectorAll('[data-followup-stop]').forEach(button=>button.onclick=()=>controlApplicationFollowUp(button.dataset.followupStop,'STOP',0,'','Customer requested no further follow-up').catch(error=>alert(error.message)));
  document.querySelectorAll('[data-followup-toggle]').forEach(button=>button.onclick=()=>controlApplicationFollowUp(button.dataset.followupToggle,button.dataset.followupCommand).catch(error=>alert(error.message)));
}
function bind(){
  document.querySelectorAll('[data-lead]').forEach(button=>button.onclick=()=>{const record=state.data.leads.find(item=>item.id===button.dataset.lead),demo=demoForRecord(record);return demo?openCustomer360Demo(demo.id):openLead(button.dataset.lead)});
  document.querySelectorAll('[data-app]').forEach(button=>button.onclick=()=>{const record=state.data.applications.find(item=>item.id===button.dataset.app),demo=demoForRecord(record);return demo?openCustomer360Demo(demo.id):openApp(button.dataset.app)});
  document.querySelectorAll('[data-upload]').forEach(button=>button.onclick=()=>{const record=state.data.applications.find(item=>item.id===button.dataset.upload);return isDemoRecord(record)?openCustomer360Demo(record.demoCustomerId):uploadDocument(record)});
  document.querySelectorAll('[data-review]').forEach(button=>button.onclick=()=>{const record=state.data.documents.find(item=>item.id===button.dataset.review);return isDemoRecord(record)?openCustomer360Demo(record.demoCustomerId):reviewDocument(record)});bindDocumentPreviewButtons();
  document.querySelectorAll('[data-retry-document-ai]').forEach(button=>button.onclick=async()=>{if(!confirm('Requeue this document for automatic validation?'))return;button.disabled=true;try{await post('retryDocumentValidation',{documentId:button.dataset.retryDocumentAi});const response=await get('documents');state.data.documents=response.records||[];loadedResources.add('documents');render()}catch(error){alert(error.message);button.disabled=false}});
  document.querySelectorAll('[data-whatsapp]').forEach(button=>button.onclick=()=>{const record=state.data.applications.find(item=>item.id===button.dataset.whatsapp);return isDemoRecord(record)?openCustomer360Demo(record.demoCustomerId):manualWhatsApp(record)});
  document.querySelectorAll('[data-refresh]').forEach(button=>button.onclick=async()=>{if(!await load())return;await ensureViewData(state.view);render()});
  bindHubNavigation();bindMessaging();bindCustomer360Demos();bindFollowUpControls();
}
function render(){
  syncDemoFeatureData();
  const documentBadge=document.getElementById('documentBadge');if(documentBadge)documentBadge.textContent=state.data.documents.filter(record=>!isDemoRecord(record)).length;
  updateNotificationBadge();
  syncPrimaryNavigation();document.querySelectorAll('.nav-item:not([hidden])').forEach(item=>{item.onclick=()=>navigateToView(item.dataset.view).catch(error=>showWorkspaceError(error.message))});
  ({dashboard,customers,pipeline,workbench,followup,products,reports,management,leads,applications,documents,inbox,outbox,catalog,pricing,handphoneCatalog:catalog,handphonePricing:pricing,team,users:usersAdmin,activity,settings}[state.view]||dashboard)();
  bind();applyDemoFeatureBanner();scheduleTableScrollDock();
}

function whatsappChannelLabel(record={}){
  return record.channelName||record.displayNumber||record.channelId||'Unassigned channel';
}

async function refreshWhatsAppChannels(){
  const response=await get('channels');state.data.channels=response.records||[];loadedResources.add('channels');
}

function editWhatsAppChannel(channel){
  const branchOptions=[...new Map(state.data.team.filter(member=>member.branchId).map(member=>[member.branchId,member.branch||member.branchId])).entries()].map(([id,name])=>`<option value="${esc(id)}">${esc(name)} · ${esc(id)}</option>`).join('');
  formModal('Configure official WhatsApp number',`<form id="whatsappChannelForm" class="crm-form"><div class="form-wide channel-binding-notice"><strong>${esc(channel.id)}</strong><span>This slot keeps every conversation bound to the official number that received it.</span></div><label>Channel name<input name="name" value="${esc(channel.name||'')}" required></label><label>Region<select name="region"><option value="EAST_MALAYSIA">East Malaysia</option><option value="WEST_MALAYSIA">West Malaysia</option></select></label><label>Business unit<select name="businessUnit"><option value="MOTOR">Motor</option><option value="HANDPHONE">Handphone</option></select></label><label>Team ID<input name="teamId" value="${esc(channel.teamId||'')}" placeholder="TEAM-HP-EAST"></label><label>Slot<input name="slot" value="${esc(channel.slot||'')}" readonly></label><label>Branch (optional)<select name="branchId"><option value="">Regional default</option>${branchOptions}</select></label><label>Official display number<input name="displayNumber" value="${esc(channel.displayNumber||'')}" placeholder="+60..."></label><label>Meta Phone Number ID<input name="phoneNumberId" value="${esc(channel.phoneNumberId||'')}" inputmode="numeric"></label><label>WABA ID<input name="wabaId" value="${esc(channel.wabaId||'')}" inputmode="numeric"></label><label>Meta App ID<input name="appId" value="${esc(channel.appId||'')}" inputmode="numeric"></label><label>Business Portfolio ID<input name="portfolioId" value="${esc(channel.portfolioId||'')}" inputmode="numeric"></label><label>Credential key<input name="credentialKey" value="${esc(channel.credentialKey||channel.id.replaceAll('-','_'))}" pattern="[A-Za-z0-9_]+"></label><label>Make connection alias<input name="connectionAlias" value="${esc(channel.connectionAlias||'')}"></label><label>Webhook route key<input name="webhookRouteKey" value="${esc(channel.webhookRouteKey||channel.id)}"></label><label>Environment<select name="environment"><option value="PRODUCTION">Production</option><option value="TEST">Test</option></select></label><label>Meta phone verified at<input name="lastVerified" type="datetime-local" value="${esc(String(channel.lastVerified||'').slice(0,16))}"></label><label class="channel-check"><input name="active" type="checkbox"> Active channel</label><label class="channel-check"><input name="inboundEnabled" type="checkbox"> Receive inbound</label><label class="channel-check"><input name="outboundEnabled" type="checkbox"> Send outbound</label><label class="form-wide">Internal notes<textarea name="notes" rows="3">${esc(channel.notes||'')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Save channel</button></div><p class="form-wide notice" id="formMessage">Access tokens are never entered here. Record the verification time only after Meta confirms the official number. Unverified numbers cannot be activated or used for Cloud sending.</p></form>`);
  const form=document.getElementById('whatsappChannelForm');form.region.value=channel.region||'EAST_MALAYSIA';form.businessUnit.value=channel.businessUnit==='HANDPHONE'?'HANDPHONE':'MOTOR';form.branchId.value=channel.branchId||'';form.environment.value=channel.environment||'PRODUCTION';form.active.checked=!!channel.active;form.inboundEnabled.checked=!!channel.inboundEnabled;form.outboundEnabled.checked=!!channel.outboundEnabled;form.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),message=document.getElementById('formMessage'),values=Object.fromEntries(new FormData(form));button.disabled=true;try{await post('saveWhatsAppChannel',{channelId:channel.id,...values,active:form.active.checked,inboundEnabled:form.inboundEnabled.checked,outboundEnabled:form.outboundEnabled.checked});document.querySelector('.drawer-backdrop').remove();await refreshWhatsAppChannels();state.view='settings';render()}catch(error){message.textContent=error.message;button.disabled=false}};
}

function whatsappChannelManager(){
  const channels=[...(state.data.channels||[])].filter(channel=>/^JKM-WA-(EAST|WEST)-0[1-5]$/.test(String(channel.id||''))).sort((a,b)=>String(a.region).localeCompare(String(b.region))||String(a.slot).localeCompare(String(b.slot))||String(a.id).localeCompare(String(b.id)));
  const east=channels.filter(channel=>channel.region==='EAST_MALAYSIA'),west=channels.filter(channel=>channel.region==='WEST_MALAYSIA'),connected=channels.filter(channel=>channel.active&&channel.inboundEnabled&&channel.outboundEnabled);
  const rows=channels.map(channel=>`<tr><td><strong>${esc(channel.name||channel.id)}</strong><small>${esc(channel.id)}</small></td><td>${pretty(channel.region)}</td><td><strong>${pretty(channel.businessUnit||'UNASSIGNED')}</strong><small>${esc(channel.teamId||'No team assigned')}</small></td><td>${esc(channel.slot||'Legacy')}</td><td><strong>${esc(channel.displayNumber||'Waiting for official number')}</strong><small>${esc(channel.phoneNumberId?'Meta ID configured':'Phone Number ID pending')}</small></td><td>${pill(channel.active?'Active':channel.status||'Reserved',channel.active)}</td><td>${pill(channel.inboundEnabled?'On':'Off',channel.inboundEnabled)} / ${pill(channel.outboundEnabled?'On':'Off',channel.outboundEnabled)}</td><td>${pill(channel.credentialConfigured?'Protected secret ready':'Credential pending',channel.credentialConfigured)}</td><td>${state.user?.role==='ADMIN'?`<button class="row-action" data-edit-channel="${esc(channel.id)}">Configure</button>`:'Read only'}</td></tr>`).join('')||empty(9);
  const panel=`<section class="panel whatsapp-channel-panel"><div class="panel-head"><div><span class="eyebrow">MULTI-NUMBER ROUTING</span><h3>Official WhatsApp number control</h3><p>Capacity is reserved for five East Malaysia and five West Malaysia numbers. Only connected slots are used; customer replies stay on the exact number that received the conversation.</p></div><span class="pill green">${connected.length} LIVE · ${channels.length} SLOTS</span></div><div class="metric-grid compact-metrics">${metric('East Malaysia slots',east.length,east.filter(item=>item.active).length+' active')}${metric('West Malaysia slots',west.length,west.filter(item=>item.active).length+' active')}${metric('Same-number reply','ENFORCED','Inbound channel binding')}${metric('Secrets exposed','0','Tokens remain in Vercel')}</div><div class="table-card"><table class="data-table"><thead><tr><th>Channel</th><th>Region</th><th>Business / team</th><th>Slot</th><th>Official number</th><th>Status</th><th>Inbound / Outbound</th><th>Credential</th><th>Admin action</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  const integrationPanel=app.querySelector('.integration-readiness-panel');if(integrationPanel)integrationPanel.insertAdjacentHTML('afterend',panel);else app.insertAdjacentHTML('beforeend',panel);
  document.querySelectorAll('[data-edit-channel]').forEach(button=>button.onclick=()=>editWhatsAppChannel(channels.find(channel=>channel.id===button.dataset.editChannel)));
}

const FOLLOW_UP_TEMPLATE_REGISTRY={
  jomkaki_sales_enquiry_v1:{status:'Pending Meta approval',body:'Hai, saya masih boleh bantu cari motor atau telefon yang sesuai dengan bajet anda. Balas mesej ini dengan bajet bulanan atau jenis model yang anda suka dan kami akan cadangkan beberapa pilihan Loan Kedai.'},
  jomkaki_quote_followup_v1:{status:'Pending Meta approval',body:'Hai, kami ingin sambung semula pertanyaan anda tentang model dan ansuran Loan Kedai. Balas mesej ini jika anda mahu semak pilihan lain, warna, spesifikasi, bajet bulanan atau teruskan permohonan.'},
  jomkaki_documents_start_v1:{status:'Active',body:'Hai, permohonan Loan Kedai anda masih belum mempunyai dokumen untuk semakan. Sila balas mesej ini dan hantar MyKad depan dan belakang bersama slip gaji terkini atau penyata EPF. Jika belum lengkap, hantar yang ada dahulu dan kami akan bantu semak.'},
  jomkaki_documents_partial_v1:{status:'Active',body:'Hai, kami telah menerima sebahagian dokumen permohonan Loan Kedai anda. Masih ada dokumen yang diperlukan untuk meneruskan semakan. Sila balas mesej ini supaya kami boleh maklumkan dokumen yang belum lengkap dan bantu anda teruskan permohonan.'},
  jomkaki_consent_unsigned_v1:{status:'Active',body:'Hai, borang persetujuan untuk permohonan Loan Kedai anda masih belum ditandatangani. Sila tandatangan dan balas mesej ini dengan PDF atau gambar borang yang jelas. Anda tidak perlu menunggu dokumen lain lengkap untuk menghantarnya.'},
  jomkaki_application_info_v1:{status:'Active',body:'Hai, maklumat permohonan Loan Kedai anda masih belum lengkap. Sila balas mesej ini dan lengkapkan borang maklumat yang telah dihantar supaya semakan dapat diteruskan. Jika ada bahagian yang anda tidak pasti, beritahu kami dan kami akan bantu.'},
  jomkaki_cad_documents_v1:{status:'Active',body:'Hai, pihak semakan memerlukan dokumen tambahan untuk permohonan Loan Kedai anda. Sila balas mesej ini dan hantar dokumen yang diminta supaya kami boleh teruskan semakan. Jika anda belum pasti dokumen mana yang diperlukan, balas sahaja dan kami akan semak untuk anda.'},
  jomkaki_document_send_v1:{status:'Active',body:'Dokumen berkaitan permohonan Loan Kedai anda dilampirkan bersama mesej ini. Sila buka dan semak dokumen tersebut. Jika perlu tandatangan atau lengkapkan maklumat, balas semula di WhatsApp ini selepas selesai.'},
  jomkaki_image_send_v1:{status:'Active',body:'Gambar berkaitan permohonan Loan Kedai anda dilampirkan bersama mesej ini. Sila semak gambar tersebut. Jika ada bahagian yang kurang jelas, balas di WhatsApp ini dan kami akan bantu.'},
  jomkaki_direct_debit_v1:{status:'Pending Meta approval',body:'Hai, permohonan Loan Kedai anda sudah sampai ke langkah Direct Debit. Sila lengkapkan arahan Direct Debit yang dihantar supaya proses seterusnya boleh diteruskan. Jika ada bahagian yang kurang jelas, balas mesej ini dan kami akan bantu.'},
  jomkaki_agreement_unsigned_v1:{status:'Pending Meta approval',body:'Hai, perjanjian untuk permohonan Loan Kedai anda masih belum ditandatangani. Sila semak dan tandatangan perjanjian yang dihantar, kemudian balas mesej ini selepas selesai. Jika perlukan bantuan, beritahu kami.'},
  jomkaki_continue_enquiry_v1:{status:'Pending Meta approval',body:'Hai, kami ingin sambung semula pertanyaan anda tentang model dan pelan Loan Kedai JomKaki Rider. Balas mesej ini dengan model atau soalan anda dan kami akan bantu terus dari perbualan terakhir.'},
  jomkaki_product_image_v1:{status:'Pending Meta approval',body:'Hai, gambar model yang anda minat dilampirkan bersama mesej ini. Balas mesej ini jika anda mahu semak warna, pilihan storan, ansuran bulanan atau teruskan permohonan Loan Kedai.'}
};
const followUpUpper=value=>String(value||'').trim().toUpperCase();
function inferredFollowUpRule(application={}){
  if(application.followUpRule)return followUpUpper(application.followUpRule);
  if(/(ADDITIONAL|MISSING|REQUIRED|PENDING_DOCUMENT)/.test(followUpUpper(application.cadStatus)))return'CAD_ADDITIONAL_DOCUMENTS';
  if(['QUEUED','SENT','SIGNED_PENDING_VERIFICATION','REJECTED_RESUBMISSION_REQUIRED'].includes(followUpUpper(application.creditConsentStatus)))return'CONSENT_UNSIGNED';
  if(String(application.missingApplicationFields||'').trim())return'INFORMATION_INCOMPLETE';
  if(followUpUpper(application.minimumDocumentsComplete)==='TRUE'||application.aiDocumentsComplete){const approved=followUpUpper(application.status)==='APPROVED'||/(APPROVED|ACCEPTED|SUCCESS)/.test(followUpUpper(application.cadStatus))||['APPROVED','ACCEPTED','SUCCESS','COMPLETED'].includes(followUpUpper(application.lmsSubmissionStatus));if(approved&&!['COMPLETED','ACTIVE'].includes(followUpUpper(application.directDebitStatus)))return'DIRECT_DEBIT_INCOMPLETE';if(approved&&!['SIGNED','COMPLETED','APPROVED'].includes(followUpUpper(application.agreementStatus)))return'AGREEMENT_UNSIGNED';return''}
  if(String(application.missingDocuments||'').trim()||Number(application.documentsReceived||0)>0)return Number(application.documentsReceived||0)>0?'DOCUMENTS_PARTIAL':'DOCUMENTS_NOT_STARTED';
  return'';
}
function followUpOperationalSnapshot(rules=[]){
  const open=followUpQueueCases(rules);
  const nowValue=Date.now(),blockedStatuses=new Set(['DELIVERY_FAILED','BLOCKED_CHANNEL','TEMPLATE_REQUIRED']),handoverStatuses=new Set(['HANDED_OVER']),inactiveStatuses=new Set(['HANDED_OVER','STOPPED']);
  const byRule=Object.fromEntries(rules.map(rule=>[rule.id,{waiting:0,due:0,issues:0}]));
  let active=0,due=0,issues=0,handedOver=0,stopped=0,lastSent='';
  open.forEach(application=>{const ruleId=application.ruleId,status=followUpUpper(application.followUpStatus||'ACTIVE'),stats=byRule[ruleId];if(!stats)return;if(!inactiveStatuses.has(status)){stats.waiting+=1;active+=1}const isDue=application.nextFollowUp&&new Date(application.nextFollowUp).valueOf()<=nowValue&&!blockedStatuses.has(status)&&!inactiveStatuses.has(status);if(isDue){stats.due+=1;due+=1}if(blockedStatuses.has(status)){stats.issues+=1;issues+=1}if(handoverStatuses.has(status))handedOver+=1;if(status==='STOPPED')stopped+=1;if(application.lastFollowUpAt&&(!lastSent||new Date(application.lastFollowUpAt)>new Date(lastSent)))lastSent=application.lastFollowUpAt});
  const nextCheck=new Date(Math.ceil((nowValue+1000)/900000)*900000);
  return{byRule,active,due,issues,handedOver,stopped,lastSent,nextCheck};
}
function leadFollowUpRule(lead={}){
  if(lead.followUpRule)return followUpUpper(lead.followUpRule);
  const product=String(lead.model||'').trim();
  return product&&!/^(MOTOR|HANDPHONE)\s+ENQUIRY$/i.test(product)?'QUOTE_NO_RESPONSE':'SALES_ENQUIRY_IDLE';
}
function followUpOutcomeSnapshot(){
  const messages=(state.data.outbox||[]).filter(message=>message.followUpRule||message.automationKey||followUpUpper(message.routingStatus).includes('FOLLOW_UP_AUTOMATION'));
  const contacted=new Set(messages.map(message=>message.leadId||message.applicationId).filter(Boolean));
  const replies=[...(state.data.leads||[]),...(state.data.applications||[])].filter(record=>record.lastFollowUpAt&&record.lastCustomerReplyAt&&new Date(record.lastCustomerReplyAt)>new Date(record.lastFollowUpAt));
  const converted=(state.data.leads||[]).filter(lead=>lead.applicationId&&contacted.has(lead.id));
  const progressed=(state.data.applications||[]).filter(application=>contacted.has(application.leadId||application.id)&&(Number(application.documentsReceived||0)>0||application.creditConsentStatus&&followUpUpper(application.creditConsentStatus)!=='NOT_SENT'));
  const delivered=messages.filter(message=>message.deliveredAt||['DELIVERED','READ'].includes(followUpUpper(message.status))).length,read=messages.filter(message=>message.readAt||followUpUpper(message.status)==='READ').length;
  return{messages:messages.length,replies:new Set(replies.map(record=>record.leadId||record.id)).size,converted:converted.length,progressed:progressed.length,delivered,read};
}
function followUpControlData(global={},snapshot={}){
  const issueStatuses=new Set(['DELIVERY_FAILED','BLOCKED_CHANNEL','TEMPLATE_REQUIRED']);
  const handoverStatuses=new Set(['HANDED_OVER','STOPPED']);
  const exceptions=followUpQueueCases(state.data.followUpSettings||[]).filter(record=>{
    const status=followUpUpper(record.followUpStatus);
    return issueStatuses.has(status)||handoverStatuses.has(status);
  }).sort((left,right)=>new Date(right.updated||right.time||right.lastFollowUpAt||0)-new Date(left.updated||left.time||left.lastFollowUpAt||0));
  const customerById=new Map([...businessApplications().map(application=>[application.id,application.customer]),...(state.data.leads||[]).map(lead=>[lead.id,lead.name])]);
  const history=(state.data.outbox||[]).filter(message=>message.automationKey||followUpUpper(message.routingStatus).includes('FOLLOW_UP_AUTOMATION')).sort((left,right)=>new Date(right.time||0)-new Date(left.time||0)).slice(0,20).map(message=>({
    ...message,
    customer:customerById.get(message.applicationId)||customerById.get(message.leadId)||message.applicationId||message.leadId||'Customer'
  }));
  const runEvents=(state.data.activity||[]).filter(event=>followUpUpper(event.type)==='FOLLOW_UP_RUN_COMPLETED').sort((left,right)=>new Date(right.time||0)-new Date(left.time||0));
  const lastRun=runEvents[0]?.time||snapshot.lastSent||'';
  const runAge=lastRun?Date.now()-new Date(lastRun).valueOf():Infinity;
  const schedulerStatus=!global.enabled?'Paused':!lastRun?'Awaiting first run':runAge<=45*60000?'Healthy':'Check scheduler';
  return{exceptions,history,lastRun,schedulerStatus,schedulerHealthy:global.enabled&&runAge<=45*60000};
}
function followUpTemplateRegistryEntry(rule={}){return FOLLOW_UP_TEMPLATE_REGISTRY[String(rule.templateName||'').trim()]||null}
function followUpTemplateReady(template){return String(template?.status||'').trim().toUpperCase()==='ACTIVE'}
function followUpTemplateFor(rule={}){const template=followUpTemplateRegistryEntry(rule);return followUpTemplateReady(template)?template:null}
function openFollowUpTemplatePreview(rule){
  const template=followUpTemplateRegistryEntry(rule),body=template?.body||'This template is not in the approved CRM registry. Verify it in Meta before using it.';
  formModal('Follow-up template preview',`<div class="template-preview-card"><div class="template-preview-head"><div><span>Template</span><strong>${esc(rule.templateName||'Not configured')}</strong></div>${pill(template?.status||'Verification required',!!template)}</div><p>${esc(body)}</p><small>${esc(rule.language||'ms')} · View only. Editing an approved template may require Meta review again.</small></div><div class="form-actions"><button type="button" class="secondary" data-cancel>Close</button>${template?`<button type="button" data-open-template-test="${esc(rule.id)}">Controlled test</button>`:''}</div>`);
  document.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();
  document.querySelector('[data-open-template-test]')?.addEventListener('click',()=>openFollowUpTemplateTest(rule));
}
function openFollowUpTemplateTest(rule){
  const template=followUpTemplateRegistryEntry(rule),options=customerOptions();if(!followUpTemplateReady(template))return alert('This template must be approved in Meta before a controlled test can be sent.');
  formModal('Controlled template test',`<form id="followUpTemplateTestForm" class="crm-form"><label class="form-wide">Permitted test customer<select name="customer" required>${options||'<option value="">No permitted customer is available</option>'}</select></label><label class="form-wide">Approved template<input value="${esc(rule.templateName)}" readonly></label><label class="form-wide">Message preview<textarea rows="6" readonly>${esc(template.body)}</textarea></label><label class="form-wide checkbox-line"><input name="confirmed" type="checkbox" required> I confirm this WhatsApp message may be sent to the selected customer.</label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit" ${options?'':'disabled'}>Send controlled test</button></div><p class="form-wide notice" id="formMessage">The test uses the selected customer's bound official JomKaki WhatsApp number and is written to the normal audit trail.</p></form>`);
  const form=document.getElementById('followUpTemplateTestForm');form.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),message=document.getElementById('formMessage'),target=customerTarget(form.customer.value);if(!target)return message.textContent='Choose a permitted customer first.';if(!confirm(`Send ${rule.templateName} to ${target.name||target.phone}?`))return;button.disabled=true;try{const saved=await post('sendCustomerMessage',{leadId:target.leadId,applicationId:target.applicationId,phone:target.phone,message:template.body,messageType:'TEMPLATE',templateName:rule.templateName,language:rule.language||'ms'});message.textContent=saved.mode==='MANUAL'?'Test prepared in the audited outbox.':'Controlled test sent through the customer’s bound official number.'}catch(error){message.textContent=error.message;button.disabled=false}};
}
async function openFollowUpSafeScan(button){
  button.disabled=true;
  try{
    const scan=await post('previewFollowUpRun',{}),summary=scan.summary||{},rows=(scan.results||[]).slice(0,20).map(result=>`<div class="list-row"><div><strong>${esc(result.recordId||result.applicationId||result.leadId||'Customer')}</strong><span>${esc(result.recordType==='LEAD'?'Sales enquiry':pretty(result.ruleId||result.blocked||'Due'))}</span></div>${pill(result.blocked?'Blocked':result.templateRequired?'Template':'Ready',!result.blocked)}</div>`).join('');
    formModal('Safe follow-up scan',`<div class="safe-scan-summary">${metric('Customers checked',scan.checked||0,`${scan.applicationsChecked||0} applications · ${scan.leadsChecked||0} enquiries`)}${metric('Due now',summary.due||0,'No message sent')}${metric('Ready to send',summary.ready||0,'If scheduler runs')}${metric('Blocked',summary.blocked||0,'Needs attention')}</div><section class="profile-section"><h3>Scan result</h3><div class="list">${rows||'<div class="list-row"><strong>No follow-up is due now</strong></div>'}</div></section><p class="notice">This scan is read-only. It does not send WhatsApp messages or change a customer record.</p><div class="form-actions"><button type="button" data-cancel>Close</button></div>`);
    document.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();
  }catch(error){alert(error.message)}finally{button.disabled=false}
}
function followUpSettingsManager(){
  const rules=state.data.followUpSettings||[];if(!rules.length)return;
  const global=rules[0]||{},snapshot=followUpOperationalSnapshot(rules),activeDays=new Set((Array.isArray(global.activeDays)?global.activeDays:String(global.activeDays||'1,2,3,4,5,6').split(',')).map(Number));
  const days=[['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6],['Sun',0]].map(([label,value])=>`<label class="channel-check"><input type="checkbox" data-followup-day="${value}" ${activeDays.has(value)?'checked':''}> ${label}</label>`).join('');
  const cards=rules.map(rule=>{const stats=snapshot.byRule[rule.id]||{waiting:0,due:0,issues:0},template=followUpTemplateFor(rule),ready=followUpTemplateReady(template),templateLabel=!rule.templateName?'Missing':template?.status||'Verify in Meta';return`<article class="follow-up-rule-card" data-followup-rule="${esc(rule.id)}"><header><div><span class="eyebrow">${esc(rule.id)}</span><h4>${esc(rule.label)}</h4></div><label class="rule-toggle"><input data-rule-field="enabled" type="checkbox" ${rule.enabled?'checked':''}> On</label></header><div class="follow-up-rule-stats"><span><strong>${stats.waiting}</strong> waiting</span><span><strong>${stats.due}</strong> due now</span><span class="${stats.issues?'has-issue':''}"><strong>${stats.issues}</strong> issues</span></div><div class="follow-up-schedule-grid"><label>1st follow-up<small>Hours after latest reply</small><input data-rule-field="first" type="number" min="0.25" max="720" step="0.25" value="${esc(rule.delays?.[0]??3)}"></label><label>2nd follow-up<small>Hours after first</small><input data-rule-field="second" type="number" min="0.25" max="720" step="0.25" value="${esc(rule.delays?.[1]??24)}"></label><label>3rd follow-up<small>Hours after second</small><input data-rule-field="third" type="number" min="0.25" max="720" step="0.25" value="${esc(rule.delays?.[2]??48)}"></label><label>Maximum attempts<small>Then hand over to Staff</small><input data-rule-field="max" type="number" min="1" max="3" step="1" value="${esc(rule.maxAttempts||3)}"></label></div><div class="follow-up-template-row"><label>Approved Meta template<input data-rule-field="template" value="${esc(rule.templateName||'')}" placeholder="Approved Meta template"></label><label>Language<select data-rule-field="language"><option value="ms">Bahasa Malaysia</option><option value="en_US">English</option></select></label><div class="template-actions">${pill(templateLabel,ready)}<button type="button" class="row-action secondary" data-preview-followup="${esc(rule.id)}">Preview</button><button type="button" class="row-action" data-test-followup="${esc(rule.id)}" ${ready?'':'disabled'}>Test</button></div></div></article>`}).join('');
  const panel=`<section class="panel follow-up-settings-panel"><div class="panel-head"><div><span class="eyebrow">AUTOMATIC FOLLOW-UP</span><h3>Customer follow-up control</h3><p>Customer replies reset the cycle. The first delay starts from the latest customer reply; later delays start from the previous reminder and move into the next permitted business window.</p></div>${pill(global.enabled?'Automation on':'Automation paused',global.enabled)}</div><div class="follow-up-ops-grid">${metric('Waiting customers',snapshot.active,'Across five follow-up stages')}${metric('Due now',snapshot.due,'Next scheduler check '+when(snapshot.nextCheck))}${metric('Delivery issues',snapshot.issues,'Template, number or delivery failures')}${metric('Handed to Staff',snapshot.handedOver,'Maximum attempts reached')}${metric('Last automated send',snapshot.lastSent?when(snapshot.lastSent):'None yet','Recorded on current live cases')}${metric('Templates','5 / 5 Active','Approved in JomKaki_Assistant')}</div><div class="follow-up-policy-strip"><strong>Current policy</strong><span>Customer reply → reset attempts</span><span>Human takeover → pause automation</span><span>Maximum attempts → round-robin Staff handover</span></div><form id="followUpSettingsForm"><div class="crm-form follow-up-global-form"><label class="channel-check form-wide"><input name="automationEnabled" type="checkbox" ${global.enabled?'checked':''}> Enable automatic follow-up</label><label>Business hours start<input name="businessStart" type="time" value="${esc(global.businessStart||'09:00')}" required></label><label>Business hours end<input name="businessEnd" type="time" value="${esc(global.businessEnd||'17:30')}" required></label><label>Maximum customers per run<input name="maxPerRun" type="number" min="1" max="100" value="${esc(global.maxPerRun||20)}"></label><label>Timezone<input name="timezone" value="${esc(global.timezone||'Asia/Kuala_Lumpur')}" readonly></label><div class="form-wide"><strong>Sending days</strong><div class="row-actions">${days}</div></div></div><div class="follow-up-rule-list">${cards}</div><div class="form-actions follow-up-save-bar"><button type="submit">Save follow-up rules</button><span class="notice" id="followUpSettingsMessage">${global.updatedAt?`Last saved ${esc(when(global.updatedAt))} by ${esc(global.updatedBy||'Administrator')}.`:'Save changes before the next scheduler run.'} Messages outside 24 hours use the approved Meta template.</span></div></form></section>`;
  const integrationPanel=app.querySelector('.integration-readiness-panel');if(integrationPanel)integrationPanel.insertAdjacentHTML('afterend',panel);else app.insertAdjacentHTML('beforeend',panel);
  rules.forEach(rule=>{const row=document.querySelector(`[data-followup-rule="${rule.id}"]`),language=row?.querySelector('[data-rule-field="language"]');if(language)language.value=rule.language||'ms'});
  const draftFor=id=>{const row=document.querySelector(`[data-followup-rule="${id}"]`),base=rules.find(rule=>rule.id===id)||{};return{...base,templateName:row?.querySelector('[data-rule-field="template"]')?.value||'',language:row?.querySelector('[data-rule-field="language"]')?.value||'ms'}};
  document.querySelectorAll('[data-preview-followup]').forEach(button=>button.onclick=()=>openFollowUpTemplatePreview(draftFor(button.dataset.previewFollowup)));
  document.querySelectorAll('[data-test-followup]').forEach(button=>button.onclick=()=>openFollowUpTemplateTest(draftFor(button.dataset.testFollowup)));
  const form=document.getElementById('followUpSettingsForm'),message=document.getElementById('followUpSettingsMessage');form.addEventListener('input',()=>{message.textContent='Unsaved changes. Save them before leaving this page.';message.classList.add('unsaved')});form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{const active=[...form.querySelectorAll('[data-followup-day]:checked')].map(input=>Number(input.dataset.followupDay));if(!active.length)throw new Error('Choose at least one sending day');const ruleValues=[...form.querySelectorAll('[data-followup-rule]')].map(row=>({id:row.dataset.followupRule,label:row.querySelector('h4').textContent,enabled:row.querySelector('[data-rule-field="enabled"]').checked,delays:['first','second','third'].map(field=>Number(row.querySelector(`[data-rule-field="${field}"]`).value)),maxAttempts:Number(row.querySelector('[data-rule-field="max"]').value),templateName:row.querySelector('[data-rule-field="template"]').value,language:row.querySelector('[data-rule-field="language"]').value}));const saved=await post('saveFollowUpSettings',{global:{enabled:form.automationEnabled.checked,businessStart:form.businessStart.value,businessEnd:form.businessEnd.value,activeDays:active,timezone:form.timezone.value,utcOffsetMinutes:480,maxPerRun:Number(form.maxPerRun.value),replyResetsAttempts:true,pauseOnHumanTakeover:true},rules:ruleValues});state.data.followUpSettings=saved.records||[];loadedResources.add('followUpSettings');settings()}catch(error){message.textContent=error.message;button.disabled=false}};
}

function followUpQueueCases(rules=[]){
  const labels=new Map(rules.map(rule=>[rule.id,rule.label]));
  const closed=new Set(['COMPLETED','REJECTED','CANCELLED','CLOSED']);
  const applications=businessApplications().filter(application=>!closed.has(followUpUpper(application.status))).map(application=>{
    const ruleId=inferredFollowUpRule(application),status=followUpUpper(application.followUpStatus||'ACTIVE'),next=application.nextFollowUp||'',due=next&&new Date(next).valueOf()<=Date.now();
    return{...application,recordType:'APPLICATION',recordId:application.id,ruleId,ruleLabel:labels.get(ruleId)||pretty(ruleId||'Follow-up'),followUpStatus:status,nextFollowUp:next,due};
  }).filter(application=>application.ruleId);
  const converted=new Set(applications.map(application=>application.leadId).filter(Boolean)),leads=(state.data.leads||[]).filter(lead=>!lead.applicationId&&!converted.has(lead.id)&&!['CONVERTED','COMPLETED','REJECTED','CANCELLED','CLOSED','DO_NOT_CONTACT'].includes(followUpUpper(lead.status))).map(lead=>{
    const ruleId=leadFollowUpRule(lead),status=followUpUpper(lead.followUpStatus||'ACTIVE'),next=lead.nextFollowUp||'',due=next&&new Date(next).valueOf()<=Date.now();
    return{...lead,customer:lead.name,product:lead.model,recordType:'LEAD',recordId:lead.id,ruleId,ruleLabel:labels.get(ruleId)||pretty(ruleId),followUpStatus:status,nextFollowUp:next,due};
  });
  return [...applications,...leads].sort((left,right)=>{
    const priority=value=>['DELIVERY_FAILED','BLOCKED_CHANNEL','TEMPLATE_REQUIRED','HANDED_OVER','STOPPED'].includes(value.followUpStatus)?0:value.due?1:2;
    return priority(left)-priority(right)||new Date(left.nextFollowUp||'2999-01-01')-new Date(right.nextFollowUp||'2999-01-01');
  });
}

function followUpTeamWorkspace(){
  const rules=state.data.followUpSettings||[],global=rules[0]||{},snapshot=followUpOperationalSnapshot(rules),operations=followUpControlData(global,snapshot),cases=followUpQueueCases(rules),outcomes=followUpOutcomeSnapshot();
  const due=cases.filter(record=>record.due),sales=cases.filter(record=>['SALES_ENQUIRY_IDLE','QUOTE_NO_RESPONSE'].includes(record.ruleId)),documents=cases.filter(record=>['DOCUMENTS_NOT_STARTED','DOCUMENTS_PARTIAL','CAD_ADDITIONAL_DOCUMENTS'].includes(record.ruleId)),information=cases.filter(record=>record.ruleId==='INFORMATION_INCOMPLETE'),consent=cases.filter(record=>record.ruleId==='CONSENT_UNSIGNED'),completion=cases.filter(record=>['DIRECT_DEBIT_INCOMPLETE','AGREEMENT_UNSIGNED'].includes(record.ruleId));
  const queueRows=cases.slice(0,60).map(record=>`<article class="follow-up-work-row ${record.due?'is-due':''}"><div class="follow-up-work-customer"><strong>${esc(record.customer||record.recordId)}</strong><span>${esc(record.recordId)} · ${record.recordType==='LEAD'?'Sales enquiry':'Application'}${record.product?` · ${esc(record.product)}`:''}</span></div><div><span class="follow-up-work-label">Stage</span><strong>${esc(record.ruleLabel)}</strong><small>${esc(record.followUpPauseReason||pretty(record.followUpStatus||'ACTIVE'))}</small></div><div><span class="follow-up-work-label">Next action</span><strong>${record.nextFollowUp?esc(when(record.nextFollowUp)):'Not scheduled'}</strong></div><div><span class="follow-up-work-label">Attempts</span><strong>${esc(record.followUpAttempts||0)} / 3</strong></div><div class="follow-up-work-actions"><button class="row-action secondary" ${record.recordType==='LEAD'?`data-lead="${esc(record.recordId)}"`:`data-app="${esc(record.recordId)}"`}>Open</button><button class="row-action" data-followup-now="${esc(record.recordId)}">Queue now</button><button class="row-action secondary" data-followup-schedule="${esc(record.recordId)}">Schedule</button><button class="row-action secondary" data-followup-stop="${esc(record.recordId)}">Stop</button></div></article>`).join('');
  const historyRows=operations.history.slice(0,12).map(message=>`<article class="follow-up-history-row"><div><strong>${esc(message.customer)}</strong><span>${esc(pretty(message.followUpRule||'Automatic follow-up'))} · Attempt ${esc(message.followUpAttempt||message.attemptCount||1)}</span><small>${esc(when(message.time))}${message.templateName?` · ${esc(message.templateName)}`:''}</small></div>${pill(message.status||'Queued',['SENT','QUEUED','DELIVERED','READ','MANUAL_SENT'].includes(followUpUpper(message.status)))}</article>`).join('');
  app.insertAdjacentHTML('beforeend',`<section class="follow-up-daily-summary"><div class="follow-up-runtime-bar"><div><span>Automation</span><strong>${esc(global.enabled===false?'Paused':'Active')}</strong><small>Customer replies reset the follow-up cycle</small></div><div><span>Next scheduled check</span><strong>${esc(when(snapshot.nextCheck))}</strong><small>Automatic check every 15 minutes</small></div><div><span>Visible scope</span><strong>${esc(state.user?.role==='STAFF'?'Assigned cases':'Permitted cases')}</strong><small>Customer and branch access rules are enforced</small></div></div><div class="follow-up-ops-grid">${metric('Due now',due.length,'Handle these first')}${metric('Sales enquiries',sales.length,'Asked or quoted but not yet applied')}${metric('Documents',documents.length,'Not started, partial or additional')}${metric('Information incomplete',information.length,'Application form still incomplete')}${metric('Consent unsigned',consent.length,'Signature can be collected immediately')}${metric('Completion steps',completion.length,'Direct Debit or agreement incomplete')}${metric('Delivery issues',snapshot.issues,'Needs attention')}</div><div class="follow-up-outcome-grid">${metric('Messages',outcomes.messages,'Automated follow-ups')}${metric('Replies',outcomes.replies,'Customer replied after reminder')}${metric('Applications',outcomes.converted,'Followed-up leads converted')}${metric('Progressed',outcomes.progressed,'Documents or consent received')}${metric('Delivered',outcomes.delivered,'Meta delivery confirmed')}${metric('Read',outcomes.read,'Meta read confirmed')}</div></section><section class="panel follow-up-work-queue"><div class="panel-head"><div><span class="eyebrow">TODAY'S WORK</span><h3>Customer follow-up queue</h3><p>Includes quiet enquiries, unanswered quotations and incomplete applications. Open, queue, schedule or stop a customer from this page.</p></div>${pill(`${cases.length} cases`,cases.length===0)}</div><div class="follow-up-work-list">${queueRows||'<div class="follow-up-empty"><strong>No customer requires follow-up</strong><span>New enquiries and incomplete applications will appear here automatically.</span></div>'}</div></section><section class="panel follow-up-work-history"><div class="panel-head"><div><span class="eyebrow">RECENT DELIVERY</span><h3>Follow-up history</h3><p>Recent automated reminders in your permitted customer scope.</p></div>${pill(`${operations.history.length} messages`,true)}</div><div class="follow-up-history-list">${historyRows||'<div class="follow-up-empty"><strong>No automated messages yet</strong><span>The first completed follow-up will appear here.</span></div>'}</div><button type="button" class="secondary console-footer-action" data-open-view="outbox">Open sent messages</button></section>`);
}

function followup(){
  const admin=state.user?.role==='ADMIN';
  app.innerHTML=head('Follow-up','Daily customer recovery, document collection and reminder delivery in one operational workspace.')+`<div class="hub-section-intro follow-up-workspace-intro"><div><span class="eyebrow">FOLLOW-UP WORKSPACE</span><h2>Continue every unfinished customer</h2><p>See what is due, why a case is waiting and what to do next. Staff work here every day; Management remains reserved for company administration.</p></div>${admin?'<button class="secondary" data-open-view="settings">Open system settings</button>':''}</div>`;
  if(admin&&loadedResources.has('followUpSettings'))followUpControlCentreManager();else followUpTeamWorkspace();
  bindHubNavigation();
}

function followUpControlCentreManager(){
  const rules=state.data.followUpSettings||[];if(!rules.length)return;
  const global=rules[0]||{},snapshot=followUpOperationalSnapshot(rules),operations=followUpControlData(global,snapshot),outcomes=followUpOutcomeSnapshot(),activeDays=new Set((Array.isArray(global.activeDays)?global.activeDays:String(global.activeDays||'1,2,3,4,5,6').split(',')).map(Number));
  const days=[['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6],['Sun',0]].map(([label,value])=>`<label class="channel-check"><input type="checkbox" data-followup-day="${value}" ${activeDays.has(value)?'checked':''}> ${label}</label>`).join('');
  const cards=rules.map(rule=>{const stats=snapshot.byRule[rule.id]||{waiting:0,due:0,issues:0},template=followUpTemplateFor(rule),templateLabel=!rule.templateName?'Missing':template?.status||'Verify in Meta';return`<article class="follow-up-rule-card" data-followup-rule="${esc(rule.id)}"><header><div><span class="eyebrow">${esc(rule.id)}</span><h4>${esc(rule.label)}</h4></div><label class="rule-toggle"><input data-rule-field="enabled" type="checkbox" ${rule.enabled?'checked':''}> On</label></header><div class="follow-up-rule-stats"><span><strong>${stats.waiting}</strong> waiting</span><span><strong>${stats.due}</strong> due now</span><span class="${stats.issues?'has-issue':''}"><strong>${stats.issues}</strong> issues</span></div><div class="follow-up-schedule-grid"><label>1st follow-up<small>Hours after latest reply</small><input data-rule-field="first" type="number" min="0.25" max="720" step="0.25" value="${esc(rule.delays?.[0]??3)}"></label><label>2nd follow-up<small>Hours after first</small><input data-rule-field="second" type="number" min="0.25" max="720" step="0.25" value="${esc(rule.delays?.[1]??24)}"></label><label>3rd follow-up<small>Hours after second</small><input data-rule-field="third" type="number" min="0.25" max="720" step="0.25" value="${esc(rule.delays?.[2]??48)}"></label><label>Maximum attempts<small>Then hand over to Staff</small><input data-rule-field="max" type="number" min="1" max="3" step="1" value="${esc(rule.maxAttempts||3)}"></label></div><div class="follow-up-template-row"><label>Approved Meta template<input data-rule-field="template" value="${esc(rule.templateName||'')}" placeholder="Approved Meta template"></label><label>Language<select data-rule-field="language"><option value="ms">Bahasa Malaysia</option><option value="en_US">English</option></select></label><div class="template-actions">${pill(templateLabel,!!template)}<button type="button" class="row-action secondary" data-preview-followup="${esc(rule.id)}">Preview</button><button type="button" class="row-action" data-test-followup="${esc(rule.id)}" ${template?'':'disabled'}>Test</button></div></div></article>`}).join('');
  const exceptionRows=operations.exceptions.slice(0,8).map(record=>{const status=followUpUpper(record.followUpStatus),canResume=!['HANDED_OVER','STOPPED'].includes(status),recordId=record.recordId||record.id;return`<article class="follow-up-exception-row"><div><strong>${esc(record.customer||record.name||recordId)}</strong><span>${esc(recordId)} · ${esc(record.recordType==='LEAD'?'Sales enquiry':pretty(status||'Attention'))}</span><small>${esc(record.followUpPauseReason||record.handoverReason||'Follow-up needs review')}</small></div><div class="exception-row-meta"><span>${record.followUpAttempts||0} attempts</span><button type="button" class="row-action secondary" ${record.recordType==='LEAD'?`data-lead="${esc(recordId)}"`:`data-app="${esc(recordId)}"`}>Open</button>${canResume?`<button type="button" class="row-action" data-followup-resume="${esc(recordId)}">Resume</button>`:''}</div></article>`}).join('');
  const historyRows=operations.history.slice(0,12).map(message=>`<article class="follow-up-history-row"><div><strong>${esc(message.customer)}</strong><span>${esc(pretty(message.followUpRule||'Automatic follow-up'))} · Attempt ${esc(message.followUpAttempt||message.attemptCount||1)}</span><small>${esc(when(message.time))}${message.templateName?` · ${esc(message.templateName)}`:''}</small></div>${pill(message.status||'Queued',['SENT','QUEUED','DELIVERED','READ','MANUAL_SENT'].includes(followUpUpper(message.status)))}</article>`).join('');
  const templateHealth=rules.map(rule=>{const template=followUpTemplateFor(rule);return`<article><div><strong>${esc(rule.label)}</strong><small>${esc(rule.templateName||'No template configured')}</small></div>${pill(template?.status||'Needs verification',!!template)}</article>`}).join('');
  const activeTemplates=rules.filter(rule=>followUpTemplateFor(rule)).length;
  const panel=`<section class="panel follow-up-settings-panel"><div class="panel-head"><div><span class="eyebrow">AUTOMATIC FOLLOW-UP</span><h3>Customer follow-up control</h3><p>Monitor the scheduler, resolve blocked cases, review delivery history and control every follow-up stage from one place.</p></div><div class="follow-up-head-actions">${pill(global.enabled?'Automation on':'Automation paused',global.enabled)}<button type="button" class="secondary" data-followup-scan>Run safe scan</button><button type="button" class="${global.enabled?'danger':'secondary'}" data-followup-global-toggle>${global.enabled?'Pause all':'Resume all'}</button></div></div><div class="follow-up-runtime-bar"><div><span>Scheduler health</span><strong>${esc(operations.schedulerStatus)}</strong><small>${operations.lastRun?`Last observed ${esc(when(operations.lastRun))}`:'No completed run recorded yet'}</small></div><div><span>Next scheduled check</span><strong>${esc(when(snapshot.nextCheck))}</strong><small>Vercel runs every 15 minutes</small></div><div><span>Template health</span><strong>${activeTemplates} / ${rules.length} ready</strong><small>CRM registry verified 26 Aug 2026</small></div></div><div class="follow-up-ops-grid">${metric('Waiting customers',snapshot.active,'Across five stages')}${metric('Due now',snapshot.due,'Ready for the next scheduler run')}${metric('Delivery issues',snapshot.issues,'Template, number or delivery failures')}${metric('Handed to Staff',snapshot.handedOver,'Maximum attempts reached')}${metric('Last automated send',snapshot.lastSent?when(snapshot.lastSent):'None yet','Recorded on current cases')}${metric('History',operations.history.length,'Recent automated messages loaded')}</div><div class="follow-up-policy-strip"><strong>Current policy</strong><span>Customer reply → reset attempts</span><span>Human takeover → pause automation</span><span>Maximum attempts → round-robin Staff handover</span></div><form id="followUpSettingsForm"><div class="crm-form follow-up-global-form"><label class="channel-check form-wide"><input name="automationEnabled" type="checkbox" ${global.enabled?'checked':''}> Enable automatic follow-up</label><label>Business hours start<input name="businessStart" type="time" value="${esc(global.businessStart||'09:00')}" required></label><label>Business hours end<input name="businessEnd" type="time" value="${esc(global.businessEnd||'17:30')}" required></label><label>Maximum customers per run<input name="maxPerRun" type="number" min="1" max="100" value="${esc(global.maxPerRun||20)}"></label><label>Timezone<input name="timezone" value="${esc(global.timezone||'Asia/Kuala_Lumpur')}" readonly></label><div class="form-wide"><strong>Sending days</strong><div class="row-actions">${days}</div></div><div class="form-wide follow-up-handover-summary"><div><strong>Exception handover</strong><small>After the maximum attempts, AI pauses and the case enters the Staff exception workflow.</small></div><span>Route: eligible Staff round-robin</span><button type="button" class="secondary" data-open-view="management">Open team routing</button></div></div><div class="follow-up-rule-list">${cards}</div><div class="form-actions follow-up-save-bar"><button type="submit">Save follow-up rules</button><span class="notice" id="followUpSettingsMessage">${global.updatedAt?`Last saved ${esc(when(global.updatedAt))} by ${esc(global.updatedBy||'Administrator')}.`:'Save changes before the next scheduler run.'} Messages outside 24 hours use the approved Meta template.</span></div></form><div class="follow-up-console-grid"><section class="follow-up-console"><header><div><span class="eyebrow">LIVE OPERATIONS</span><h4>Exception queue</h4></div>${pill(`${operations.exceptions.length} cases`,operations.exceptions.length===0)}</header><div class="follow-up-exception-list">${exceptionRows||'<div class="follow-up-empty"><strong>No follow-up exceptions</strong><span>Blocked and handed-over cases will appear here.</span></div>'}</div><button type="button" class="secondary console-footer-action" data-open-view="workbench">Open full Workbench</button></section><section class="follow-up-console"><header><div><span class="eyebrow">AUDIT TRAIL</span><h4>Follow-up history</h4></div>${pill(`${operations.history.length} messages`,true)}</header><div class="follow-up-history-list">${historyRows||'<div class="follow-up-empty"><strong>No automated messages yet</strong><span>The first completed follow-up will appear here.</span></div>'}</div><button type="button" class="secondary console-footer-action" data-open-view="activity">Open Activity &amp; Audit</button></section></div><section class="follow-up-template-health"><header><div><span class="eyebrow">META SAFETY</span><h4>Template health</h4></div>${pill(`${activeTemplates} / ${rules.length} Active`,activeTemplates===rules.length)}</header><div>${templateHealth}</div><p>Template status is checked against the approved CRM registry. Any unrecognised name is blocked from controlled testing until verified in Meta.</p></section></section>`;
  const integrationPanel=app.querySelector('.integration-readiness-panel');if(integrationPanel)integrationPanel.insertAdjacentHTML('afterend',panel);else app.insertAdjacentHTML('beforeend',panel);
  document.querySelector('.follow-up-settings-panel .follow-up-runtime-bar')?.insertAdjacentHTML('afterend',`<div class="follow-up-outcome-grid">${metric('Messages',outcomes.messages,'Automated follow-ups')}${metric('Replies',outcomes.replies,'Customer replied after reminder')}${metric('Applications',outcomes.converted,'Followed-up leads converted')}${metric('Progressed',outcomes.progressed,'Documents or consent received')}${metric('Delivered',outcomes.delivered,'Meta delivery confirmed')}${metric('Read',outcomes.read,'Meta read confirmed')}</div>`);
  rules.forEach(rule=>{const row=document.querySelector(`[data-followup-rule="${rule.id}"]`),language=row?.querySelector('[data-rule-field="language"]');if(language)language.value=rule.language||'ms'});
  const draftFor=id=>{const row=document.querySelector(`[data-followup-rule="${id}"]`),base=rules.find(rule=>rule.id===id)||{};return{...base,templateName:row?.querySelector('[data-rule-field="template"]')?.value||'',language:row?.querySelector('[data-rule-field="language"]')?.value||'ms'}};
  document.querySelectorAll('[data-preview-followup]').forEach(button=>button.onclick=()=>openFollowUpTemplatePreview(draftFor(button.dataset.previewFollowup)));
  document.querySelectorAll('[data-test-followup]').forEach(button=>button.onclick=()=>openFollowUpTemplateTest(draftFor(button.dataset.testFollowup)));
  document.querySelectorAll('[data-followup-resume]').forEach(button=>button.onclick=()=>controlApplicationFollowUp(button.dataset.followupResume,'RESUME').catch(error=>alert(error.message)));
  document.querySelector('[data-followup-scan]').onclick=event=>openFollowUpSafeScan(event.currentTarget);
  const form=document.getElementById('followUpSettingsForm'),message=document.getElementById('followUpSettingsMessage');
  document.querySelector('[data-followup-global-toggle]').onclick=()=>{const next=!global.enabled;if(!confirm(`${next?'Resume':'Pause'} automatic follow-up for every customer?`))return;form.automationEnabled.checked=next;form.requestSubmit()};
  form.addEventListener('input',()=>{message.textContent='Unsaved changes. Save them before leaving this page.';message.classList.add('unsaved')});
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{const active=[...form.querySelectorAll('[data-followup-day]:checked')].map(input=>Number(input.dataset.followupDay));if(!active.length)throw new Error('Choose at least one sending day');const ruleValues=[...form.querySelectorAll('[data-followup-rule]')].map(row=>({id:row.dataset.followupRule,label:row.querySelector('h4').textContent,enabled:row.querySelector('[data-rule-field="enabled"]').checked,delays:['first','second','third'].map(field=>Number(row.querySelector(`[data-rule-field="${field}"]`).value)),maxAttempts:Number(row.querySelector('[data-rule-field="max"]').value),templateName:row.querySelector('[data-rule-field="template"]').value,language:row.querySelector('[data-rule-field="language"]').value}));const saved=await post('saveFollowUpSettings',{global:{enabled:form.automationEnabled.checked,businessStart:form.businessStart.value,businessEnd:form.businessEnd.value,activeDays:active,timezone:form.timezone.value,utcOffsetMinutes:480,maxPerRun:Number(form.maxPerRun.value),replyResetsAttempts:true,pauseOnHumanTakeover:true},rules:ruleValues});state.data.followUpSettings=saved.records||[];loadedResources.add('followUpSettings');followup()}catch(error){message.textContent=error.message;button.disabled=false}};
}

function settings(){
  settingsLegacy();
  const knowledge=state.knowledge;if(knowledge){const warnings=knowledge.warnings||[],panel=`<section class="panel knowledge-health-panel"><div class="panel-head"><div><span class="eyebrow">AI KNOWLEDGE</span><h3>Runtime knowledge health</h3><p>This is the exact approved knowledge snapshot loaded by the deployed CRM build—not a claim that live Notion was read during this session.</p></div>${pill(warnings.length?'Warning':'Loaded',warnings.length===0)}</div><div class="metric-grid compact-metrics">${metric('Version',knowledge.version||'Unknown','Runtime snapshot')}${metric('Approved pages',knowledge.approvedPageCount||0,'Included at build time')}${metric('Compiled',when(knowledge.compiledAt),'Last successful sync')}${metric('Source',pretty(knowledge.sourceType||'Unknown'),'Approved pages only')}</div>${warnings.length?`<div class="refresh-error-banner" role="alert"><div><strong>Knowledge sync warning</strong><span>${esc(warnings.join(' · '))}</span></div></div>`:'<div class="security-banner"><div><strong>Knowledge snapshot loaded</strong><p>Prices, stock, colours, storage, images and promotions still come from the live approved catalog—not Notion.</p></div></div>'}</section>`;const integrationPanel=app.querySelector('.integration-readiness-panel');if(integrationPanel)integrationPanel.insertAdjacentHTML('beforebegin',panel);else app.insertAdjacentHTML('beforeend',panel)}
  if(state.user?.role==='ADMIN'&&loadedResources.has('channels'))whatsappChannelManager();
}

function channelReportSource(){
  return{leads:state.data.leads.filter(record=>!isDemoRecord(record)),applications:state.data.applications.filter(record=>!isDemoRecord(record)),documents:state.data.documents.filter(record=>!isDemoRecord(record)),inbox:state.data.inbox.filter(record=>!isDemoRecord(record)),outbox:state.data.outbox.filter(record=>!isDemoRecord(record)),activity:state.data.activity.filter(record=>!isDemoRecord(record))};
}

function appendWhatsAppChannelReport(source){
  if(state.user?.role!=='ADMIN'||!loadedResources.has('channels'))return;
  const region=state.reportRegion||'ALL',selected=state.reportChannel||'ALL';
  const availableChannels=(state.data.channels||[]).filter(reportOperationalChannel);
  const channels=availableChannels.filter(channel=>(region==='ALL'||channel.region===region)&&(selected==='ALL'||channel.id===selected));
  const leadChannel=lead=>lead.primaryChannelId||lead.channelId;
  const rows=channels.map(channel=>{
    const leads=source.leads.filter(lead=>leadChannel(lead)===channel.id),leadIds=new Set(leads.map(lead=>lead.id)),applications=source.applications.filter(item=>leadIds.has(item.leadId));
    const inbox=source.inbox.filter(message=>message.channelId===channel.id),outbox=source.outbox.filter(message=>message.channelId===channel.id),delivered=outbox.filter(message=>message.deliveredAt||['DELIVERED','READ'].includes(String(message.status).toUpperCase())),read=outbox.filter(message=>message.readAt||String(message.status).toUpperCase()==='READ'),failed=outbox.filter(message=>['FAILED','ERROR'].includes(String(message.status).toUpperCase())),handovers=inbox.filter(message=>message.humanRequired);
    return[channel.name||channel.id,pretty(channel.region),pretty(channel.businessUnit||'UNASSIGNED'),channel.teamId||'No team',channel.displayNumber||'Pending',channel.active?'Active':'Reserved',leads.length,inbox.length,outbox.length,reportPercent(delivered.length,outbox.length),reportPercent(read.length,delivered.length),failed.length,handovers.length,applications.length,reportPercent(applications.length,leads.length)];
  });
  const toolbar=app.querySelector('.report-toolbar'),spacer=toolbar?.querySelector('.toolbar-spacer');
  if(spacer&&!document.getElementById('reportChannel')){
    const options=availableChannels.filter(channel=>region==='ALL'||channel.region===region).map(channel=>reportOption(channel.id,`${channel.name||channel.id}${channel.displayNumber?' · '+channel.displayNumber:''}`,selected)).join('');
    spacer.insertAdjacentHTML('beforebegin',`<label>WhatsApp number<select id="reportChannel">${reportOption('ALL','All official numbers',selected)}${options}</select></label>`);
    document.getElementById('reportChannel').onchange=event=>{state.reportChannel=event.target.value;reports()};
    const regionSelect=document.getElementById('reportRegion'),original=regionSelect?.onchange;if(regionSelect&&original)regionSelect.onchange=event=>{const next=event.target.value,current=(state.data.channels||[]).find(channel=>channel.id===state.reportChannel);if(current&&next!=='ALL'&&current.region!==next)state.reportChannel='ALL';original(event)};
  }
  const grid=app.querySelector('.admin-report-grid');if(grid)grid.insertAdjacentHTML('afterbegin',`<section class="report-card wide whatsapp-number-report"><div class="panel-head"><div><h3>WhatsApp number performance</h3><p>Every result stays separated by region, business unit, team and the exact official number.</p></div></div>${adminReportTable(['Official channel','Region','Business','Team','Number','Status','Leads','Inbound','Outbound','Delivery rate','Read rate','Failed','Handovers','Applications','Lead conversion'],rows)}</section>`);
}

function reportCategoryFor(card){
  const title=String(card.querySelector('h3')?.textContent||card.textContent||'').toLowerCase();
  if(/whatsapp|integration|audit|channel|system|catalog, pricing and access/.test(title))return'SYSTEM';
  if(/regional performance|branch performance|staff workload|accounts by role|team/.test(title))return'TEAM';
  if(/motorcycle|product application|2nd hand|handphone|inventory|catalog|pricing|promotion/.test(title))return'PRODUCTS';
  if(/customer-to-completion|lead and application trend|executive/.test(title))return'EXECUTIVE';
  if(/lead trend|lead sources|conversion|sales/.test(title))return'SALES';
  if(/document|ageing|stage|loan application status|eligibility|cad|rejection|lms|inbox|outbox|follow-up|exception/.test(title))return'OPERATIONS';
  return'EXECUTIVE';
}
function reportMetricCategoryFor(metricCard){const label=String(metricCard.querySelector('span')?.textContent||metricCard.textContent||'').toLowerCase();if(/new motor|2nd hand|handphone|phone catalog|phone pricing|stock|pending approval|rejected submissions/.test(label))return'PRODUCTS';if(/quoted|instalment|promotion/.test(label))return'SALES';if(/failed message/.test(label))return'SYSTEM';if(/files|document|exception|handover|unassigned|overdue|stalled/.test(label))return'OPERATIONS';return'EXECUTIVE'}
function organizeReports(){
  const cards=[...app.querySelectorAll('.report-card')];if(!cards.length)return;
  cards.forEach(card=>{card.dataset.reportCategory=reportCategoryFor(card)});
  const metricCards=[...app.children].filter(element=>element.classList.contains('metric-grid')).flatMap(grid=>[...grid.children].filter(element=>element.classList.contains('metric-card')));metricCards.forEach(card=>{card.dataset.reportCategory=reportMetricCategoryFor(card)});
  const categories=[['EXECUTIVE','Executive'],['SALES','Sales'],['OPERATIONS','Operations'],['PRODUCTS','Products'],['TEAM','Team'],['SYSTEM','System'],['ALL','All reports']],active=state.reportCategory||'EXECUTIVE';
  const tabs=document.createElement('div');tabs.className='report-category-tabs';tabs.setAttribute('aria-label','Report categories');tabs.innerHTML=categories.map(([key,label])=>`<button class="${active===key?'active':''}" data-report-category="${key}">${label}<span>${key==='ALL'?cards.length:cards.filter(card=>card.dataset.reportCategory===key).length}</span></button>`).join('');
  const toolbar=app.querySelector('.report-toolbar'),anchor=toolbar||app.querySelector('.status-strip');anchor?.insertAdjacentElement('afterend',tabs);
  const apply=category=>{state.reportCategory=category;[...cards,...metricCards].forEach(card=>card.classList.toggle('report-category-hidden',category!=='ALL'&&card.dataset.reportCategory!==category));tabs.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.reportCategory===category));window.scrollTo({top:0,behavior:'auto'});scheduleTableScrollDock()};
  tabs.querySelectorAll('button').forEach(button=>button.onclick=()=>apply(button.dataset.reportCategory));apply(active);
}

function reports(){
  const source=channelReportSource(),requestedChannel=state.reportChannel||'ALL',selected=requestedChannel==='ALL'||(state.data.channels||[]).some(channel=>channel.id===requestedChannel&&reportOperationalChannel(channel))?requestedChannel:'ALL';
  if(selected!==requestedChannel)state.reportChannel='ALL';
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
  organizeReports();
}

function inboxTable(rows){
      const manager=state.user?.role!=='STAFF';return `<div class="table-card"><table class="data-table"><thead><tr><th>Time</th><th>Customer</th><th>Official number</th><th>Message</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>${rows.map(item=>{const status=String(item.status).toUpperCase(),staffCanHandle=manager||!item.humanRequired||status==='ASSIGNED_TO_STAFF';return `<tr class="${item.humanRequired?'handover-row ':''}${isDemoRecord(item)?'demo-row':''}"><td>${esc(when(item.time))}</td><td>${demoLabel(item)}<strong>${esc(item.customer)}</strong><small>${esc(item.phone)}</small></td><td><strong>${esc(whatsappChannelLabel(item))}</strong><small>${esc(item.routingStatus||'Bound automatically')}</small></td><td>${esc(customerMessagePreview(item,'Message content not recorded'))}</td><td>${pill(item.status,!item.humanRequired)}</td><td>${esc(item.assignedSa||'Manager queue')}</td><td><div class="row-actions">${isDemoRecord(item)?demoOpenButton(item,'Customer 360 demo'):`<button class="row-action secondary" data-customer-profile data-lead-id="${esc(item.leadId||'')}" data-application-id="${esc(item.applicationId||'')}" data-phone="${esc(item.phone||'')}">Customer 360</button>${staffCanHandle?`<button class="row-action whatsapp-action" data-inbox-reply="${esc(item.id)}">Reply from same number</button>`:'<span class="pill">Waiting for Manager</span>'}${manager&&status==='HUMAN_HANDOVER_REQUIRED'?`<button class="row-action" data-take-handover="${esc(item.id)}">Manager take over</button><button class="row-action secondary" data-assign-handover="${esc(item.id)}">Assign staff</button>`:''}${status!=='RESOLVED'&&(manager||status==='ASSIGNED_TO_STAFF')?`<button class="row-action secondary" data-resolve-handover="${esc(item.id)}">Resolve</button>`:''}`}</div></td></tr>`}).join('')||empty(7)}</tbody></table></div>`;
}

function outboxTable(rows){return `<div class="table-card"><table class="data-table"><thead><tr><th>Time</th><th>Recipient</th><th>Official number</th><th>Message / file</th><th>Lead / Application</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(item=>{const status=String(item.status||'').toUpperCase();return `<tr class="${isDemoRecord(item)?'demo-row':''}"><td>${esc(when(item.time))}</td><td>${demoLabel(item)}${esc(item.recipient)}</td><td><strong>${esc(whatsappChannelLabel(item))}</strong><small>${esc(item.routingStatus||'')}</small></td><td>${esc(item.message||item.templateName||'Attachment message')}${item.attachmentName?`<small>📎 ${esc(item.attachmentName)} · ${esc(item.attachmentMime||item.messageType)}</small>`:''}${item.errorMessage?`<small class="error-text">${esc(item.errorMessage)}</small>`:''}</td><td>${esc(item.leadId||item.applicationId)}</td><td>${pill(item.status,status!=='FAILED')}<small>${Number(item.attemptCount||0)} attempt${Number(item.attemptCount||0)===1?'':'s'}</small></td><td><div class="row-actions">${isDemoRecord(item)?demoOpenButton(item,'Customer 360 demo'):`<button class="row-action secondary" data-customer-profile data-lead-id="${esc(item.leadId||'')}" data-application-id="${esc(item.applicationId||'')}" data-phone="${esc(item.recipient||'')}">Customer 360</button>${status==='MANUAL_PENDING'?`<button class="row-action whatsapp-action" data-open-outbox="${esc(item.id)}">Open WhatsApp</button><button class="row-action" data-mark-sent="${esc(item.id)}">Mark sent</button>`:''}${status==='FAILED'?`<button class="row-action" data-retry-outbox="${esc(item.id)}">Retry once</button>`:''}${status==='SENDING'?'<span class="pill">Sending · do not resend</span>':''}`}</div></td></tr>`}).join('')||empty(7)}</tbody></table></div>`}
function outbox(){
  const renderResults=()=>{const query=String(document.getElementById('outboxSearch')?.value||'').toLowerCase(),status=document.getElementById('outboxStatus')?.value||'ALL',rows=state.data.outbox.filter(item=>(status==='ALL'||String(item.status).toUpperCase()===status)&&Object.values(item).join(' ').toLowerCase().includes(query));document.getElementById('outboxResults').innerHTML=outboxTable(rows);bindMessaging()};
  app.innerHTML=head('Message Outbox','Every reply is bound to the official WhatsApp number that received the customer conversation.')+`<div class="security-banner"><div><strong>Reliable WhatsApp delivery</strong><p>Messages are recorded before sending. Sending rows are locked against duplicates; failed rows can be retried safely from the original official number.</p></div><button data-new-message>New message</button></div><div class="smart-toolbar"><input id="outboxSearch" placeholder="Search phone, message, application or file"><label>Status<select id="outboxStatus"><option value="ALL">All statuses</option><option value="FAILED">Failed</option><option value="SENDING">Sending</option><option value="PENDING">Pending</option><option value="SENT">Sent</option><option value="MANUAL_PENDING">Manual pending</option></select></label></div><section class="panel" id="outboxResults">${outboxTable(state.data.outbox)}</section>`;document.querySelector('[data-new-message]').onclick=()=>manualWhatsApp();document.getElementById('outboxSearch').oninput=renderResults;document.getElementById('outboxStatus').onchange=renderResults;bindMessaging();
}

function manualWhatsApp(target){
  const selected=target?.id?target:null,isInbox=!!selected&&state.data.inbox.some(item=>item.id===selected.id),selectedApplication=selected&&state.data.applications.find(item=>item.id===selected.id),selectedLead=selected&&state.data.leads.find(item=>item.id===selected.id),boundLabel=whatsappChannelLabel(selected||{});
  const latestInbound=isInbox?selected:state.data.inbox.filter(item=>(selected?.leadId&&item.leadId===selected.leadId)||(selected?.applicationId&&item.applicationId===selected.applicationId)||(selected?.phone&&normalizePhone(item.phone)===normalizePhone(selected.phone))).sort((a,b)=>new Date(b.time||0)-new Date(a.time||0))[0],serviceWindowOpen=Boolean(latestInbound&&Date.now()-new Date(latestInbound.time||0).valueOf()<=86400000),templateOptions=Object.keys(FOLLOW_UP_TEMPLATE_REGISTRY).map(name=>`<option value="${esc(name)}" data-header-format="">${esc(name)} · checking Meta…</option>`).join('');
  formModal('Reply customer',`<form id="manualWhatsAppForm" class="crm-form"><label class="form-wide">Customer<select name="customer" ${selected?'disabled':''}>${selected?`<option value="${esc(selected.id)}">${esc(selected.customer||selected.name||selected.phone)}</option>`:customerOptions()}</select></label><label class="form-wide">Phone number<input name="phone" value="${esc(selected?.phone||'')}" required></label><label class="form-wide">Official reply number<input value="${esc(selected&&boundLabel!=='Unassigned channel'?boundLabel:'CRM will use the customer’s latest bound channel')}" readonly></label><div class="form-wide channel-binding-notice"><strong>${serviceWindowOpen?'24-hour reply window is open':'24-hour reply window is closed or not yet known'}</strong><span>${serviceWindowOpen?'Normal text, image and PDF replies are allowed.':'Cloud sending requires an approved Meta template until the customer replies again.'}</span></div><label>Reply type<select name="messageType"><option value="TEXT">Normal reply</option><option value="TEMPLATE">Approved Meta template</option></select></label><label>Template language<select name="language"><option value="ms">Bahasa Malaysia</option><option value="en_US">English (US)</option></select></label><label class="form-wide template-field" hidden>Approved template<select name="templateName"><option value="">Select approved template</option>${templateOptions}</select><small class="template-help">Reading approved templates from the customer’s official Meta account…</small></label><div class="form-wide template-message-preview" hidden><span>Exact approved WhatsApp message</span><strong data-template-name>Select a template</strong><p data-template-body>The customer will receive the fixed message approved by Meta.</p><small data-template-footer></small></div><label class="form-wide message-field">Message / caption<textarea name="message" rows="6" placeholder="Type the customer reply here"></textarea></label><label class="form-wide attachment-field">Attach image or PDF<input name="attachment" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"><small>Optional · PDF, JPG, PNG or WebP · maximum 3 MB</small></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Open WhatsApp Business</button></div><p class="form-wide notice" id="formMessage">The reply is recorded before it is sent. Failed messages remain visible and can be retried once without switching the customer’s official number.</p></form>`);
  const form=document.getElementById('manualWhatsAppForm'),templateField=form.querySelector('.template-field'),templateHelp=templateField.querySelector('.template-help'),templatePreview=form.querySelector('.template-message-preview'),messageField=form.querySelector('.message-field'),attachmentField=form.querySelector('.attachment-field'),attachmentHelp=attachmentField.querySelector('small');
  const mediaTemplateOptions=()=>[...form.templateName.options].filter(option=>['IMAGE','DOCUMENT'].includes(String(option.dataset.headerFormat||'').toUpperCase()));
  const syncReplyComposer=()=>{
    const template=form.messageType.value==='TEMPLATE',cloud=state.user?.whatsappMode==='CLOUD',option=form.templateName.selectedOptions[0],headerFormat=String(option?.dataset.headerFormat||'').toUpperCase(),mediaTemplate=template&&['IMAGE','DOCUMENT'].includes(headerFormat),mediaAvailable=mediaTemplateOptions().length>0,file=form.attachment.files?.[0];
    templateField.hidden=!template;templatePreview.hidden=!template;messageField.hidden=template;form.message.disabled=template;form.templateName.required=template;templatePreview.querySelector('[data-template-name]').textContent=option?.value||'Select a template';templatePreview.querySelector('[data-template-body]').textContent=option?.dataset.body||'Choose an approved template to see the exact message the customer will receive.';templatePreview.querySelector('[data-template-footer]').textContent=option?.dataset.footer||'';
    attachmentField.hidden=false;form.attachment.disabled=!cloud;form.attachment.accept=headerFormat==='IMAGE'?'image/jpeg,image/png,image/webp':headerFormat==='DOCUMENT'?'application/pdf':'application/pdf,image/jpeg,image/png,image/webp';attachmentField.setAttribute('aria-disabled',String(!cloud));
    attachmentHelp.textContent=!cloud?'Attachment sending requires WhatsApp Cloud mode.':mediaTemplate?`This approved ${headerFormat.toLowerCase()} template requires one matching file · maximum 3 MB`:file&&template&&!mediaAvailable?'File selected. Choose a customer and CRM will load the matching approved media template.':template?'Choose a PDF or image first; CRM will select the matching approved media template automatically.':'Optional · PDF, JPG, PNG or WebP · maximum 3 MB';
  };
  const matchTemplateToAttachment=()=>{const file=form.attachment.files?.[0];if(!file||form.messageType.value!=='TEMPLATE')return true;const requiredHeader=String(file.type||'').startsWith('image/')?'IMAGE':'DOCUMENT',selectedHeader=String(form.templateName.selectedOptions[0]?.dataset.headerFormat||'').toUpperCase();if(selectedHeader===requiredHeader)return true;const match=[...form.templateName.options].find(option=>String(option.dataset.headerFormat||'').toUpperCase()===requiredHeader);if(!match)return false;form.templateName.value=match.value;if(match.dataset.language)form.language.value=match.dataset.language;return true};
  if(state.user?.whatsappMode==='CLOUD')form.querySelector('[type=submit]').textContent='Send from same official number';form.messageType.onchange=()=>{matchTemplateToAttachment();syncReplyComposer()};form.templateName.onchange=()=>{const option=form.templateName.selectedOptions[0];if(option?.dataset.language)form.language.value=option.dataset.language;matchTemplateToAttachment();syncReplyComposer()};form.attachment.onchange=()=>{if(!matchTemplateToAttachment()&&mediaTemplateOptions().length)document.getElementById('formMessage').textContent='No matching approved image or document template is available for this official number.';else document.getElementById('formMessage').textContent='File ready. CRM will send it using the matching approved media template.';syncReplyComposer()};
  const loadApprovedTemplates=async item=>{if(state.user?.whatsappMode!=='CLOUD')return;templateHelp.textContent='Reading approved templates from the customer’s official Meta account…';try{const result=await post('getWhatsAppTemplates',{leadId:item?.leadId||selectedLead?.id||selectedApplication?.leadId||'',applicationId:item?.applicationId||selectedApplication?.id||'',phone:item?.phone||form.phone.value,channelId:item?.channelId||'',replyToMessageId:isInbox?selected.id:''}),templates=Array.isArray(result.templates)?result.templates:[],mediaCount=templates.filter(template=>['IMAGE','DOCUMENT'].includes(String(template.headerFormat).toUpperCase())).length;form.templateName.innerHTML='<option value="">Select approved template</option>'+templates.map(template=>`<option value="${esc(template.name)}" data-language="${esc(template.language)}" data-header-format="${esc(template.headerFormat)}" data-body="${esc(template.body||'')}" data-footer="${esc(template.footer||'')}">${esc(template.name)} · ${esc(template.language)}${template.headerFormat?` · ${esc(pretty(template.headerFormat))} header`:''}</option>`).join('');templateHelp.textContent=templates.length?`${templates.length} approved template${templates.length===1?'':'s'} loaded from Meta · ${mediaCount} can carry an image or PDF.`:'No approved templates were returned by this official Meta account.';if(!matchTemplateToAttachment()&&form.attachment.files?.[0])document.getElementById('formMessage').textContent='No approved Image-header or Document-header template matches the selected file for this official number.';syncReplyComposer()}catch(error){form.templateName.innerHTML='<option value="">Meta template lookup unavailable</option>';templateHelp.textContent=error.message;syncReplyComposer()}};
  const applyTarget=()=>{const item=selected||customerTarget(form.customer.value);if(!item)return;form.phone.value=item.phone||'';const inbound=isInbox?selected:state.data.inbox.filter(message=>(item.leadId&&message.leadId===item.leadId)||(item.applicationId&&message.applicationId===item.applicationId)||normalizePhone(message.phone)===normalizePhone(item.phone)).sort((a,b)=>new Date(b.time||0)-new Date(a.time||0))[0],open=Boolean(inbound&&Date.now()-new Date(inbound.time||0).valueOf()<=86400000),notice=form.querySelector('.channel-binding-notice');form.dataset.serviceWindowOpen=String(open);notice.querySelector('strong').textContent=open?'24-hour reply window is open':'24-hour reply window is closed or not yet known';notice.querySelector('span').textContent=open?'Normal text, image and PDF replies are allowed.':'Meta only permits an approved template now. A media-header template can send the image/PDF immediately; a text template requires the customer to reply first.';if(state.user?.whatsappMode==='CLOUD')form.messageType.value=open?'TEXT':'TEMPLATE';form.messageType.onchange();loadApprovedTemplates(item)};if(!selected)form.customer.onchange=applyTarget;applyTarget();form.querySelector('[data-cancel]').onclick=()=>document.querySelector('.drawer-backdrop').remove();
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),message=document.getElementById('formMessage'),item=selected||customerTarget(form.customer.value),manualWindow=state.user?.whatsappMode==='MANUAL'?window.open('about:blank','_blank'):null;const leadId=item?.leadId||selectedLead?.id||selectedApplication?.leadId||'',applicationId=item?.applicationId||selectedApplication?.id||'',file=form.attachment.files?.[0],templateMode=form.messageType.value==='TEMPLATE',selectedTemplate=form.templateName.selectedOptions[0],headerFormat=String(selectedTemplate?.dataset.headerFormat||'').toUpperCase(),requiredHeader=file?(String(file.type||'').startsWith('image/')?'IMAGE':'DOCUMENT'):'';button.disabled=true;try{if(!form.message.value.trim()&&!file&&!templateMode)throw new Error('Type a message or choose an image/PDF.');if(file&&state.user?.whatsappMode!=='CLOUD')throw new Error('File sending is available after WhatsApp Cloud mode is connected.');if(templateMode&&!form.templateName.value)throw new Error('Choose an approved Meta template.');if(file&&templateMode&&headerFormat!==requiredHeader)throw new Error(`Choose an approved ${requiredHeader.toLowerCase()} template for this file.`);if(templateMode&&['IMAGE','DOCUMENT'].includes(headerFormat)&&!file)throw new Error(`This approved ${headerFormat.toLowerCase()} template requires a matching file.`);let attachment=null;if(file){validateBrowserFile(file);if(['image/heic','image/heif'].includes(String(file.type).toLowerCase()))throw new Error('WhatsApp replies support PDF, JPG, PNG or WebP files.');attachment={name:file.name,type:file.type,data:await fileData(file)}}const outboundMessage=templateMode?(selectedTemplate?.dataset.body||''):form.message.value,saved=await post('sendCustomerMessage',{leadId,applicationId,phone:form.phone.value,message:outboundMessage,messageType:form.messageType.value,templateName:form.templateName.value,language:form.language.value,attachment,channelId:item?.channelId||'',replyToMessageId:isInbox?selected.id:''});if(saved.mode==='MANUAL'&&saved.whatsappUrl){if(manualWindow)manualWindow.location=saved.whatsappUrl;else window.location.href=saved.whatsappUrl}else manualWindow?.close();document.querySelector('.drawer-backdrop').remove();await refreshMessaging('outbox')}catch(error){manualWindow?.close();message.textContent=error.message;button.disabled=false}};
}

