import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const composerSource=source.slice(source.indexOf('function manualWhatsApp(target){'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const node=()=>({value:'',disabled:false,hidden:false,dataset:{},textContent:'',innerHTML:'',children:new Map(),setAttribute(name,value){this[name]=value},querySelector(selector){if(!this.children.has(selector))this.children.set(selector,node());return this.children.get(selector)},querySelectorAll(){return[]},insertAdjacentHTML(){},addEventListener(){},focus(){}});

function composer({readFile=async()=> 'file-data',send=async()=>({mode:'CLOUD'})}={}){
  const form=node(),backdrop=node(),requests=[],customers={
    A:{leadId:'LEAD-A',applicationId:'APP-A',phone:'60111111111',name:'Customer A'},
    B:{leadId:'LEAD-B',applicationId:'APP-B',phone:'60222222222',name:'Customer B'}
  };
  form.isConnected=true;
  for(const name of ['customer','phone','message','messageType','templateName','language','attachment'])form[name]=node();
  form.customer.value='A';form.messageType.value='TEXT';form.language.value='ms';
  form.attachment.files=[];
  Object.defineProperty(form.attachment,'value',{get(){return this.files.length?'fake-local-file':''},set(value){if(value==='')this.files=[]}});
  form.templateName.options=[{value:'',dataset:{}}];
  Object.defineProperty(form.templateName,'selectedOptions',{get(){return this.options.filter(option=>option.value===this.value)}});
  form.closest=()=>backdrop;
  backdrop.remove=()=>{backdrop.removed=true;form.isConnected=false};
  const button=form.querySelector('[type=submit]'),cancel=form.querySelector('[data-cancel]');
  const controls=[form.customer,form.phone,form.message,form.messageType,form.templateName,form.language,form.attachment,button,cancel];
  form.querySelectorAll=()=>controls;
  let activeBackdrop=backdrop;
  const context=vm.createContext({
    state:{user:{whatsappMode:'CLOUD'},data:{inbox:[],applications:[],leads:[]}},
    applicationRecordId:value=>String(value||'').trim(),applicationIdentityWarning:()=> 'Missing ID',
    closeActiveDrawer:()=>true,formModal(){},esc:String,pretty:String,when:String,
    whatsappChannelLabel:()=> 'Official number',latestWhatsAppInbound:()=>({}),whatsappServiceWindowOpen:()=>true,
    customerTarget:key=>customers[key]||null,customerOptions:()=>'',FOLLOW_UP_TEMPLATE_REGISTRY:{},
    whatsappReplyContext:()=>({messages:[]}),whatsappSalesPresets:()=>[],
    document:{getElementById:id=>id==='manualWhatsAppForm'?form:form.querySelector('#formMessage'),querySelector:()=>activeBackdrop},
    post:async(action,payload)=>{if(action==='getWhatsAppTemplates')return new Promise(()=>{});requests.push({action,payload});return send(payload)},
    validateBrowserFile(){},fileData:readFile,refreshMessaging:async()=>{},alert(){},window:{location:{}}
  });
  vm.runInContext(composerSource,context);
  context.manualWhatsApp();
  return{form,backdrop,button,cancel,requests,controls,customers,submit:()=>form.onsubmit({preventDefault(){}}),replaceBackdrop:value=>{activeBackdrop=value}};
}

test('changing the selected customer clears the earlier attachment and private draft',()=>{
  const {form}=composer();
  form.message.value='Private draft for A';form.attachment.files=[{name:'customer-a.pdf',type:'application/pdf'}];
  form.customer.value='B';form.customer.onchange();
  assert.equal(form.phone.value,'60222222222');
  assert.equal(form.message.value,'');
  assert.equal(form.attachment.files.length,0);
  assert.match(form.querySelector('#formMessage').textContent,/cleared|removed/i);
});

test('reselecting the same customer preserves the draft but an unavailable customer clears it',()=>{
  const {form}=composer();
  form.message.value='Draft for A';form.attachment.files=[{name:'a.pdf',type:'application/pdf'}];
  form.customer.onchange();
  assert.equal(form.message.value,'Draft for A');assert.equal(form.attachment.files.length,1);
  form.customer.value='unavailable';form.customer.onchange();
  assert.equal(form.phone.value,'');assert.equal(form.message.value,'');assert.equal(form.attachment.files.length,0);
  assert.equal(form.dataset.serviceWindowOpen,'false');
});

test('attachment submission snapshots its recipient and prevents a second in-flight send',async()=>{
  const reading=deferred(),sending=deferred();
  const {form,requests,submit}=composer({readFile:()=>reading.promise,send:()=>sending.promise});
  form.message.value='For A';form.attachment.files=[{name:'a.pdf',type:'application/pdf'}];
  const first=submit(),second=submit();
  form.phone.value='60222222222';form.message.value='For B';form.messageType.value='TEMPLATE';form.templateName.value='other-template';form.language.value='en_US';
  reading.resolve('pdf-data');
  await new Promise(resolve=>setImmediate(resolve));
  const observed=requests.map(({payload})=>({leadId:payload.leadId,applicationId:payload.applicationId,phone:payload.phone,message:payload.message,messageType:payload.messageType,templateName:payload.templateName,language:payload.language}));
  sending.resolve({mode:'CLOUD'});await Promise.all([first,second]);
  assert.deepEqual(observed,[{leadId:'LEAD-A',applicationId:'APP-A',phone:'60111111111',message:'For A',messageType:'TEXT',templateName:'',language:'ms'}]);
});

test('file-read failure unlocks the same composer and preserves its draft for correction',async()=>{
  const reading=deferred();let reads=0;
  const {form,backdrop,controls,cancel,requests,submit}=composer({readFile:()=>++reads===1?reading.promise:Promise.resolve('pdf-data')});
  form.message.value='For A';form.attachment.files=[{name:'a.pdf',type:'application/pdf'}];
  const pending=submit();
  assert.ok(controls.every(control=>control.disabled));
  assert.equal(backdrop.dataset.dismissLocked,'true');
  cancel.onclick();assert.equal(form.isConnected,true,'Cancel cannot dismiss a preparing/sending reply');
  reading.reject(new Error('Unable to read the selected file'));await pending;
  assert.equal(requests.length,0);
  assert.equal(form.customer.disabled,false);assert.equal(form.attachment.disabled,false);
  assert.equal(backdrop.dataset.dismissLocked,undefined);
  assert.equal(form.message.value,'For A');assert.equal(form.attachment.files.length,1);
  assert.match(form.querySelector('#formMessage').textContent,/Unable to read/);
  await submit();assert.equal(requests.length,1);assert.equal(form.isConnected,false);
});

test('an externally removed composer cannot send after attachment reading completes',async()=>{
  const reading=deferred(),{form,requests,submit}=composer({readFile:()=>reading.promise});
  form.message.value='For A';form.attachment.files=[{name:'a.pdf',type:'application/pdf'}];
  const pending=submit();form.isConnected=false;reading.resolve('pdf-data');await pending;
  assert.equal(requests.length,0);
});

test('a completed request never closes a replacement customer dialog',async()=>{
  const sending=deferred(),{form,requests,submit,replaceBackdrop}=composer({send:()=>sending.promise});
  let replacementRemoved=false;
  form.message.value='For A';const pending=submit();
  assert.equal(requests.length,1);
  form.isConnected=false;replaceBackdrop({remove(){replacementRemoved=true}});
  sending.resolve({mode:'CLOUD'});await pending;
  assert.equal(replacementRemoved,false);
});
