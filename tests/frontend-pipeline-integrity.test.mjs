import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const section=(start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,`Missing source ${start}`);return source.slice(from,to)};
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function workspace(data={}){
  const state={summary:{},data:{applications:[],leads:[],inbox:[],outbox:[],...data},user:{role:'ADMIN'}},app={innerHTML:''};
  const context=vm.createContext({
    state,app,businessApplications:()=>state.data.applications,businessLeads:()=>state.data.leads,
    esc,pretty:String,when:String,customer360TimeValue:()=>0,head:()=>'',metric:()=>'',pill:()=>'',
    isDemoRecord:()=>false,groupCustomerConversations:rows=>rows,customerConversationKey:item=>item.phone,
    customerMessagePreview:item=>item.message,bindCustomerProfileButtons(){},document:{querySelector:()=>null},alert(){}
  });
  vm.runInContext([
    source.split(/\r?\n/).find(line=>line.startsWith('const normalizePhone=')),
    section('const operationalValue=','function customerMessagePreview('),
    section('function applicationRecordId(','function customer360IncomingStatus('),
    section('function resolveCustomer360(','function customer360Conversation('),
    section('function crmNotifications(){','function notificationCount('),
    section('function pipeline(){','function products(){'),
    section('function dashboard(){','// Client-only feature samples.')
  ].join('\n'),context);
  return context;
}

test('pipeline keeps missing-ID application cards visible but offers no unsafe Open route',()=>{
  const applications=[
    {id:'',leadId:'L1',phone:'60111111111',customer:'Missing ID'},
    {id:'  ',leadId:'L2',phone:'60222222222',customer:'Whitespace ID'},
    {id:'VALID',leadId:'L3',phone:'60333333333',customer:'Valid case'}
  ];
  const original=JSON.stringify(applications),context=workspace({applications});context.pipeline();
  const cards=context.app.innerHTML.match(/<article class="pipeline-card [\s\S]*?<\/article>/g);
  assert.equal(cards.length,3);
  for(const card of cards.slice(0,2)){
    assert.match(card,/Application ID unavailable/);assert.match(card,/Data repair required/);
    assert.match(card,/<button[^>]*disabled[^>]*>Open<\/button>/);
    assert.doesNotMatch(card,/data-(?:customer-profile|app|application-id|lead-id|phone)/);
  }
  assert.match(cards[2],/data-app="VALID"/);
  assert.equal(JSON.stringify(applications),original);
});

test('missing-ID priority records are not collapsed into one document task or made actionable',()=>{
  const applications=Array.from({length:17},(_,index)=>({id:'',leadId:`L${index}`,phone:`60111111${index}`,customer:`Case ${index}`}));
  const context=workspace({applications}),notifications=context.crmNotifications();
  assert.equal(notifications.length,17,'Keep each malformed source row visible without inventing its ID');
  for(const item of notifications){assert.equal(item.applicationRequired,true);assert.match(item.dataIntegrityError,/ID unavailable/);assert.equal(item.title,'Data repair required')}
  context.dashboard();
  const tasks=context.app.innerHTML.match(/<button class="today-task [\s\S]*?<\/button>/g);
  assert.equal(tasks.length,8);
  for(const task of tasks){assert.match(task,/disabled/);assert.match(task,/Data repair required/);assert.doesNotMatch(task,/data-(?:customer-profile|app|application-id|lead-id|phone|open-view)/)}
});

test('legitimate customer-level message tasks remain available without an application',()=>{
  const context=workspace({leads:[{id:'L1',phone:'60111111111'}],inbox:[{id:'M1',leadId:'L1',phone:'60111111111',customer:'Customer',message:'Question',needsAction:true,openMessageCount:1}]});
  context.dashboard();
  const task=context.app.innerHTML.match(/<button class="today-task [\s\S]*?<\/button>/)[0];
  assert.match(task,/data-customer-profile/);assert.match(task,/data-lead-id="L1"/);assert.doesNotMatch(task,/disabled/);
});

test('application routes in notifications require an ID and recheck the exact record at click time',()=>{
  const context=workspace({applications:[{id:'VALID',leadId:'L1'}]});
  for(const notification of [true,false]){
    const attributes=context.notificationOpenAttributes({applicationRequired:true,applicationId:' ',leadId:'L1',phone:'60111111111'},notification);
    assert.match(attributes,/disabled/);assert.doesNotMatch(attributes,/data-(?:app|customer-profile|notification-customer|lead-id|phone)/);
  }
  assert.equal(context.notificationOpenAttributes({applicationRequired:true,applicationId:'VALID',leadId:'L1'},true),'data-app="VALID"');
  let opened=0;
  const button={disabled:false,getAttribute:()=> 'VALID',setAttribute(){},closest:()=>null};
  context.bindApplicationRecordAction(button,'data-app',record=>{assert.equal(record.id,'VALID');opened++});
  button.onclick();assert.equal(opened,1);
  context.state.data.applications=[{id:'',leadId:'L1'}];button.onclick();
  assert.equal(opened,1);assert.equal(button.disabled,true);
});

test('home pipeline summary and dedicated pipeline count the same unconverted leads',()=>{
  const context=workspace({applications:[{id:'A1',leadId:'CONVERTED'}],leads:[{id:'CONVERTED'},{id:'L1'},{id:'L2'},{id:'L3'}]});
  const newCount=()=>Number(context.app.innerHTML.match(/<span>New \/ qualified<\/span><strong>(\d+)<\/strong>/)[1]);
  context.pipeline();const dedicated=newCount();context.dashboard();const home=newCount();
  assert.equal(dedicated,3);assert.equal(home,dedicated);
});

test('duplicate trimmed IDs stay separate repair records with ambiguous labels and no navigation',()=>{
  const applications=[{id:'DUP-1',leadId:'L1',phone:'60111111111',customer:'First'},{id:' DUP-1 ',leadId:'L2',phone:'60222222222',customer:'Second'}];
  const context=workspace({applications});context.pipeline();
  const cards=context.app.innerHTML.match(/<article class="pipeline-card [\s\S]*?<\/article>/g);
  assert.equal(cards.length,2);
  for(const card of cards){assert.match(card,/Application ID ambiguous/);assert.match(card,/disabled/);assert.doesNotMatch(card,/ID unavailable|data-(?:app|customer-profile|lead-id|phone)/)}
  const notifications=context.crmNotifications();
  assert.equal(notifications.length,2);assert.notEqual(notifications[0].key,notifications[1].key);
  for(const item of notifications){assert.match(item.dataIntegrityError,/ID ambiguous/);assert.match(context.notificationOpenAttributes(item,true),/disabled/)}
  context.dashboard();assert.doesNotMatch(context.app.innerHTML,/ID unavailable/);
  assert.equal(context.findApplicationById('DUP-1'),undefined);assert.equal(context.requireApplicationIdentity(applications[0]),false);
});

test('same-customer cases with distinct IDs open separately and a newly duplicated ID is rejected at click time',()=>{
  const first={id:' A1 ',leadId:'L1',phone:'60111111111'},second={id:'A2',leadId:'L1',phone:'60111111111'},context=workspace({applications:[first,second]}),opened=[];
  const button=id=>({getAttribute:()=>id,setAttribute(){},closest:()=>null}),firstButton=button('A1'),secondButton=button(' A2 ');
  context.bindApplicationRecordAction(firstButton,'data-app',record=>opened.push(record));context.bindApplicationRecordAction(secondButton,'data-app',record=>opened.push(record));
  firstButton.onclick();secondButton.onclick();assert.deepEqual(opened,[first,second]);
  context.state.data.applications.push({id:' A2 ',leadId:'OTHER',phone:'60222222222'});
  secondButton.onclick();assert.equal(opened.length,2);assert.equal(secondButton.disabled,true);assert.match(secondButton.title,/ID ambiguous/);assert.doesNotMatch(secondButton.title,/ID unavailable/);
  firstButton.onclick();assert.equal(opened.length,3);assert.equal(opened[2],first);
});

test('different inbox customers sharing an ambiguous application ID remain distinct safe conversations',()=>{
  const leads=[{id:'L1',phone:'60111111111',name:'First'},{id:'L2',phone:'60222222222',name:'Second'}],applications=leads.map((lead,index)=>({id:index?' DUP ':'DUP',leadId:lead.id,phone:lead.phone}));
  const inbox=leads.map((lead,index)=>({id:`M${index}`,applicationId:'DUP',leadId:lead.id,phone:lead.phone,needsAction:true,openMessageCount:1,message:lead.name}));
  const context=workspace({leads,applications,inbox}),notifications=context.crmNotifications().filter(item=>item.type==='message');
  assert.equal(notifications.length,2);assert.notEqual(notifications[0].key,notifications[1].key);
  for(const item of notifications){
    assert.equal(item.applicationId,'');assert.equal(item.customerIdentityError,'');
    const attributes=context.notificationOpenAttributes(item,true);assert.match(attributes,new RegExp(`data-lead-id="${item.leadId}"`));assert.doesNotMatch(attributes,/DUP|disabled/);
    const customer=context.resolveCustomer360(item);assert.equal(customer.lead.id,item.leadId);assert.equal(customer.application,undefined);
    assert.equal(customer.matches(inbox.find(message=>message.leadId===item.leadId)),true);assert.equal(customer.matches(inbox.find(message=>message.leadId!==item.leadId)),false);
  }
});

test('whitespace application IDs use safe conversation identity while unique application IDs keep task dedupe',()=>{
  const leads=[{id:'L1',phone:'60111111111'}],context=workspace({leads,inbox:[
    {id:'M1',leadId:'L1',applicationId:'   ',phone:'60111111111',needsAction:true,openMessageCount:1},
    {id:'M2',leadId:'UNKNOWN',applicationId:' ',phone:'',needsAction:true,openMessageCount:1}
  ]});
  const notifications=context.crmNotifications(),safe=notifications.find(item=>item.id==='M1'),unsafe=notifications.find(item=>item.id==='M2');
  assert.match(safe.key,/^conversation-/);assert.equal(safe.applicationId,'');assert.equal(safe.leadId,'L1');
  assert.match(context.notificationOpenAttributes(unsafe),/disabled/);assert.doesNotMatch(context.notificationOpenAttributes(unsafe),/data-(?:customer-profile|app|lead-id|phone|open-view)/);
  context.state.data.applications=[{id:' A1 ',leadId:'L1',phone:'60111111111'}];context.state.data.inbox=[{...context.state.data.inbox[0],applicationId:'A1'}];
  const merged=context.crmNotifications();assert.equal(merged.length,1);assert.equal(merged[0].key,'customer-A1');assert.equal(merged[0].type,'message');
});

test('an inbox linked to another customer’s unique application keeps its original lead with or without a phone',()=>{
  const leads=[{id:'L1',phone:'60111111111',customerId:'C1'},{id:'L2',phone:'60222222222',customerId:'C2'}];
  const context=workspace({leads,applications:[{id:'A1',leadId:'L1',phone:'60111111111',customerId:'C1'}]});
  for(const phone of ['60222222222','']){
    const identity=context.inboxNotificationIdentity({applicationId:'A1',leadId:'L2',phone});
    assert.equal(identity.applicationId,'');assert.equal(identity.leadId,'L2');assert.equal(identity.phone,'60222222222');assert.equal(identity.customerIdentityError,'');
    const customer=context.resolveCustomer360(identity);assert.equal(customer.lead.id,'L2');assert.equal(customer.application,undefined);
    assert.equal(customer.matches({leadId:'L1',phone:'60111111111',applicationId:'A1'}),false);assert.equal(customer.matches({leadId:'L2',phone:'60222222222'}),true);
  }
});

test('conflicting original customer identifiers fail closed instead of producing a hybrid identity',()=>{
  const leads=[{id:'L1',phone:'60111111111',customerId:'C1'},{id:'L2',phone:'60222222222',customerId:'C2'}],context=workspace({leads,applications:[{id:'A1',leadId:'L1',phone:'60111111111',customerId:'C1'}]});
  for(const row of [{applicationId:'A1',leadId:'L2',phone:'60111111111'},{applicationId:'A1',leadId:'L2',customerId:'C1'}]){
    const identity=context.inboxNotificationIdentity(row);assert.equal(identity.applicationId,'');assert.equal(identity.leadId,'');assert.equal(identity.phone,'');assert.match(identity.customerIdentityError,/conflicts/);assert.match(context.notificationOpenAttributes(identity),/disabled/);
  }
  const phoneOnly=context.inboxNotificationIdentity({applicationId:'A1',phone:'60222222222'});assert.equal(phoneOnly.applicationId,'');assert.equal(phoneOnly.phone,'60222222222');assert.equal(context.resolveCustomer360(phoneOnly).lead.id,'L2');
  const matching=context.inboxNotificationIdentity({applicationId:'A1',leadId:'L1',phone:'60111111111',customerId:'C1'});assert.equal(matching.applicationId,'A1');assert.equal(matching.leadId,'L1');assert.equal(matching.phone,'60111111111');
});
