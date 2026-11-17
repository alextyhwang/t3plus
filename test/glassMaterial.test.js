import assert from "node:assert/strict";
import { test } from "node:test";
import { syncGlassMaterial, clearGlassMaterial } from "../src/glassMaterial.js";
import { createDom } from "./helpers.js";

function fixture() {
  const dom=createDom("/draft/test", '<div data-slot="composer-shell"><div data-slot="composer-host"><div data-chat-composer-main-surface></div></div></div>');
  const doc=dom.window.document;
  doc.documentElement.setAttribute("data-t3plus-glass", "");
  const shell=doc.querySelector('[data-slot="composer-shell"]'), host=shell.firstElementChild, main=host.firstElementChild;
  for (const el of [shell,host,main]) el.getBoundingClientRect=()=>({width:300});
  const styles=new Map();
  const base={display:"block",visibility:"visible",opacity:"1",content:"none",backgroundColor:"transparent",borderTopColor:"transparent",boxShadow:"none",getPropertyValue(name){return name==='backdrop-filter'?this.backdropFilter||'none':'';}};
  function set(el,pseudo,values) {styles.set(el.id+':'+(pseudo??''),{...base,...values});}
  shell.id='shell';host.id='host';main.id='main';
  const win={getComputedStyle(el,pseudo){return styles.get(el.id+':'+(pseudo??''))??base;}};
  const glass={content:'""',backgroundColor:"rgba(22, 30, 45, 0.37)",backdropFilter:"blur(22px) saturate(1.35)"};
  set(shell,'::before',{...glass,display:'none'});
  set(host,'::before',glass);
  set(host,'::after',{content:'""',borderTopColor:'rgba(245,245,245,0.14)',boxShadow:'inset 0px 1px rgba(255,255,255,0.03)'});
  set(main,'::after',{content:'""',display:'none'});
  return {doc,win,shell,host,main,set,glass};
}

test("glass follows the visible context-row host and native rim, ignoring the hidden shell",()=>{
  const f=fixture();
  assert.equal(syncGlassMaterial(f.doc,f.win),true);
  const style=f.doc.documentElement.style;
  assert.equal(style.getPropertyValue('--t3plus-native-glass-fill'),f.glass.backgroundColor);
  assert.equal(style.getPropertyValue('--t3plus-native-glass-outline'),'rgba(245,245,245,0.14)');
  assert.match(style.getPropertyValue('--t3plus-native-glass-highlight'),/inset/);
  f.set(f.shell,'::before',{...f.glass,display:'block',backgroundColor:'wrong hidden choice'});
  f.set(f.main,undefined,{...f.glass,backgroundColor:'rgba(50,20,60,0.42)'});
  assert.equal(syncGlassMaterial(f.doc,f.win),true);
  assert.equal(style.getPropertyValue('--t3plus-native-glass-fill'),'rgba(50,20,60,0.42)','attached main surface wins over host and shell');
});

test("custom-theme material updates without guessing from --card and cleans up when absent or disabled",()=>{
  const f=fixture();syncGlassMaterial(f.doc,f.win);
  f.set(f.host,'::before',{...f.glass,backgroundColor:'rgba(210,180,220,0.28)',backdropFilter:'blur(24px) saturate(1.35)'});
  syncGlassMaterial(f.doc,f.win);
  assert.equal(f.doc.documentElement.style.getPropertyValue('--t3plus-native-glass-fill'),'rgba(210,180,220,0.28)');
  f.host.getBoundingClientRect=()=>({width:0});
  assert.equal(syncGlassMaterial(f.doc,f.win),false);
  assert.equal(f.doc.documentElement.style.getPropertyValue('--t3plus-native-glass-filter'),'');
  f.host.getBoundingClientRect=()=>({width:300});syncGlassMaterial(f.doc,f.win);
  f.doc.documentElement.removeAttribute('data-t3plus-glass');
  syncGlassMaterial(f.doc,f.win);
  assert.equal(f.doc.documentElement.style.getPropertyValue('--t3plus-native-glass-fill'),'');
  clearGlassMaterial(f.doc);
});
