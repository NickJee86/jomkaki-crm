import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../brand-refresh.css',import.meta.url),'utf8');
const logo=fs.readFileSync(new URL('../jomkaki-rider-logo-web.png',import.meta.url));

function paeth(a,b,c){
  const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

function pngPixelProfile(buffer){
  assert.equal(buffer.subarray(0,8).toString('hex'),'89504e470d0a1a0a','logo must be a PNG');
  let offset=8,width=0,height=0,bitDepth=0,colorType=0,interlace=0;
  const idat=[];
  while(offset<buffer.length){
    const length=buffer.readUInt32BE(offset),type=buffer.subarray(offset+4,offset+8).toString('ascii');
    const data=buffer.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];interlace=data[12];
    }else if(type==='IDAT') idat.push(data);
    offset+=12+length;
    if(type==='IEND') break;
  }
  assert.equal(bitDepth,8,'logo PNG must use 8-bit channels');
  assert.equal(colorType,6,'logo PNG must use RGBA pixels');
  assert.equal(interlace,0,'logo PNG must be non-interlaced for deterministic validation');
  const bytesPerPixel=4,stride=width*bytesPerPixel,raw=inflateSync(Buffer.concat(idat));
  assert.equal(raw.length,height*(stride+1),'logo PNG must decode completely');
  let previous=Buffer.alloc(stride),position=0,white=0,orange=0,samples=0;
  for(let y=0;y<height;y++){
    const filter=raw[position++],row=Buffer.allocUnsafe(stride);
    for(let x=0;x<stride;x++){
      const encoded=raw[position++],left=x>=bytesPerPixel?row[x-bytesPerPixel]:0,up=previous[x],upperLeft=x>=bytesPerPixel?previous[x-bytesPerPixel]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,upperLeft):NaN;
      assert.ok(Number.isFinite(predictor),`unsupported PNG filter ${filter}`);
      row[x]=(encoded+predictor)&255;
    }
    if(y%16===0){
      for(let x=0;x<width;x+=16){
        const i=x*4,r=row[i],g=row[i+1],b=row[i+2],a=row[i+3];samples++;
        if(a>220&&r>225&&g>225&&b>225) white++;
        if(a>220&&r>220&&g>45&&g<155&&b<105) orange++;
      }
    }
    previous=row;
  }
  return {width,height,samples,white,orange};
}

test('Official JomKaki Rider logo is used in every brand surface',()=>{
  assert.match(html,/rel="icon"[^>]+jomkaki-rider-logo-web\.png/);
  assert.equal((html.match(/src="\.\/jomkaki-rider-logo-web\.png/g)||[]).length,2);
  assert.match(html,/brand-refresh\.css\?v=20260818-rider-brand1/);
  assert.match(html,/jomkaki-rider-logo-web\.png\?v=20260818-logo-integrity-2/);
  assert.ok(logo.length>15000,'optimized official logo image should be present');
  const profile=pngPixelProfile(logo);
  assert.deepEqual([profile.width,profile.height],[320,320]);
  assert.ok(profile.white/profile.samples>0.05,'the white Rider artwork must be visibly present');
  assert.ok(profile.orange/profile.samples>0.45,'the official orange background must be present');
});

test('Official orange, navy and warm-neutral color system stays accessible',()=>{
  assert.match(css,/--brand-orange:#f45f20/);
  assert.match(css,/--brand-ink-deep:#071c2b/);
  assert.match(css,/--surface-bg:#f7f4f1/);
  assert.match(css,/\.primary\{[\s\S]*linear-gradient\(135deg,#ff7133,#e65017\)/);
  assert.match(css,/\.status-strip\{[\s\S]*#eaf7f1/);
  assert.match(css,/\.whatsapp-action\{background:#148a63!important/);
});
