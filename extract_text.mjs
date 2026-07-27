// Dump every page's text items grouped by Y, with their x positions — for
// working out a PDF's layout before writing a parser against it. More detail
// than extract_pdf_text.cjs, which just dumps the flat text.
//
//   node extract_text.mjs [directory] [--limit N]
//
// Defaults to the sample batch below. That folder is not in the repo, so pass a
// directory when you have your own batch to look at.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

const DEFAULT_DIR='New die ordering request-GEX-1-Fast track die -Batch -1';
const here=path.dirname(fileURLToPath(import.meta.url));
// pdfjs concatenates the font filename onto this and rejects anything not
// ending in a forward slash — so a Windows path.sep will not do.
const STANDARD_FONTS=path.join(here,'node_modules','pdfjs-dist','standard_fonts').replace(/\\/g,'/')+'/';
const dirArg=process.argv.slice(2).find(a=>!a.startsWith('--')&&Number.isNaN(Number(a)));
const dir=path.resolve(dirArg||path.join(here,DEFAULT_DIR));
const limitIdx=process.argv.indexOf('--limit');
const limitArg=limitIdx===-1?NaN:Number(process.argv[limitIdx+1]);
const limit=Number.isFinite(limitArg)&&limitArg>0?limitArg:5;

if(!fs.existsSync(dir)){
  console.error(`No such directory: ${dir}`);
  console.error('Pass the folder holding the PDFs, e.g. node extract_text.mjs "C:/batches/gex-1"');
  process.exit(1);
}

const sample=fs.readdirSync(dir).filter(f=>f.toLowerCase().endsWith('.pdf')).slice(0,limit);
if(!sample.length){
  console.error(`No PDF files in ${dir}`);
  process.exit(1);
}

for(const file of sample){
  const data=new Uint8Array(fs.readFileSync(path.join(dir,file)));
  // Without standardFontDataUrl pdfjs warns on every standard-font PDF and
  // falls back, which can garble the text it hands back.
  const pdf=await pdfjsLib.getDocument({data,standardFontDataUrl:STANDARD_FONTS}).promise;

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
