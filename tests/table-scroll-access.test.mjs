import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const appSource=await readFile(new URL('../app-v2.js',import.meta.url),'utf8');
const designCss=await readFile(new URL('../design-refresh.css',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');

test('wide CRM tables receive a viewport-level horizontal scroll control',()=>{
  assert.match(appSource,/function initializeTableScrollAccess\(\)/);
  assert.match(appSource,/document\.querySelectorAll\('\.table-card'\)/);
  assert.match(appSource,/window\.addEventListener\('scroll',scheduleTableScrollDock/);
  assert.match(appSource,/activeHorizontalTable\.scrollLeft=tableScrollDock\.scrollLeft/);
  assert.match(designCss,/\.table-scroll-dock\s*\{[\s\S]*position:fixed;[\s\S]*bottom:10px;/);
});

test('the scroll control follows dynamic page and table updates',()=>{
  assert.match(appSource,/new MutationObserver\(scheduleTableScrollDock\)\.observe\(app,\{childList:true,subtree:true\}\)/);
  assert.match(appSource,/bind\(\);applyDemoFeatureBanner\(\);scheduleTableScrollDock\(\);/);
  assert.match(html,/app-v2\.js\?v=20260828-customer-workspace1/);
  assert.match(html,/design-refresh\.css\?v=20260821-table-scroll1/);
});

test('the floating control is accessible and does not cover the final table row',()=>{
  assert.match(appSource,/aria-label','Scroll the visible table left or right'/);
  assert.match(appSource,/tableScrollDock\.tabIndex=0/);
  assert.match(designCss,/\.view:has\(\.table-card\)\{padding-bottom:76px\}/);
});

test('the floating scrollbar and visible table stay synchronized in both directions',()=>{
  const listeners={},targetListeners={};
  const target={
    offsetParent:{},scrollWidth:1500,clientWidth:800,scrollLeft:0,dataset:{},
    getBoundingClientRect:()=>({top:100,bottom:1200,left:300,right:1100}),
    addEventListener:(name,handler)=>{targetListeners[name]=handler}
  };
  const dock={
    hidden:true,tabIndex:-1,style:{},scrollLeft:0,attributes:{},listeners:{},
    firstElementChild:{style:{}},
    get clientWidth(){return Number.parseFloat(this.style.width)||0},
    setAttribute(name,value){this.attributes[name]=value},
    addEventListener(name,handler){this.listeners[name]=handler}
  };
  const context={
    document:{
      createElement:()=>dock,
      body:{appendChild(){}},
      querySelectorAll:()=>[target]
    },
    window:{innerHeight:900,innerWidth:1200,addEventListener:(name,handler)=>{listeners[name]=handler}},
    requestAnimationFrame:handler=>{handler();return 1},
    MutationObserver:class{observe(){}},
    app:{}
  };
  const start=appSource.indexOf('let tableScrollDock='),end=appSource.indexOf('const esc=',start);
  vm.runInNewContext(`${appSource.slice(start,end)};globalThis.scrollApi={syncTableScrollDock};`,context);
  context.scrollApi.syncTableScrollDock();
  assert.equal(dock.hidden,false);
  assert.equal(dock.style.left,'300px');
  assert.equal(dock.style.width,'800px');
  assert.equal(dock.firstElementChild.style.width,'1500px');

  dock.scrollLeft=410;dock.listeners.scroll();
  assert.equal(target.scrollLeft,410);
  target.scrollLeft=275;targetListeners.scroll();
  assert.equal(dock.scrollLeft,275);

  target.scrollWidth=800;context.scrollApi.syncTableScrollDock();
  assert.equal(dock.hidden,true);
});
