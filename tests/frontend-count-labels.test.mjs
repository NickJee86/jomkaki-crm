import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,`Missing source ${start}`);return source.slice(from,to)};
const line=prefix=>source.split(/\r?\n/).find(value=>value.startsWith(prefix));
function workspace(){
  const applications=Array.from({length:17},()=>({id:'',status:'OPEN'})),leads=Array.from({length:6},(_,index)=>({id:`L${index}`,phone:`6011111111${index}`}));
  const inbox=leads.flatMap((lead,index)=>Array.from({length:index<4?5:1},(_,message)=>({id:`M${index}-${message}`,leadId:lead.id,phone:lead.phone,status:index<4?'UNREAD':'RESOLVED'})));
  const state={summary:{leads:6,applications:17,unreadInbox:4},user:{whatsappMode:'CLOUD'},data:{applications,leads,inbox,outbox:[]}},app={innerHTML:''},metrics=[],fields=new Map();let visibleConversations=[];
  const field=key=>{if(!fields.has(key))fields.set(key,{value:'',addEventListener(){}});return fields.get(key)};
  const context=vm.createContext({
    state,app,esc:value=>String(value??''),head:()=>'',pill:()=>'',metric:(label,value,description)=>{metrics.push({label,value,description});return `<div>${label}: ${value}<small>${description}</small></div>`},
    businessApplications:()=>applications,businessLeads:()=>leads,businessDocuments:()=>[],applicationTable:rows=>`<div>${rows.length} application rows</div>`,
    document:{querySelector:field,getElementById:field},bindHubNavigation(){},bind(){},bindMessaging(){},
    crmNotifications:()=>[],pipelineColumns:[],pipelineSnapshot:()=>({counts:{}}),customerNextAction:()=>({key:'documents'}),isCompletedCase:()=>false,
    inboxTable:rows=>{visibleConversations=rows;return '<table></table>'}
  });
  vm.runInContext([
    line('const normalizePhone='),line('function dashboardLegacy(){'),
    section('const hubCard=','function pipeline(){'),section('function dashboard(){','// Client-only feature samples.'),
    section('function customerConversationKey(','function inboxTable(rows)'),section('function inbox(){','function outboxLegacyOne(){')
  ].join('\n'),context);
  return{context,metrics,applications,visible:()=>visibleConversations};
}

test('sidebar labels and explanations distinguish record totals from conversation workload',()=>{
  assert.match(html,/Customer leads <b id="leadBadge"/);
  assert.match(html,/<b id="applicationBadge">0<\/b> Application records/);
  assert.match(html,/<b id="inboxBadge">0<\/b> Conversations to handle/);
  assert.match(html,/not a count of unique people/);assert.match(html,/including records needing data repair/);assert.match(html,/Not the number of individual messages/);
  assert.doesNotMatch(html,/<b id="inboxBadge">0<\/b> unread/);
});

test('application and lead counts remain 17 and 6 while the summary labels explain four conversations',()=>{
  const {context,metrics,applications}=workspace();context.dashboardLegacy();
  for(const [label,value] of [['Application records',17],['Customer leads',6],['Conversations to handle',4]])assert.equal(metrics.find(metric=>metric.label===label).value,value);
  assert.match(metrics.find(metric=>metric.label==='Conversations to handle').description,/not individual messages/);
  context.customers();assert.match(context.app.innerHTML,/Application records/);assert.match(context.app.innerHTML,/Customer leads/);assert.match(context.app.innerHTML,/Conversations to handle/);assert.match(context.app.innerHTML,/One customer may have multiple application records/);
  metrics.length=0;context.dashboard();assert.equal(metrics.find(metric=>metric.label==='Conversations to handle').value,4);
  assert.equal(applications.length,17);assert.ok(applications.every(application=>application.id===''),'Label updates must not hide or rewrite malformed source records');
});

test('inbox distinguishes six conversations, four conversations to handle, and 22 individual messages',()=>{
  const {context,metrics,visible}=workspace();context.inbox();
  assert.equal(metrics.find(metric=>metric.label==='Conversations').value,6);
  assert.equal(metrics.find(metric=>metric.label==='Messages').value,22);
  assert.equal(visible().length,4);
  assert.equal(visible().reduce((sum,item)=>sum+item.openMessageCount,0),20,'Four conversations may contain more than four pending messages');
  assert.match(context.app.innerHTML,/>Conversations to handle<\/option>/);assert.match(context.app.innerHTML,/>All conversations<\/option>/);
  assert.doesNotMatch(context.app.innerHTML,/Open \/ unread|All customers/);
});
