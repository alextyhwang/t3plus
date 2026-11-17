// Controlled visual regression on an owned T3 tab. Clone only blank surface
// elements (no messages/tasks), then remove the diagnostic even on failure.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SELECTOR } from "./cdp.mjs";

export async function compareMaterial({ evaluate, cdp, pageSession, output }) {
  try {
    const box = await evaluate(`(() => {
      if (innerWidth < 800) throw new Error('Material comparison needs a desktop viewport');
      const shell=document.querySelector(${SELECTOR.composerShell}), host=shell.querySelector(${SELECTOR.composerHost});
      const widget=document.querySelector('.t3plus-home>.t3plus-w'), details=document.querySelector(${SELECTOR.detailsCard});
      const panel=document.createElement('div');panel.id='t3plus-material-diagnostic';panel.setAttribute('data-t3plus-owned','');
      panel.style.cssText='position:fixed;left:30px;top:70px;width:740px;height:220px;z-index:2147483647;background:repeating-linear-gradient(90deg,#d44040 0px 40px,#286bcb 40px 80px);border-radius:12px;pointer-events:none;color:white;font:13px Arial';
      const label=document.createElement('div');label.textContent='Test only: native composer / widget / thread details | identical backdrop';label.style.cssText='position:absolute;top:16px;left:20px';panel.append(label);
      const cloneShell=shell.cloneNode(false), cloneHost=host.cloneNode(false);cloneHost.removeAttribute('id');cloneShell.replaceChildren(cloneHost);cloneHost.style.cssText='width:100%;height:100%';
      [cloneShell,widget.cloneNode(false),details.cloneNode(false)].forEach((el,index)=>{
        el.removeAttribute('id');el.removeAttribute('data-t3plus-tasks-layout');
        el.style.cssText='position:absolute;left:'+(20+240*index)+'px;top:60px;width:200px;height:120px;min-height:0;max-height:120px;max-width:none;margin:0';panel.append(el);
      });
      document.body.append(panel);const r=panel.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
    })()`);
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const shot = await cdp.send("Page.captureScreenshot", {format:"png",clip:{...box,scale:1},captureBeyondViewport:false}, pageSession);
    await writeFile(join(output,"material-comparison.png"), Buffer.from(shot.data,"base64"));
    const result = await evaluate(`(async () => {
      const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+${JSON.stringify(shot.data)})).blob());
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data, scale=canvas.width/740;
      const result={};
      for(const [name,x] of [['widget',260],['details',500]]) {
        result[name]={};
        for(const [region,from,to] of [['fill',40,80],['rim',0,3]]) {
          let max=0,total=0,count=0;
          for(let u=70;u<130;u++) for(let v=from;v<to;v++) {
            const a=(Math.round((60+v)*scale)*canvas.width+Math.round((20+u)*scale))*4;
            const b=(Math.round((60+v)*scale)*canvas.width+Math.round((x+u)*scale))*4;
            for(let channel=0;channel<3;channel++){const d=Math.abs(pixels[a+channel]-pixels[b+channel]);max=Math.max(max,d);total+=d;count++;}
          }
          result[name][region]={maxChannelDifference:max,meanChannelDifference:total/count};
        }
      }
      return result;
    })()`);
    for (const sample of Object.values(result)) for (const region of Object.values(sample)) {
      assert.ok(region.maxChannelDifference <= 3, "Card glass or rim differs from the native composer on an identical backdrop");
    }
    return result;
  } finally {
    await evaluate("document.getElementById('t3plus-material-diagnostic')?.remove()");
  }
}
