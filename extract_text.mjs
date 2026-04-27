import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

class DM {
  constructor(i) {
    this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;
    this.m11=1;this.m12=0;this.m13=0;this.m14=0;
    this.m21=0;this.m22=1;this.m23=0;this.m24=0;
    this.m31=0;this.m32=0;this.m33=1;this.m34=0;
    this.m41=0;this.m42=0;this.m43=0;this.m44=1;
    this.is2D=true;this.isIdentity=true;
    if(Array.isArray(i)&&i.length===6){this.a=i[0];this.b=i[1];this.c=i[2];this.d=i[3];this.e=i[4];this.f=i[5]}
  }
  scale(){return new DM()} translate(){return new DM()} multiply(){return new DM()} inverse(){return new DM()} transformPoint(p){return p||{x:0,y:0}}
}
if(!globalThis.DOMMatrix) globalThis.DOMMatrix=DM;
if(!globalThis.ImageData) globalThis.ImageData=class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4)}};
if(!globalThis.Path2D) globalThis.Path2D=class{moveTo(){}lineTo(){}bezierCurveTo(){}quadraticCurveTo(){}closePath(){}rect(){}arc(){}};

const dir='E:/Die-Tracker/New die ordering request-GEX-1-Fast track die -Batch -1';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.pdf'));

// Sample: first file (201), a 601 file, a 401 file, and the last file
const sample=[files[0], files[7], files[16], files[17], files[20]].filter(Boolean);

for(const file of sample){
  const data=new Uint8Array(fs.readFileSync(path.join(dir,file)));
  const pdf=await pdfjsLib.getDocument({data}).promise;

  console.log('\n' + '='.repeat(90));
  console.log('FILE:', file, '| pages:', pdf.numPages);
  console.log('='.repeat(90));

  // Extract ALL pages
  for(let pn=1; pn<=pdf.numPages; pn++){
    const page=await pdf.getPage(pn);
    const tc=await page.getTextContent();
    const linesByY={};
    for(const it of tc.items){
      const y=Math.round(it.transform[5]);
      if(!linesByY[y]) linesByY[y]=[];
      linesByY[y].push({text:it.str, x:Math.round(it.transform[4])});
    }
    const sortedYs=Object.keys(linesByY).map(Number).sort((a,b)=>b-a);
    const merged={};
    let curY=null;
    for(const y of sortedYs){
      if(curY!==null && curY-y<=3){merged[curY].push(...linesByY[y])}
      else{curY=y;merged[y]=[...(linesByY[y]||[])]}
    }
    const mYs=Object.keys(merged).map(Number).sort((a,b)=>b-a);

    console.log(`\n--- PAGE ${pn} ---`);
    for(const y of mYs){
      const items=merged[y].sort((a,b)=>a.x-b.x);
      const line=items.map(i=>i.text).join(' ').trim();
      const detail=items.map(i=>`[x=${i.x}:"${i.text}"]`).join(' ');
      console.log(`Y=${y}: ${line}`);
      console.log(`       ${detail}`);
    }
  }
}
