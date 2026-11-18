// Player flow against the real clock worker/WASM. No ?pairs flag and no replacement world model.
// node trainworld/checks/japan-operations.mjs [dev URL]
// Set PLAYWRIGHT_MODULE/PLAYWRIGHT_BROWSERS_PATH when Playwright is installed elsewhere.
// TW_CHROME optionally selects a browser executable on Linux/macOS.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACTS, collectErrors, launchChrome } from './lib.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const platform = process.platform === 'win32' ? {} : {
  executablePath: process.env.TW_CHROME,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};
const chrome = await launchChrome({ prefix: 'tw-japan-', size: [1400, 1000], ...platform });
const page = await chrome.ctx.newPage();
const errors = [], resources = [];
// These operations use a corridor we build here, not external tiles or published city packs.
// Keep JS/page errors strict; report unavailable resources (including Vite's data proxy) separately.
page.on('console', m => { if (m.type()==='error' && /^Failed to load resource:/.test(m.text())) resources.push(m.location().url); });
collectErrors(page, errors, /favicon|openfreemap|AJAXError|^Failed to load resource:/);
const edit = op => page.evaluate(op => window.tw.client.edit(op), op);
const select = line => page.evaluate(line => { window.tw.tools.exit(); window.tw.selection.value = {kind:'line',line:String(line)}; }, line);
try {
  await page.goto(`${base}?debug=1&new=1&mode=sandbox&paused=1&demandWorkers=1&lang=ja`);
  await page.waitForFunction(() => window.tw?.world?.value && window.tw.tools, undefined, { timeout: 180000 });
  const fixture = await page.evaluate(async () => {
    const tw = window.tw;
    const origin = tw.lngLatToPack(-73.93, 40.675);
    const P = (x, y) => ({x: origin.x + x, y: origin.y + 3000 + y});
    const send = async op => {
      const version = tw.world.value.version;
      const r = await tw.client.edit(op);
      if (!r.ok) throw new Error(JSON.stringify({op,r}));
      const end = performance.now() + 10000;
      while (tw.world.value.version === version && performance.now() < end) await new Promise(r => setTimeout(r,20));
      // The early save state can precede the rendered track snapshot (as in the standing checks).
      await new Promise(r => setTimeout(r, 300));
      return r;
    };
    await send({op:'route',from:{kind:'free',...P(-3000,0),level:0},to:{kind:'free',...P(3000,0),level:0},pis:[],single:false,quad:true});
    const near = p => tw.world.value.edges.filter(e => {
      if (e.crossover) return false;
      const a=tw.world.value.nodes.get(e.a),b=tw.world.value.nodes.get(e.b);
      return p.x >= Math.min(a.x,b.x)-1 && p.x <= Math.max(a.x,b.x)+1;
    }).sort((a,b)=> {
      const gap = e => {const a=tw.world.value.nodes.get(e.a),b=tw.world.value.nodes.get(e.b); return Math.abs(a.y+(p.x-a.x)/(b.x-a.x)*(b.y-a.y)-p.y);};
      return gap(a)-gap(b);
    })[0];
    const y0=P(0,0).y;
    const other=tw.world.value.edges.find(e=> {const a=tw.world.value.nodes.get(e.a),b=tw.world.value.nodes.get(e.b);const d=Math.abs((a.y+b.y)/2-y0);return d>5 && d<16;});
    if (!other) throw new Error('quad has no adjacent pair');
    const otherY=(tw.world.value.nodes.get(other.a).y+tw.world.value.nodes.get(other.b).y)/2-y0;
    const stops=[],beside=[];
    for (const [side,ids] of [[0,stops],[otherY,beside]]) {
      for (const [k,x] of [-2000,0,2000].entries()) {
        const p=P(x,side),edge=near(p);
        const before = new Set(tw.world.value.save.stations.map(s=>s.id));
        await send({op:'addStation',at:{kind:'edge',edge:edge.id,...p},platform:200,name:['西','折返し','東'][k]});
        const added = tw.world.value.save.stations.filter(s=>!before.has(s.id));
        if (added.length !== 1) throw new Error('expected one newly created platform');
        ids.push(Number(added[0].num));
      }
    }
    const made=await send({op:'addLine',stops,name:'全区間',colour:'#d6336c'});
    await send({op:'setTrainCount',line:made.line,trains:[6,4,2]});
    tw.tools.exit();tw.selection.value={kind:'line',line:String(made.line)};
    return {line:made.line,stops,beside};
  });
  assert(fixture.beside.every(n=>!fixture.stops.includes(n)), 'the fixture has separate platforms on the two pairs');
  await page.getByRole('button', {name:'途中折返し系統を作る',exact:true}).click({timeout:60000});
  await page.getByLabel('折返し駅', {exact:true}).selectOption('1');
  await page.getByRole('button', {name:'キャンセル',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.tw.world.value.save.lines.length),1,'cancel makes no copy');
  await page.getByRole('button', {name:'途中折返し系統を作る',exact:true}).click();
  await page.getByLabel('折返し駅', {exact:true}).selectOption('1');
  await page.getByRole('button', {name:'系統を作成',exact:true}).click();
  await page.waitForFunction(()=>window.tw.world.value.save.lines.length===2 && window.tw.selection.value?.kind==='group');
  const short = await page.evaluate(original => {
    const w=window.tw.world.value,l=w.save.lines.find(l=>l.num!==original);
    return {line:l.num,stops:l.stops.map(Number),group:l.group,fleet:w.lineStats[l.id].trainsNeeded,source:w.save.lines.find(l=>l.num===original).stops.map(Number)};
  }, fixture.line);
  assert.deepEqual(short.stops,fixture.stops.slice(0,2));
  assert.deepEqual(short.source,fixture.stops);
  assert(short.group>0);
  assert.deepEqual(short.fleet,[0,0,0]);
  await page.locator('.group-diagram .group-body > svg').waitFor();
  console.log('PASS short-turn picker, cancel, retained path, zero fleet and combined group diagram');

  const rapid = await edit({op:'copyLine',line:fixture.line,name:'快速'});
  assert(rapid.ok);
  for (let k=0;k<1;k++) assert((await edit({op:'dropStop',line:rapid.line,index:1})).ok);
  assert((await edit({op:'setTrainCount',line:rapid.line,trains:[4,2,0]})).ok);
  await select(rapid.line);
  await page.getByRole('button',{name:'隣のペアへ移動（上下とも）',exact:true}).click();
  await page.waitForFunction(({line,first})=>window.tw.world.value.save.lines.find(l=>l.num===line)?.stops[0]===String(first),{line:rapid.line,first:fixture.beside[0]});
  const moved=await page.evaluate(line=>{const w=window.tw.world.value,l=w.save.lines.find(l=>l.num===line),s=w.lineStats[l.id];return {stops:l.stops.map(Number),group:l.group,oneWay:s.oneWay,pairs:s.pairs??0,fleet:s.trainsNeeded};},rapid.line);
  assert.deepEqual(moved.stops,[fixture.beside[0],fixture.beside[2]]);
  assert.equal(moved.group,short.group);
  assert.equal(moved.oneWay,false);
  assert.equal(moved.pairs,0);
  assert.deepEqual(moved.fleet,[4,2,0]);
  await page.getByRole('button',{name:'系統グループを表示',exact:true}).click();
  await page.locator('.group-diagram .group-body > svg').waitFor();
  mkdirSync(ARTIFACTS,{recursive:true});
  await page.screenshot({path:join(ARTIFACTS,'japan-services.png')});
  assert((await edit({op:'undo'})).ok);
  await page.waitForFunction(({line,first})=>window.tw.world.value.save.lines.find(l=>l.num===line)?.stops[0]===String(first),{line:rapid.line,first:fixture.stops[0]});
  assert((await edit({op:'redo'})).ok);
  console.log('PASS normal UI exposes pair controls, rapid moves separately with both directions, group and fleet preserved, undo/redo');
  await select(fixture.line);
  const pool = page.locator('.quad-service input[type="checkbox"]');
  await page.locator('.quad-service label.check').click();
  await page.waitForFunction(l=>window.tw.world.value.lineStats[String(l)]?.pairs===1,fixture.line);
  const twin = await page.evaluate(l=>window.tw.world.value.lineStats[String(l)].twin,fixture.line);
  assert(twin !== undefined,'pooling still makes a hidden twin');
  assert((await edit({op:'removeStation',node:fixture.beside[1]})).ok);
  await page.waitForFunction(l=>window.tw.world.value.lineStats[String(l)]?.pairs===2,fixture.line);
  assert(await pool.isChecked(),'missing adjacent platform retains the pooling switch');
  assert((await edit({op:'undo'})).ok);
  await page.waitForFunction(l=>window.tw.world.value.lineStats[String(l)]?.pairs===1,fixture.line);
  await page.locator('.quad-service label.check').click();
  await page.waitForFunction(l=>!window.tw.world.value.lineStats[String(l)]?.pairs,fixture.line);
  console.log('PASS existing hidden twin pooling, missing-platform fallback and undo from the ordinary UI');
  assert.deepEqual(errors,[],'no application errors');
  if (resources.length) console.log(`WARN ${resources.length} external/data-proxy resource failures; operating checks completed`);
} finally { await chrome.close(); }
