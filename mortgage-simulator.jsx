import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const TX_TAX=0.02, TX_INS=0.0088;
const SAV_R=0.045/12, FUND_R=0.04/12, RET_R=0.07/12;
const MAX_MO=480, WEEKS_PER_MO=4.333;
const MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const toDate=m=>{const t=2+m;return `${MO[t%12]} ${2026+Math.floor(t/12)}`;};
const fmt=n=>n==null?"—":`$${Math.round(n).toLocaleString()}`;
const fmtK=fmt; // no abbreviation — full numbers glide better
const rndRange=(a,b)=>a+Math.random()*(b-a);
const rndNormal=(u,s)=>{const r=Math.sqrt(-2*Math.log(Math.random()))*Math.cos(2*Math.PI*Math.random());return u+r*s;};
// Time steps: months advanced per tick
const TIME_STEPS=[
  {label:"1D", mpt:1/30},
  {label:"1W", mpt:1/4.333},
  {label:"2W", mpt:2/4.333},
  {label:"1M", mpt:1},
  {label:"3M", mpt:3},
  {label:"6M", mpt:6},
  {label:"1Y", mpt:12},
];
// Speed multipliers: 1× = 500ms interval between ticks
const SPEED_MULTS=[1,2,4,8,16];
const speedToMs=mult=>Math.round(500/mult);

const SEASONAL={
  electric:[0.85,0.85,0.90,0.90,1.00,1.25,1.40,1.35,1.10,0.90,0.85,0.85],
  gas:     [1.50,1.45,1.20,0.90,0.70,0.50,0.45,0.45,0.65,0.90,1.20,1.45],
  groceries:[1.00,1.00,1.00,1.02,1.05,1.05,1.05,1.05,1.02,1.00,1.08,1.10],
  transport:[1.00,1.00,1.00,1.00,1.00,1.05,1.08,1.08,1.03,1.00,1.00,1.00],
  misc:    [1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.15,1.20],
};
const EXP_DEFS={
  electric: {label:"Electric",        base:300, icon:"⚡",rnd:0.05,season:"electric"},
  gas:      {label:"Gas / Heat",       base:50,  icon:"🔥",rnd:0.05,season:"gas"},
  groceries:{label:"Groceries",        base:300, icon:"🛒",rnd:0.08,season:"groceries"},
  dining:   {label:"Dining / Fun",     base:300, icon:"🍕",rnd:0.12,season:null},
  internet: {label:"Internet + Phone", base:150, icon:"📡",rnd:0.00,season:null},
  transport:{label:"Transport / Gas",  base:200, icon:"🚗",rnd:0.00,season:"transport"},
  health:   {label:"Health / Medical", base:200, icon:"💊",rnd:0.00,season:null},
  misc:     {label:"Misc / Personal",  base:300, icon:"🎯",rnd:0.30,season:"misc"},
};
const calcExpCats=(ec,mo,mult=1)=>{
  const cm=(2+mo)%12; const cats={};
  for(const[k,d]of Object.entries(EXP_DEFS)){
    const b=(ec[k]??d.base)*mult,sc=d.season?SEASONAL[d.season][cm]:1;
    cats[k]=Math.max(0,b*sc*(1+(Math.random()*2-1)*(ec[`${k}_r`]??d.rnd)));
  }
  return{total:Object.values(cats).reduce((a,v)=>a+v,0),cats};
};
const calcExp=(ec,mo)=>calcExpCats(ec,mo).total;
function calcTax(g){
  const br=[[23200,.10],[71100,.12],[106750,.22],[182850,.24],[103550,.32],[243750,.35],[Infinity,.37]];
  let t=0,r=Math.max(0,g-29200);
  for(const[l,p]of br){const c=Math.min(r,l);t+=c*p;r-=c;if(r<=0)break;}
  return t+Math.min(g,168600)*0.0765;
}
const calcPI=(loan,ar,n=360)=>{if(loan<=0)return 0;const r=ar/12;return loan*(r*(1+r)**n)/((1+r)**n-1);};

// S&P 500 sim
const SP_MEAN=0.10/12, SP_STD=0.04;

// Default emergency events
const DEF_EMERG=[
  {id:1,name:"Flat Tire",     icon:"🚗",cost:250, var:0.30},
  {id:2,name:"Vet Visit",     icon:"🐾",cost:600, var:0.50},
  {id:3,name:"TV Broken",     icon:"📺",cost:700, var:0.40},
  {id:4,name:"Medical Bill",  icon:"🏥",cost:1500,var:0.60},
  {id:5,name:"Home Repair",   icon:"🔧",cost:900, var:0.50},
  {id:6,name:"Car Repair",    icon:"🚙",cost:1200,var:0.50},
  {id:7,name:"Appliance",     icon:"❄️",cost:800, var:0.40},
  {id:8,name:"Phone Screen",  icon:"📱",cost:350, var:0.20},
  {id:9,name:"AC / Furnace",  icon:"🌡️",cost:1800,var:0.40},
  {id:10,name:"Dental Bill",  icon:"🦷",cost:1200,var:0.50},
  {id:11,name:"Roof Leak",    icon:"🏠",cost:2500,var:0.45},
  {id:12,name:"ER Visit",     icon:"🚑",cost:3000,var:0.70},
];

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS & INIT
// ─────────────────────────────────────────────────────────────────────────────
const DEF_EXP=Object.fromEntries([
  ...Object.entries(EXP_DEFS).map(([k,v])=>[k,v.base]),
  ...Object.entries(EXP_DEFS).map(([k,v])=>[`${k}_r`,v.rnd]),
]);
const DEFAULT_CFG={
  homePrice:250000,downPayment:50000,mortRate:6.5,homeIns:1.25,closingCost:3,hoaMo:0,
  income1:64246,inc1Mode:"annual",inc1Hr:31,inc1Hrs:40,
  income2:0,    inc2Mode:"annual",inc2Hr:0, inc2Hrs:0,
  extraPmt:0,savMo:25,retPct:3,
  emMo:25,emInit:0,svMo:25,svInit:0,svTarget:1500,lvMo:25,lvInit:0,lvTarget:5000,
  invMo:75,invInit:1000,
  chkInit:5000,savInit:1000,retInit:45000,
  chkCap:10000,emCap:2000,
  savRate:3.65,
  emergEvents:[...DEF_EMERG],emergPerYear:4,emergChance:20,
  expenses:{...DEF_EXP},
};

const getIncome=(cfg,n)=>{
  const mode=cfg[`inc${n}Mode`],hr=cfg[`inc${n}Hr`]||0,hrs=cfg[`inc${n}Hrs`]||40;
  return mode==="hourly"?hr*hrs*52:(cfg[`income${n}`]||0);
};

function initSim(c){
  const loan=Math.max(0,c.homePrice-c.downPayment),eq=c.homePrice-loan;
  const em=c.emInit||0,sv=c.svInit||0,lv=c.lvInit||0,inv=c.invInit||0;
  const closingDollar=Math.round((c.homePrice||0)*(c.closingCost||3)/100);
  const startChk=Math.max(0,(c.chkInit||0)-closingDollar);
  const nw=startChk+c.savInit+c.retInit+em+sv+lv+inv+eq;
  return{
    mo:0,mort:loan,chk:startChk,sav:c.savInit||0,ret:c.retInit||0,
    em,sv,lv,inv,
    inc1:getIncome(c,1),inc2:getIncome(c,2),
    inc1RaiseMo:0,inc2RaiseMo:0,
    xpmt:c.extraPmt,savMo:c.savMo,retPct:c.retPct,
    emMo:c.emMo,svMo:c.svMo,lvMo:c.lvMo,invMo:c.invMo||0,
    paidOff:loan<=0,paidOffMo:loan<=0?0:null,
    spNext:Math.floor(rndRange(24,48)),spCrashLeft:0,spTotal:0,
    ecdl:{},
    svTrips:0,lvTrips:0,        // vacation counter
    iPaid:0,pPaid:0,            // cumulative mortgage interest / principal paid
    logs:[],milestones:[],lastExp:0,lastIncome:0,lastHousing:0,lastSavings:0,
    expMult:1,            // cumulative expense inflation multiplier
    lastInflationMo:0,    // last month inflation was applied
    lastRaiseMo:0,        // last month auto-raise was applied
    hist:[{mo:0,lbl:toDate(0),yr:"Start",mort:loan,chk:startChk,sav:c.savInit||0,ret:c.retInit||0,em,sv,lv,inv,nw:Math.round(nw),eq:Math.round(eq),exp:0,iPaid:0,pPaid:0,eEl:0,eGas:0,eGro:0,eDin:0,eInt:0,eTra:0,eHlth:0,eMisc:0,eSav:0}],
    warns:[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TICK ENGINE  — ALL money flows through checking first, then out
// Biweekly pay: 2 paychecks/mo = annual/26 * 2. Retirement is a payroll
// deduction that goes checking → ret (pre-tax math preserved via netPay calc).
// ─────────────────────────────────────────────────────────────────────────────
function tick(st,cfg){
  if(st.mo>=MAX_MO)return st;
  const s={...st,mo:st.mo+1,warns:[],logs:st.logs,milestones:[...st.milestones],ecdl:{...st.ecdl},
    iPaid:st.iPaid||0, pPaid:st.pPaid||0, svTrips:st.svTrips||0, lvTrips:st.lvTrips||0,
    inc1RaiseMo:st.inc1RaiseMo||0, inc2RaiseMo:st.inc2RaiseMo||0,
    expMult:st.expMult||1, lastInflationMo:st.lastInflationMo||0, lastRaiseMo:st.lastRaiseMo||0};
  const mr=(cfg.mortRate||6.8)/100, fired=[];

  // ── AUTO RAISE: Joseph +3% every 24 months ────────────────────────────
  if(s.mo>0 && s.mo-s.lastRaiseMo>=24){
    const prev=s.inc1;
    s.inc1=Math.round(s.inc1*1.03);
    s.lastRaiseMo=s.mo;
    s.inc1RaiseMo=s.mo;
    fired.push(`📈 Joseph: auto raise! ${fmt(prev)} → ${fmt(s.inc1)}/yr (+3%)`);
  }

  // ── ANNUAL INFLATION: 0.5–3% applied to all expense bases ────────────
  if(s.mo>0 && s.mo-s.lastInflationMo>=12){
    const rate=rndRange(0.005,0.03);
    s.expMult=Math.round((s.expMult*(1+rate))*1000)/1000;
    s.lastInflationMo=s.mo;
    fired.push(`📊 Inflation: expenses +${(rate*100).toFixed(1)}% (cumulative ×${s.expMult.toFixed(2)})`);
  }


  // Helper: transfer up to `mo` from checking into account k (never overdraft via this)
  const xf=(k,mo)=>{const t=Math.min(mo,Math.max(0,s.chk));s.chk-=t;s[k]+=t;};

  // ── PHASE 1: PAYCHECKS HIT CHECKING ───────────────────────────────────────
  // 2 paychecks/mo (biweekly). Annual/26 per check × 2 = annual/13.
  // We add net-of-tax (federal + FICA) but BEFORE retirement so ret flows
  // through checking visibly in the next step. Tax is on (gross − ret_contrib).
  const tg=s.inc1+s.inc2;
  const ra=tg*s.retPct/100, rm=ra/12;          // annual/monthly retirement contrib
  const monthlyTax=calcTax(tg-ra)/12;           // monthly tax (pre-tax 401k reduces it)
  // Biweekly: 26 checks/yr → 2 per month most months (close to annual/13 per mo)
  // We use annual/12 as the fair monthly equivalent (consistent with monthly budgeting)
  const grossPerMo=tg/12;
  const netDeposit=Math.max(0, grossPerMo - monthlyTax);
  s.chk += netDeposit; // net-after-tax lands in checking (retirement still inside)
  s.lastIncome=Math.round(netDeposit-rm); // store true net take-home for display

  // ── PHASE 2: RETIREMENT DEDUCTED FROM CHECKING → RET ─────────────────────
  // Flows checking → retirement just like any other savings account.
  // Pre-tax advantage is already captured: tax was calculated on (gross − ra).
  xf('ret', rm);
  s.ret *= (1+RET_R);                            // market growth on existing balance

  // ── PHASE 3: HOUSING COSTS FROM CHECKING ─────────────────────────────────
  const ol=Math.max(0,cfg.homePrice-cfg.downPayment), pi=calcPI(ol,mr);
  const pt=(cfg.homePrice*TX_TAX)/12, ins=(cfg.homePrice*(cfg.homeIns||TX_INS*100)/100)/12;
  // Property tax + insurance + HOA always owed every month
  s.chk -= (pt+ins);
  let lastHousing=Math.round(pt+ins);
  if(!s.paidOff&&s.mort>0){
    const ir=s.mort*(mr/12), pp=Math.min(pi-ir+s.xpmt, s.mort);
    const pmi=(s.mort/cfg.homePrice>0.8)?Math.round(s.mort*0.006/12):0;
    s.iPaid+=ir; s.pPaid+=pp;
    s.mort=Math.max(0, s.mort-pp);
    s.chk -= (pi+s.xpmt+pmi);
    lastHousing+=Math.round(pi+s.xpmt+pmi);
    if(s.mort<=0){s.mort=0;s.paidOff=true;s.paidOffMo=s.mo;fired.push(`🎉 MORTGAGE PAID OFF! (${toDate(s.mo)})`);}
  }
  s.lastHousing=lastHousing;

  const{total:exp,cats:expCats}=calcExpCats(cfg.expenses||{},s.mo,s.expMult);
  s.chk -= exp; s.lastExp=Math.round(exp); s.lastExpCats=expCats;

  // ── PHASE 5: SAVINGS CONTRIBUTIONS — deducted from checking ───────────────
  // xf() caps each transfer at available checking balance, so we never
  // fund savings that checking can't cover. Interest earned is separate —
  // it's paid by the bank, not a transfer from checking.
  const chkBeforeSav=s.chk;
  const savR=(cfg.savRate||3.67)/100/12;     // user-configurable savings APY
  xf('sav', s.savMo); s.sav *= (1+savR);
  xf('em',  s.emMo);  s.em  *= (1+savR);
  xf('sv',  s.svMo);  s.sv  *= (1+savR);
  xf('lv',  s.lvMo);  s.lv  *= (1+savR);

  // ── PHASE 6: INVESTMENT CONTRIBUTION — deducted from checking ─────────────
  xf('inv', s.invMo);
  s.lastSavings=Math.round(chkBeforeSav-s.chk); // actual amount transferred out
  // S&P 500 simulation (growth applied to full balance, funded or not)
  s.spNext--;
  if(s.spNext<=0&&s.spCrashLeft<=0){
    s.spCrashLeft=Math.floor(rndRange(4,10)); s.spNext=Math.floor(rndRange(24,48));
    fired.push(`📉 Market correction began!`);
  }
  const invR=s.spCrashLeft>0?-(rndRange(0.02,0.05)):rndNormal(SP_MEAN,SP_STD);
  if(s.spCrashLeft>0) s.spCrashLeft--;
  s.inv=Math.max(0, s.inv*(1+invR));
  s.spTotal+=invR*100;

  // ── PHASE 7: LIFE EVENTS HIT CHECKING ────────────────────────────────────
  if((cfg.emergEvents||[]).length&&(cfg.emergPerYear||0)>0){
    const cp=(cfg.emergPerYear)*(cfg.emergChance||0)/100/12;
    if(Math.random()<cp){
      const avail=(cfg.emergEvents||[]).filter(e=>!(s.ecdl[e.id]>0));
      if(avail.length){
        const ev=avail[Math.floor(Math.random()*avail.length)];
        const cost=Math.round(ev.cost*(1+(Math.random()*2-1)*(ev.var||0.3)));
        s.ecdl[ev.id]=24;
        if(s.em>=cost){
          s.em-=cost;
          fired.push(`🛡 ${ev.icon} ${ev.name}: -${fmt(cost)} (emergency fund)`);
        } else if(s.em>0){
          const fromEm=s.em; s.em=0; s.chk-=(cost-fromEm);
          fired.push(`${ev.icon} ${ev.name}: -${fmt(cost)} (em $${Math.round(fromEm).toLocaleString()} + chk $${Math.round(cost-fromEm).toLocaleString()})`);
        } else {
          s.chk-=cost;
          fired.push(`${ev.icon} ${ev.name}: -${fmt(cost)} (from checking)`);
        }
      }
    }
  }
  for(const k of Object.keys(s.ecdl)) s.ecdl[k]=Math.max(0,s.ecdl[k]-1);

  // ── PHASE 8: VACATION PAYOUT ──────────────────────────────────────────────
  const svTarget=cfg.svTarget||1500, lvTarget=cfg.lvTarget||5000;
  if(s.sv>=svTarget){ s.svTrips++; fired.push(`✈ Small vacation #${s.svTrips}! Spent ${fmt(s.sv)}`); s.sv=0; }
  if(s.lv>=lvTarget){ s.lvTrips++; fired.push(`🌴 Big vacation #${s.lvTrips}! Spent ${fmt(s.lv)}`);   s.lv=0; }

  // ── PHASE 9: DEFICIT WATERFALL ────────────────────────────────────────────
  // Checking is negative. Draw from reserves in priority order:
  //   1. Emergency fund  — designed for exactly this
  //   2. Savings         — liquid fallback
  //   3. Investments     — liquidate as last resort
  //   4. True crisis     — nothing left, log the deficit
  if(s.chk<0){
    const need=()=>Math.abs(Math.min(0,s.chk));
    if(s.em>=need()){
      const f=need(); s.em-=f; s.chk+=f;
      fired.push(`🛡 Emergency fund covered ${fmt(f)} shortfall`);
    } else {
      if(s.em>0){ const f=s.em; s.chk+=f; s.em=0; fired.push(`🛡 Emergency fund drained (${fmt(f)} applied)`); }
      if(s.chk<0&&s.sav>0){ const f=Math.min(s.sav,need()); s.sav-=f; s.chk+=f; fired.push(`🏦 Pulled ${fmt(f)} from savings`); }
      if(s.chk<0&&s.inv>0){ const f=Math.min(s.inv,need()); s.inv-=f; s.chk+=f; fired.push(`📉 Liquidated ${fmt(f)} investments — last resort!`); }
      if(s.chk<0) s.warns=[`🚨 Crisis: ${fmt(Math.abs(s.chk))} uncovered`];
    }
  }

  // ── PHASE 10: ACCOUNT CAPS — checking/em overflow spills to savings ────────
  const chkCap=cfg.chkCap||15000, emCap=cfg.emCap||8000;
  if(s.chk>chkCap){ const ov=s.chk-chkCap; s.chk=chkCap; s.sav+=ov; }
  if(s.em>emCap){   const ov=s.em-emCap;   s.em=emCap;   s.sav+=ov; }

  // ── MILESTONES ────────────────────────────────────────────────────────────
  const pp=ol>0?(1-s.mort/ol)*100:100;
  for(const p of[25,50,75,100]) if(pp>=p&&!s.milestones.find(m=>m.k===`m${p}`)){const msg=`🏠 Mortgage ${p}% paid!`;s.milestones.push({k:`m${p}`,mo:s.mo,msg});fired.push(msg);}
  for(const[pfx,bal,ic,lb]of[['s',s.sav,'🏦','Savings'],['r',s.ret,'📈','Retirement'],['em',s.em,'🛡','EmergFund'],['sv',s.sv,'✈','SmVac'],['lv',s.lv,'🌴','LgVac'],['inv',s.inv,'💹','Investment']])
    for(const a of[1000,5000,10000,25000,50000,100000,250000,500000])
      if(bal>=a&&!s.milestones.find(m=>m.k===`${pfx}${a}`)){const msg=`${ic} ${lb} hit ${fmt(a)}!`;s.milestones.push({k:`${pfx}${a}`,mo:s.mo,msg});fired.push(msg);}

  const eq=cfg.homePrice-s.mort, nw=s.chk+s.sav+s.ret+s.em+s.sv+s.lv+s.inv+eq;
  const ec=expCats||{};
  s.hist=[...st.hist,{mo:s.mo,lbl:toDate(s.mo),yr:`Y${Math.floor(s.mo/12)+1}`,
    mort:Math.round(s.mort),chk:Math.round(s.chk),sav:Math.round(s.sav),ret:Math.round(s.ret),
    em:Math.round(s.em),sv:Math.round(s.sv),lv:Math.round(s.lv),inv:Math.round(s.inv),
    nw:Math.round(nw),eq:Math.round(eq),exp:Math.round(exp),
    iPaid:Math.round(s.iPaid),pPaid:Math.round(s.pPaid),
    eEl:Math.round(ec.electric||0),eGas:Math.round(ec.gas||0),eGro:Math.round(ec.groceries||0),
    eDin:Math.round(ec.dining||0),eInt:Math.round(ec.internet||0),eTra:Math.round(ec.transport||0),
    eHlth:Math.round(ec.health||0),eMisc:Math.round(ec.misc||0),
    eSav:Math.round(s.lastSavings||0)}];
  s.logs=fired.length?[...st.logs,...fired.map(m=>({mo:s.mo,msg:m}))]:st.logs;
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME  — dynamic glassmorphic + skeuomorphic engine
// ─────────────────────────────────────────────────────────────────────────────
const ACC={blue:"#0A84FF",green:"#30D158",red:"#FF453A",orange:"#FF9F0A",purple:"#BF5AF2",teal:"#5AC8FA",yellow:"#FFD60A"};
const C={...ACC,
  bg:"var(--cb)", card:"var(--cc)", inp:"var(--ci)",
  border:"var(--cd)", shadow:"var(--cs)", nav:"var(--cn)", tip:"var(--ck)",
  text:"var(--ct)", sub:"var(--cu)", muted:"var(--cm)",
  axis:"var(--ca)", axisB:"var(--cab)", hi:"var(--chi)",
  // nm surface
  nm:"var(--nm-bg)",
};

// hslToHex helper
function hslToHex(h,s,l){
  s/=100; l/=100;
  const a=s*Math.min(l,1-l);
  const f=n=>{const k=(n+h/30)%12;const color=l-a*Math.max(Math.min(k-3,9-k,1),-1);return Math.round(255*color).toString(16).padStart(2,'0');};
  return "#"+f(0)+f(8)+f(4);
}

const DEFAULT_THEME={
  dark:true,
  // Surface
  hue:220, sat:18, bgL:9, fgL:13,
  // Gradient: 3 independent stops (hue offsets + lightness offsets)
  grad0H:0,  grad0L:4,   // stop 0: hue shift, lightness offset from bgL
  grad1H:-8, grad1L:0,   // stop 1: center (matches bgL)
  grad2H:12, grad2L:-3,  // stop 2: hue shift, lightness offset from bgL
  gradAngle:145,          // gradient angle 0-360
  // Backdrop
  // Typography
  textOp:0.92, subOp:0.48, borderOp:0.09,
  // Depth / Neumorphic
  emboss:1.0, shadowSz:6,
  // Shape
  radius:18,
  // Accent
  accentSat:75,
};

function clamp(v,lo,hi){return Math.min(hi,Math.max(lo,v));}

function buildThemeVars(dark, t) {
  const h=t.hue, sat=clamp(t.sat,0,60);
  const em=clamp(t.emboss,0,2.5), sz=clamp(t.shadowSz,2,18);
  const r=clamp(t.radius,4,32);
  const aSat=clamp(t.accentSat,10,100);
  const tOp=clamp(t.textOp,0.3,1);
  const sOp=clamp(t.subOp,0.15,0.9);
  const bOp=clamp(t.borderOp,0,0.4);

  // Background + foreground base lightness
  const bgL = dark ? clamp(t.bgL,3,22)     : clamp(t.bgL+80,78,98);
  const fgL = dark ? clamp(t.fgL,5,26)     : clamp(t.fgL+80,82,97);
  // Input surface sits between bg and fg
  const inpL = dark ? clamp((bgL+fgL)/2,4,24) : clamp((bgL+fgL)/2,80,97);

  // 3-stop bg gradient
  const g0H = h + clamp(t.grad0H,-60,60);
  const g1H = h + clamp(t.grad1H,-60,60);
  const g2H = h + clamp(t.grad2H,-60,60);
  const g0L = dark ? clamp(bgL+clamp(t.grad0L,-10,14),2,28) : clamp(bgL+clamp(t.grad0L,-8,8),75,99);
  const g1L = dark ? clamp(bgL+clamp(t.grad1L,-10,14),2,28) : clamp(bgL+clamp(t.grad1L,-8,8),75,99);
  const g2L = dark ? clamp(bgL+clamp(t.grad2L,-10,14),2,28) : clamp(bgL+clamp(t.grad2L,-8,8),75,99);
  const ang  = clamp(t.gradAngle,0,360);

  // Color tokens — string concat, zero nested template literals
  const bgBase  = "hsl("+h+","+sat+"%,"+bgL+"%)";
  const fgBase  = "hsl("+h+","+sat+"%,"+fgL+"%)";
  const inpBase = "hsl("+h+","+sat+"%,"+inpL+"%)";
  const grad    = "linear-gradient("+ang+"deg,hsl("+g0H+","+sat+"%,"+g0L+"%) 0%,hsl("+g1H+","+sat+"%,"+g1L+"%) 45%,hsl("+g2H+","+sat+"%,"+g2L+"%) 100%)";
  const navBg   = "hsla("+h+","+sat+"%,"+bgL+"%,"+(dark?0.88:0.94)+")";
  const borderC = dark ? "hsla("+h+","+Math.min(40,sat+10)+"%,80%,"+bOp+")" : "hsla("+h+",30%,30%,"+(bOp+0.05)+")";
  const textC   = dark ? "rgba(255,255,255,"+tOp+")" : "rgba(0,0,0,"+tOp+")";
  const subC    = dark ? "rgba(255,255,255,"+sOp+")" : "rgba(0,0,0,"+sOp+")";
  const mutedC  = dark ? "rgba(255,255,255,"+(sOp*.45)+")" : "rgba(0,0,0,"+(sOp*.5)+")";
  const hiC     = dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.65)";
  const axiC    = dark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.40)";
  const shadowC = dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.10)";

  // ── True bilateral neumorphic shadows ────────────────────────────────────────
  // Dark shadow color (bottom-right) — darker than surface
  const nmDk  = "hsl("+h+","+clamp(sat+5,0,65)+"%,"+Math.max(1,Math.round(bgL*0.35))+"%)";
  // Light highlight color (top-left) — noticeably lighter than surface
  const nmHi  = dark
    ? "hsl("+h+","+Math.max(0,sat-12)+"%,"+Math.min(48,Math.round(fgL*2.6))+"%)"
    : "hsl("+h+","+Math.max(0,sat-14)+"%,99%)";
  // Em-scaled spread — highlight gets 1.2× the distance/blur so it reaches as far visually
  const d  = Math.round(sz*em);         // dark: offset
  const b  = Math.round(sz*em*2.0);     // dark: blur
  const dh = Math.round(sz*em*1.2);     // highlight: offset (larger to match perceived reach)
  const bh = Math.round(sz*em*2.4);     // highlight: blur
  const di = Math.round(sz*em*0.8);     // inset dark offset
  const bi = Math.round(sz*em*1.5);     // inset dark blur
  const dhi= Math.round(sz*em*0.95);    // inset highlight offset
  const bhi= Math.round(sz*em*1.8);     // inset highlight blur
  const ds = Math.round(sz*em*0.5);     // small dark offset
  const bs = Math.round(sz*em*1.2);     // small dark blur
  const dsh= Math.round(sz*em*0.62);    // small highlight offset
  const bsh= Math.round(sz*em*1.45);    // small highlight blur
  // Gap that scales with depth
  const gap = Math.round(8 + sz*em*0.8);
  const nmBg = fgBase;
  // Raised: dark bottom-right + wider light top-left + rim
  const rimHi = dark ? "rgba(255,255,255,"+(0.08*em)+")" : "rgba(255,255,255,"+(0.8*em)+")";
  const nmOut  = d+"px "+d+"px "+b+"px "+nmDk+", -"+dh+"px -"+dh+"px "+bh+"px "+nmHi+", inset 0 1px 0 "+rimHi;
  // Sunken: balanced inset both sides
  const nmIn   = "inset "+di+"px "+di+"px "+bi+"px "+nmDk+", inset -"+dhi+"px -"+dhi+"px "+bhi+"px "+nmHi;
  // Small raised
  const nmSm   = ds+"px "+ds+"px "+bs+"px "+nmDk+", -"+dsh+"px -"+dsh+"px "+bsh+"px "+nmHi+", inset 0 1px 0 "+rimHi;

  return [
    "--cb:"+bgBase,
    "--cc:"+fgBase,
    "--ci:"+inpBase,
    "--cd:"+borderC,
    "--cs:0 6px 28px "+shadowC,
    "--ct:"+textC,
    "--cu:"+subC,
    "--cm:"+mutedC,
    "--chi:"+hiC,
    "--ca:"+axiC,"--cab:"+axiC,
    "--cn:"+navBg,
    "--cbg:"+grad,
    "--radius:"+r+"px",
    "--nm-bg:"+nmBg,
    "--nm-out:"+nmOut,
    "--nm-in:"+nmIn,
    "--nm-sm-out:"+nmSm,
    "--nm-gap:"+gap+"px",
  ].join(";");
}


// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI COMPONENTS — unified neumorphic surface, no Glass/grain
// ─────────────────────────────────────────────────────────────────────────────

// Card: the ONE container primitive — pure neumorphic, no border
const Card=({children,style={},accent,onClick,inset=false})=>{
  const shadow = inset
    ? "var(--nm-in)"
    : accent
      ? "var(--nm-out), 0 0 0 1px "+accent+"28, 0 0 22px "+accent+"18"
      : "var(--nm-out)";
  return <div onClick={onClick} style={{
    background:"var(--nm-bg)",
    borderRadius:"var(--radius,18px)",
    border:"none",
    boxShadow:shadow,
    transition:"box-shadow .25s ease, margin .2s ease",
    overflow:"visible",
    ...style}}>{children}</div>;
};


// Section divider used inside cards
const CardDivider=()=>(
  <div style={{height:1,background:"var(--cd)",margin:"10px 0",opacity:0.6}}/>
);

const PillBtn=({children,active,color,onClick,style={}})=>(
  <button onClick={onClick} style={{
    padding:"8px 15px",borderRadius:50,border:"none",
    cursor:"pointer",fontSize:13,fontWeight:600,minHeight:38,minWidth:44,
    background:active?(color||ACC.blue):"var(--nm-bg)",
    color:active?"#fff":"var(--cu)",
    boxShadow:active
      ? "inset 3px 3px 8px "+(color||ACC.blue)+"99, inset -2px -2px 6px "+(color||ACC.blue)+"44"
      : "var(--nm-sm-out)",
    transform:active?"translateY(1px)":"none",
    transition:"all .15s ease",...style}}>{children}</button>
);

const BigBtn=({children,color,onClick,style={}})=>(
  <button onClick={onClick} style={{
    padding:"12px 22px",borderRadius:"var(--radius,18px)",border:"none",cursor:"pointer",
    fontSize:14,fontWeight:700,
    background:color||ACC.blue,
    color:"#fff",minHeight:48,
    boxShadow:"5px 5px 14px "+(color||ACC.blue)+"55, -2px -2px 6px rgba(255,255,255,.07), inset 0 1px 0 rgba(255,255,255,.22), inset 0 -2px 0 rgba(0,0,0,.15)",
    backgroundImage:"linear-gradient(160deg,"+(color||ACC.blue)+"ee,"+(color||ACC.blue)+"bb)",
    transition:"all .2s ease",...style}} className="btn-nm">{children}</button>
);


const NumInput=({value,onChange,step=1,min=0,max,label,prefix,suffix})=>(
  <div style={{display:"flex",flexDirection:"column",gap:6}}>
    {label&&<span style={{fontSize:12,color:C.sub,fontWeight:600,letterSpacing:".05em",textTransform:"uppercase"}}>{label}</span>}
    <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--nm-bg)",borderRadius:12,border:"none",padding:"10px 14px",boxShadow:"var(--nm-in)",transition:"box-shadow .2s ease"}}>
      {prefix&&<span style={{color:C.sub,fontSize:15,flexShrink:0}}>{prefix}</span>}
      <input type="number" value={value} min={min} max={max} step={step} onChange={e=>onChange(Number(e.target.value)||0)}
        style={{background:"transparent",border:"none",color:C.text,fontSize:16,fontWeight:600,outline:"none",width:"100%",minWidth:0}}/>
      {suffix&&<span style={{color:C.sub,fontSize:14,flexShrink:0}}>{suffix}</span>}
    </div>
  </div>
);
const Stepper=({value,onChange,step=1,min=0,max,label,format=v=>v})=>(
  <div style={{display:"flex",flexDirection:"column",gap:6}}>
    {label&&<span style={{fontSize:12,color:C.sub,fontWeight:600,letterSpacing:".05em",textTransform:"uppercase"}}>{label}</span>}
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <button onClick={()=>onChange(Math.max(min,value-step))} style={{width:48,height:48,borderRadius:14,border:"none",background:"var(--nm-bg)",color:C.text,fontSize:22,cursor:"pointer",flexShrink:0,boxShadow:"var(--nm-sm-out)"}}>−</button>
      <div style={{flex:1,textAlign:"center",fontSize:18,fontWeight:700,color:C.text,background:"var(--nm-bg)",borderRadius:12,padding:"11px 8px",border:"none",boxShadow:"var(--nm-in)"}}>{format(value)}</div>
      <button onClick={()=>onChange(max!=null?Math.min(max,value+step):value+step)} style={{width:48,height:48,borderRadius:14,border:"none",background:"var(--nm-bg)",color:C.text,fontSize:22,cursor:"pointer",flexShrink:0,boxShadow:"var(--nm-sm-out)"}}>+</button>
    </div>
  </div>
);
// Variance input with typed value + ± buttons
// Uses local raw string state so typing isn't interrupted by re-render
const VarInput=({value,onChange,label})=>{
  const[raw,setRaw]=useState(()=>(value*100).toFixed(1));
  // Sync display when external source (± buttons or presets) changes value
  const prevVal=useRef(value);
  if(prevVal.current!==value){prevVal.current=value;setRaw((value*100).toFixed(1));}
  const commit=str=>{
    const n=parseFloat(str);
    if(!isNaN(n)) onChange(Math.max(0,Math.min(50,n))/100);
  };
  const step=dir=>{
    const next=Math.max(0,Math.min(50,Math.round((value*100+dir*.5)*10)/10));
    onChange(next/100);
  };
  return(
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {label&&<span style={{fontSize:12,color:C.sub,fontWeight:600,letterSpacing:".05em",textTransform:"uppercase"}}>{label}</span>}
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <button onClick={()=>step(-1)}
          style={{width:40,height:40,borderRadius:10,border:"none",background:"var(--nm-bg)",color:C.text,fontSize:18,cursor:"pointer",flexShrink:0,boxShadow:"var(--nm-sm-out)"}}>−</button>
        <div style={{display:"flex",alignItems:"center",gap:4,background:"var(--nm-bg)",borderRadius:10,border:"none",padding:"8px 10px",flex:1,boxShadow:"var(--nm-in)"}}>
          <input type="number" value={raw} min={0} max={50} step={0.5}
            onChange={e=>{setRaw(e.target.value);commit(e.target.value);}}
            onBlur={()=>setRaw((value*100).toFixed(1))}
            style={{background:"transparent",border:"none",color:C.text,fontSize:15,fontWeight:700,outline:"none",width:"100%",textAlign:"center"}}/>
          <span style={{color:C.sub,fontSize:13,flexShrink:0}}>%</span>
        </div>
        <button onClick={()=>step(1)}
          style={{width:40,height:40,borderRadius:10,border:"none",background:"var(--nm-bg)",color:C.text,fontSize:18,cursor:"pointer",flexShrink:0,boxShadow:"var(--nm-sm-out)"}}>+</button>
      </div>
    </div>
  );
};
const SectionPanel=({title,icon,subtitle,accent,children,defaultOpen=true})=>{
  const[open,setOpen]=useState(defaultOpen);
  return(
    <Card style={{marginBottom:"var(--nm-gap,10px)"}} accent={accent}>
      <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",padding:"16px 20px",background:"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:12,textAlign:"left"}}>
        <span style={{fontSize:22}}>{icon}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:16,fontWeight:700,color:C.text,letterSpacing:"-.2px"}}>{title}</div>
          {subtitle&&<div style={{fontSize:13,color:C.sub,marginTop:2}}>{subtitle}</div>}
        </div>
        <span style={{fontSize:13,color:C.muted,transition:"transform .25s",transform:open?"rotate(180deg)":"rotate(0deg)"}}>▼</span>
      </button>
      {open&&<div style={{padding:"0 20px 20px"}}>{children}</div>}
    </Card>
  );
};
const ProgressRing=({pct,color,size=80,stroke=8})=>{
  const r=(size-stroke)/2,circ=2*Math.PI*r;
  return(<svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
    <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(128,128,128,.15)" strokeWidth={stroke}/>
    <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
      strokeDasharray={`${circ*pct/100} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray .55s cubic-bezier(.4,0,.2,1),stroke .4s ease"}}/>
  </svg>);
};
const ChartTip=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return(<div style={{background:"var(--ck)",border:"1px solid var(--cd)",borderRadius:12,padding:"10px 14px"}}>
    <div style={{fontSize:11,color:C.sub,marginBottom:6}}>{label}</div>
    {payload.map((p,i)=><div key={i} style={{fontSize:13,fontWeight:700,color:p.stroke||p.color,marginBottom:2}}>{p.name}: {fmt(p.value)}</div>)}
  </div>);
};

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTS PANEL with trend toggle + reorder
// ─────────────────────────────────────────────────────────────────────────────
const ACCT_DEFS={
  mort: {label:"Mortgage",      icon:"🏠",color:ACC.red,    invert:true, rate:null},
  chk:  {label:"Checking",      icon:"💳",color:ACC.yellow, invert:false,rate:null},
  sav:  {label:"Savings",       icon:"🏦",color:ACC.green,  invert:false,rate:SAV_R*12},
  ret:  {label:"Retirement",    icon:"📈",color:ACC.purple, invert:false,rate:RET_R*12},
  em:   {label:"Emergency Fund",icon:"🛡",color:ACC.red,    invert:false,rate:FUND_R*12},
  sv:   {label:"Sm. Vacation",  icon:"✈",color:ACC.teal,   invert:false,rate:FUND_R*12},
  lv:   {label:"Lg. Vacation",  icon:"🌴",color:ACC.blue,   invert:false,rate:FUND_R*12},
  inv:  {label:"Investment",    icon:"💹",color:"#30D158",  invert:false,rate:null},
  eq:   {label:"Home Equity",   icon:"🔑",color:ACC.orange, invert:false,rate:null},
};

function AccountsPanel({sim,cfg,order,setOrder,trendMode,setTrendMode,mobile=false}){
  const hist=sim.hist;
  const prev=hist.length>=2?hist[hist.length-2]:null;
  const equity=cfg.homePrice-sim.mort;
  const getVal=k=>k==="eq"?equity:sim[k]??0;
  const getPrev=k=>{if(!prev)return null;return k==="eq"?(cfg.homePrice-(prev.mort||0)):(prev[k]??null);};
  // Guard: ensure every ACCT_DEFS key appears in order (catches any dropped keys)
  const fullOrder=useMemo(()=>{
    const present=new Set(order);
    const missing=Object.keys(ACCT_DEFS).filter(k=>!present.has(k));
    return missing.length?[...order,...missing]:order;
  },[order]);
  const move=(i,dir)=>{
    const n=[...fullOrder];const j=i+dir;
    if(j<0||j>=n.length)return;
    [n[i],n[j]]=[n[j],n[i]];setOrder(n);
  };
  return(
    <Card style={{marginBottom:"var(--nm-gap,10px)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px 10px"}}>
        <div style={{fontSize:15,fontWeight:700,color:C.text}}>Account Balances</div>
        <div style={{display:"flex",background:"var(--nm-bg)",borderRadius:50,padding:3,gap:2,boxShadow:"var(--nm-in)"}}>
          {["$","% avg"].map(m=>(
            <button key={m} onClick={()=>setTrendMode(m)} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,background:"var(--nm-bg)",color:trendMode===m?C.text:C.sub,boxShadow:trendMode===m?"var(--nm-out)":"none",borderRadius:50,transition:"all .15s ease"}}>{m}</button>
          ))}
        </div>
      </div>
      <div style={{padding:"0 12px 14px",display:"flex",flexDirection:"column",gap:"var(--nm-gap,10px)"}}>
        {fullOrder.map((key,i)=>{
          const def=ACCT_DEFS[key];if(!def)return null;
          const val=getVal(key),pv=getPrev(key);
          const delta=pv!=null?val-pv:0;
          const isGood=def.invert?(delta<=0):(delta>=0);
          const tc=delta===0?C.muted:isGood?ACC.green:ACC.red;
          const arrow=delta===0?"→":delta>0?"↑":"↓";
          let trend;
          if(trendMode==="$"){trend=delta===0?"—":`${delta>0?"+":""}${fmt(delta)}`;}
          else{if(def.rate!=null)trend=`${(def.rate*100).toFixed(1)}%/yr`;
            else if(pv&&Math.abs(pv)>1){const p=((val-pv)/Math.abs(pv))*100;trend=`${p>=0?"+":""}${p.toFixed(2)}%`;}
            else trend="—";}
          return(
            <div key={key} className="sim-row" style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",borderRadius:14,background:"var(--nm-bg)",boxShadow:"var(--nm-sm-out)",border:"none",borderRadius:14}}>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <button onClick={()=>move(i,-1)} style={{width:20,height:20,border:"none",background:"transparent",color:C.muted,cursor:"pointer",fontSize:11,lineHeight:1,padding:0}}>▲</button>
                <button onClick={()=>move(i,1)}  style={{width:20,height:20,border:"none",background:"transparent",color:C.muted,cursor:"pointer",fontSize:11,lineHeight:1,padding:0}}>▼</button>
              </div>
              <span style={{fontSize:20,flexShrink:0}}>{def.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:C.sub,fontWeight:600,marginBottom:1}}>{def.label}</div>
                <div style={{fontSize:19,fontWeight:800,color:def.color,letterSpacing:"-.4px",lineHeight:1}}>{fmt(val)}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:20,fontWeight:800,color:tc,lineHeight:1,marginBottom:2}}>{arrow}</div>
                <div style={{fontSize:12,fontWeight:700,color:tc,whiteSpace:"nowrap"}}>{trend}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP TAB
// ─────────────────────────────────────────────────────────────────────────────
const DEF_SETUP_ORDER=["starting","income","home","expenses","savings","retirement","investment","emergency"];

function SetupTab({cfg,setCfg,sim,onStart,onReset,derived,setupOrder,setSetupOrder,winW}){
  const{pi,loan,rMo,rAnn,aTax,tGross,mNet,tHouse,expBase,allFunds,leftover,pmiActive,ltv}=derived;
  const upd=(k,v)=>setCfg(p=>({...p,[k]:typeof v==="string"?v:Number(v)||0}));
  const updExp=(k,v)=>setCfg(p=>({...p,expenses:{...p.expenses,[k]:Number(v)||0}}));
  const updEmerg=(id,field,val)=>setCfg(p=>({...p,emergEvents:p.emergEvents.map(e=>e.id===id?{...e,[field]:typeof val==="number"?val:Number(val)||0}:e)}));
  const moveSection=(i,dir)=>{const n=[...setupOrder];const j=i+dir;if(j<0||j>=n.length)return;[n[i],n[j]]=[n[j],n[i]];setSetupOrder(n);};

  const inc1Annual=getIncome(cfg,1), inc2Annual=getIncome(cfg,2);

  const SECTIONS={
    home:(
      <SectionPanel key="home" title="Home & Mortgage" icon="🏠" accent={ACC.orange}
        subtitle={`${fmt(cfg.homePrice)} · ${(cfg.mortRate||6.8).toFixed(2)}% · P&I ${fmt(pi)}/mo`}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--nm-gap,10px)",marginBottom:"var(--nm-gap,10px)"}}>
          <NumInput label="Home Price" value={cfg.homePrice} onChange={v=>upd('homePrice',v)} step={1000} min={50000} prefix="$"/>
          <NumInput label="Down Payment" value={cfg.downPayment} onChange={v=>upd('downPayment',v)} step={1000} min={0} max={cfg.homePrice} prefix="$"/>
          <NumInput label="Closing Cost %" value={cfg.closingCost||3} onChange={v=>upd('closingCost',Math.max(0,Math.round(v*100)/100))} step={0.25} min={0} max={10} suffix="%"/>
          <NumInput label="HOA / mo" value={cfg.hoaMo||0} onChange={v=>upd('hoaMo',v)} step={10} min={0} prefix="$"/>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          {[180,200,220,230,240,250,260,275].map(p=><PillBtn key={p} active={cfg.homePrice===p*1000} color={ACC.orange} onClick={()=>upd('homePrice',p*1000)}>${p}k</PillBtn>)}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10,alignItems:"center"}}>
          <span style={{fontSize:13,color:C.sub}}>Down:</span>
          {[10,20,30,40,50,60,70,80].map(d=><PillBtn key={d} active={cfg.downPayment===d*1000} color={ACC.teal} onClick={()=>upd('downPayment',d*1000)}>${d}k</PillBtn>)}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10,alignItems:"center"}}>
          <span style={{fontSize:13,color:C.sub}}>Closing:</span>
          {[1,2,2.5,3,4,5].map(v=><PillBtn key={v} active={Math.abs((cfg.closingCost||3)-v)<0.01} color={ACC.orange} onClick={()=>upd('closingCost',v)}>{v}%</PillBtn>)}
        </div>
        <div style={{marginBottom:18,fontSize:11,color:C.muted}}>{`Closing costs: ${fmt(Math.round((cfg.homePrice||0)*(cfg.closingCost||3)/100))} · deducted from checking at start`}</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18,alignItems:"center"}}>
          <span style={{fontSize:13,color:C.sub}}>HOA:</span>
          {[0,50,100,150,200,300].map(v=><PillBtn key={v} active={(cfg.hoaMo||0)===v} color={ACC.purple} onClick={()=>upd('hoaMo',v)}>{v===0?"None":fmt(v)}</PillBtn>)}
        </div>
        <div style={{background:"var(--nm-bg)",borderRadius:14,padding:"12px 16px",marginBottom:18,display:"grid",gridTemplateColumns:winW<600?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:10}}>
          <div><div style={{fontSize:11,color:C.sub}}>Loan</div><div style={{fontSize:16,fontWeight:700,color:ACC.orange}}>{fmt(loan)}</div></div>
          <div><div style={{fontSize:11,color:C.sub}}>LTV</div><div style={{fontSize:16,fontWeight:700,color:pmiActive?ACC.red:ACC.green}}>{ltv}%</div></div>
          <div><div style={{fontSize:11,color:C.sub}}>PMI</div><div style={{fontSize:16,fontWeight:700,color:pmiActive?ACC.red:ACC.green}}>{pmiActive?"Active":"None"}</div></div>
          <div><div style={{fontSize:11,color:C.sub}}>HOA/mo</div><div style={{fontSize:16,fontWeight:700,color:(cfg.hoaMo||0)>0?ACC.orange:C.muted}}>{(cfg.hoaMo||0)===0?"None":fmt(cfg.hoaMo)}</div></div>
        </div>
        <Stepper label="Mortgage Rate" value={cfg.mortRate||6.8} onChange={v=>upd('mortRate',v)} step={0.05} min={1} max={20} format={v=>`${Number(v).toFixed(2)}%`}/>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12,marginBottom:18}}>
          {[5.0,5.5,6.0,6.5,6.8,7.0,7.5,8.0].map(r=><PillBtn key={r} active={(cfg.mortRate||6.8)===r} color={ACC.teal} onClick={()=>upd('mortRate',r)}>{r.toFixed(1)}%</PillBtn>)}
        </div>
        <Stepper label="Extra Payment / mo" value={cfg.extraPmt} onChange={v=>upd('extraPmt',v)} step={25} min={0} format={fmt}/>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12,marginBottom:18}}>
          {[0,100,250,500,1000].map(v=><PillBtn key={v} active={cfg.extraPmt===v} color={ACC.orange} onClick={()=>upd('extraPmt',v)}>{v===0?"Off":fmt(v)}</PillBtn>)}
        </div>
        <Stepper label="Homeowner's Insurance Rate" value={cfg.homeIns||1.25} onChange={v=>upd('homeIns',Math.max(0,Math.round(v*100)/100))} step={0.05} min={0} max={5} format={v=>`${Number(v).toFixed(2)}%/yr`}/>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
          {[0.88,1.00,1.25,1.50,1.75,2.00].map(r=><PillBtn key={r} active={Math.abs((cfg.homeIns||1.25)-r)<0.01} color={ACC.orange} onClick={()=>upd('homeIns',r)}>{r.toFixed(2)}%</PillBtn>)}
        </div>
        <div style={{marginTop:8,fontSize:11,color:C.muted}}>TX avg ~1.25–1.75% · National avg ~0.88% · High-risk areas 2%+</div>
      </SectionPanel>
    ),
    income:(
      <SectionPanel key="income" title="Income" icon="💰" accent={ACC.yellow}
        subtitle={`Joseph ${fmt(inc1Annual)}/yr · Torrey ${fmt(inc2Annual)}/yr`}>
        {[{n:1,name:"Joseph"},{n:2,name:"Torrey"}].map(({n,name})=>{
          const mode=cfg[`inc${n}Mode`]||"annual";
          return(
            <div key={n} style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:15,fontWeight:700,color:C.text}}>{name}'s Income</div>
                <div style={{display:"flex",background:"var(--nm-bg)",borderRadius:50,padding:3,gap:2,boxShadow:"var(--nm-in)"}}>
                  {["annual","hourly"].map(m=>(
                    <button key={m} onClick={()=>upd(`inc${n}Mode`,m)} style={{padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,background:mode===m?"var(--nm-bg)":"transparent",color:mode===m?C.text:C.sub,transition:"all .15s"}}>{m==="annual"?"$/yr":"$/hr"}</button>
                  ))}
                </div>
              </div>
              {mode==="annual"?(
                <div>
                  <NumInput label="Annual Salary" value={cfg[`income${n}`]||0} onChange={v=>upd(`income${n}`,v)} step={1000} prefix="$" suffix="/yr"/>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                    {[40,50,55,60,65,70,75,80,90,100].map(k=><PillBtn key={k} active={(cfg[`income${n}`]||0)===k*1000} color={ACC.yellow} onClick={()=>upd(`income${n}`,k*1000)} style={{padding:"8px 12px",fontSize:13,minHeight:42}}>${k}k</PillBtn>)}
                  </div>
                </div>
              ):(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--nm-gap,10px)"}}>
                  <NumInput label="Hourly Rate" value={cfg[`inc${n}Hr`]||0} onChange={v=>upd(`inc${n}Hr`,v)} step={0.25} prefix="$" suffix="/hr"/>
                  <NumInput label="Hours / week" value={cfg[`inc${n}Hrs`]||40} onChange={v=>upd(`inc${n}Hrs`,v)} step={1} min={0} max={80} suffix="hrs"/>
                  <div style={{gridColumn:"span 2",background:"var(--nm-bg)",borderRadius:12,padding:"10px 14px",fontSize:13,color:C.sub}}>
                    = {fmt(getIncome({...cfg,[`inc${n}Mode`]:"hourly",[`inc${n}Hr`]:cfg[`inc${n}Hr`]||0,[`inc${n}Hrs`]:cfg[`inc${n}Hrs`]||40},n))}/yr · {fmt(getIncome({...cfg,[`inc${n}Mode`]:"hourly",[`inc${n}Hr`]:cfg[`inc${n}Hr`]||0,[`inc${n}Hrs`]:cfg[`inc${n}Hrs`]||40},n)/12)}/mo gross
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <Card style={{padding:"14px 16px"}} accent={ACC.yellow}>
          <div style={{fontSize:12,color:C.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",marginBottom:10}}>Monthly Cashflow</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--nm-gap,10px)",fontSize:13}}>
            {[["Gross/mo",fmt((inc1Annual+inc2Annual)/12),C.text],["Fed Tax",`-${fmt(aTax/12)}`,ACC.red],["Retirement",`-${fmt(rMo)}`,ACC.purple],["Net",fmt(mNet),ACC.green],["Housing",`-${fmt(tHouse)}`,ACC.orange],["Expenses",`~-${fmt(expBase)}`,ACC.orange],["Funds",`-${fmt(allFunds)}`,ACC.blue],["Free",`${leftover>=0?"+":""}${fmt(leftover)}`,leftover>=0?ACC.green:ACC.red]].map(([l,v,co])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid var(--cd)"}}>
                <span style={{color:C.sub}}>{l}</span><span style={{fontWeight:700,color:co}}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </SectionPanel>
    ),
    expenses:(
      <SectionPanel key="expenses" title="Monthly Expenses" icon="🧾" accent={ACC.orange} defaultOpen={false}
        subtitle={`~${fmt(expBase)}/mo base · seasonal + randomized`}>
        {Object.entries(EXP_DEFS).map(([key,def])=>{
          const cm=(2+sim.mo)%12,sm=def.season?SEASONAL[def.season][cm]:1;
          const cur=cfg.expenses?.[key]??def.base,curR=cfg.expenses?.[`${key}_r`]??def.rnd;
          return(
            <div key={key} style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <span style={{fontSize:20}}>{def.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:700,color:C.text}}>{def.label}</div>
                  {def.season&&<div style={{fontSize:11,color:sm>1.05?ACC.orange:sm<0.95?ACC.green:C.sub}}>This month: {sm>1?`▲ ${((sm-1)*100).toFixed(0)}% higher`:`▼ ${((1-sm)*100).toFixed(0)}% lower`}</div>}
                </div>
                <div style={{fontSize:16,fontWeight:800,color:C.text}}>{fmt(cur)}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <NumInput label="Base / mo" value={cur} onChange={v=>updExp(key,v)} step={5} prefix="$"/>
                <VarInput label="Variance" value={curR} onChange={v=>updExp(`${key}_r`,v)}/>
              </div>
            </div>
          );
        })}
        <div style={{background:"rgba(255,159,10,.08)",borderRadius:12,padding:"10px 14px",fontSize:12,color:C.sub}}>
          ⚡ Electric +40% Jul · 🔥 Gas +50% Jan · 🛒 Groceries +10% Dec · Variance % randomizes each tick
        </div>
      </SectionPanel>
    ),
    savings:(
      <SectionPanel key="savings" title="Savings & Funds" icon="🏦" accent={ACC.green} defaultOpen={false}
        subtitle={`${fmt(cfg.savMo+cfg.emMo+cfg.svMo+cfg.lvMo)}/mo total`}>
        {[
          {k:"savMo",ik:"savInit",label:"High-Yield Savings",icon:"🏦",color:ACC.green, rate:"4.5% APY",presets:[0,100,200,400,600],target:null},
          {k:"emMo", ik:"emInit", label:"Emergency Fund",    icon:"🛡",color:ACC.red,   rate:"4% APY",  presets:[0,50,100,200,300],target:null},
          {k:"svMo", ik:"svInit", label:"Small Vacation",    icon:"✈",color:ACC.teal,  rate:"4% APY",  presets:[0,25,50,75,100],  target:"svTarget"},
          {k:"lvMo", ik:"lvInit", label:"Large Vacation",    icon:"🌴",color:ACC.blue,  rate:"4% APY",  presets:[0,50,100,150,200], target:"lvTarget"},
        ].map(f=>(
          <div key={f.k} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <span style={{fontSize:20}}>{f.icon}</span>
              <div style={{flex:1}}><div style={{fontSize:15,fontWeight:700,color:C.text}}>{f.label}</div><div style={{fontSize:12,color:C.sub}}>{f.rate}{f.target?" · auto-empties when target hit":""}</div></div>
              <div style={{fontSize:15,fontWeight:700,color:f.color}}>{fmt(cfg[f.k])}/mo</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:f.target?"1fr 1fr 1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <NumInput label="Monthly" value={cfg[f.k]} onChange={v=>upd(f.k,v)} step={25} prefix="$"/>
              <NumInput label="Starting" value={cfg[f.ik]||0} onChange={v=>upd(f.ik,v)} step={100} prefix="$"/>
              {f.target&&<NumInput label="Trip Target 🎯" value={cfg[f.target]||0} onChange={v=>upd(f.target,Math.max(1,v))} step={250} prefix="$"/>}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {f.presets.map(v=><PillBtn key={v} active={cfg[f.k]===v} color={f.color} onClick={()=>upd(f.k,v)} style={{padding:"8px 14px",fontSize:13,minHeight:42}}>{v===0?"Off":fmt(v)}</PillBtn>)}
            </div>
          </div>
        ))}
      </SectionPanel>
    ),
    retirement:(
      <SectionPanel key="retirement" title="Retirement 401k" icon="📈" accent={ACC.purple} defaultOpen={false}
        subtitle={`${cfg.retPct}% of gross · 7% avg growth`}>
        <Stepper label="Contribution %" value={cfg.retPct} onChange={v=>upd('retPct',v)} step={0.5} min={0} max={25} format={v=>`${Number(v).toFixed(1)}%`}/>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12,marginBottom:18}}>
          {[3,4,5,6,8,10,12,15].map(v=><PillBtn key={v} active={cfg.retPct===v} color={ACC.purple} onClick={()=>upd('retPct',v)}>{v}%</PillBtn>)}
        </div>
        <NumInput label="Starting 401k Balance" value={cfg.retInit||0} onChange={v=>upd('retInit',v)} step={500} prefix="$"/>
        <div style={{background:"rgba(191,90,242,.08)",borderRadius:12,padding:"10px 14px",fontSize:13,color:C.sub,marginTop:14}}>
          Pre-tax contribution reduces taxable income. Monthly: {fmt(rMo)} · Annual: {fmt(rAnn)}
        </div>
      </SectionPanel>
    ),
    investment:(
      <SectionPanel key="investment" title="Investment Account (S&P 500)" icon="💹" accent="#30D158"
        subtitle={`${fmt(cfg.invMo)}/mo · ~10% avg annual · simulated market cycles`} defaultOpen={false}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--nm-gap,10px)",marginBottom:"var(--nm-gap,10px)"}}>
          <NumInput label="Monthly Contribution" value={cfg.invMo||0} onChange={v=>upd('invMo',v)} step={25} prefix="$"/>
          <NumInput label="Starting Balance" value={cfg.invInit||0} onChange={v=>upd('invInit',v)} step={500} prefix="$"/>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[0,50,100,200,500,1000].map(v=><PillBtn key={v} active={cfg.invMo===v} color={ACC.green} onClick={()=>upd('invMo',v)} style={{padding:"8px 14px",fontSize:13,minHeight:42}}>{v===0?"Off":fmt(v)}</PillBtn>)}
        </div>
        <div style={{background:"rgba(48,209,88,.08)",borderRadius:12,padding:"10px 14px",fontSize:12,color:C.sub,marginTop:14}}>
          📉 Market corrections trigger every 24–48 months (-2% to -5%/mo for 4–10 months). Base return ~10%/yr with ±4% monthly variance (Box-Muller).
        </div>
      </SectionPanel>
    ),
    emergency:(
      <SectionPanel key="emergency" title="Emergency Events" icon="⚠️" accent={ACC.red}
        subtitle={`${cfg.emergPerYear} events/yr · ${cfg.emergChance}% chance each`} defaultOpen={false}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--nm-gap,10px)",marginBottom:"var(--nm-gap,10px)"}}>
          <Stepper label="Events per year" value={cfg.emergPerYear||0} onChange={v=>upd('emergPerYear',v)} step={1} min={0} max={12} format={v=>`${v}`}/>
          <Stepper label="Occurrence chance %" value={cfg.emergChance||0} onChange={v=>upd('emergChance',v)} step={5} min={0} max={100} format={v=>`${v}%`}/>
        </div>
        <div style={{background:"var(--nm-bg)",borderRadius:12,padding:"10px 14px",fontSize:12,color:C.sub,marginBottom:14}}>
          Avg events/mo: ~{((cfg.emergPerYear||0)*(cfg.emergChance||0)/100/12).toFixed(2)} · Each event has a 24-month cooldown before repeating.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"var(--nm-gap,10px)"}}>
          {(cfg.emergEvents||[]).map(ev=>(
            <div key={ev.id} style={{display:"grid",gridTemplateColumns:"auto 1fr auto",gap:10,alignItems:"center",padding:"10px 12px",background:"var(--nm-bg)",borderRadius:14,border:"1px solid var(--cd)"}}>
              <span style={{fontSize:20}}>{ev.icon}</span>
              <div style={{fontSize:14,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.name}</div>
              <NumInput label="" value={ev.cost} onChange={v=>updEmerg(ev.id,'cost',v)} step={50} prefix="$"/>
            </div>
          ))}
        </div>
      </SectionPanel>
    ),
    starting:(
      <SectionPanel key="starting" title="Starting Balances & Caps" icon="⚙️" defaultOpen={true}
        subtitle="Initial values and account overflow caps">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--nm-gap,10px)",marginBottom:"var(--nm-gap,10px)"}}>
          <NumInput label="Checking Start" value={cfg.chkInit} onChange={v=>upd('chkInit',v)} step={500} prefix="$"/>
          <NumInput label="Savings Start" value={cfg.savInit||0} onChange={v=>upd('savInit',v)} step={500} prefix="$"/>
        </div>
        <div style={{background:"var(--nm-bg)",borderRadius:12,padding:"10px 14px",fontSize:12,color:C.sub,marginBottom:14}}>
          🪣 Account caps: any balance over the limit auto-transfers to Savings
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--nm-gap,10px)"}}>
          <NumInput label="Checking Cap 💳" value={cfg.chkCap||0} onChange={v=>upd('chkCap',v)} step={1000} prefix="$"/>
          <NumInput label="Emergency Cap 🛡" value={cfg.emCap||0} onChange={v=>upd('emCap',v)} step={500} prefix="$"/>
        </div>
      </SectionPanel>
    ),
  };

  return(
    <div style={{padding:"0 24px 32px",maxWidth:860,margin:"0 auto"}}>

      <div style={{marginBottom:8,fontSize:12,color:C.muted}}>Drag ▲▼ to reorder sections</div>
      <div style={{display:"flex",flexDirection:"column",gap:"var(--nm-gap,10px)",alignItems:"stretch"}}>
      {setupOrder.map((key,i)=>(
        <div key={key} style={{position:"relative"}}>
          <div style={{position:"absolute",top:12,right:56,zIndex:10,display:"flex",gap:4}}>
            <button onClick={()=>moveSection(i,-1)} style={{width:28,height:28,borderRadius:8,border:"1px solid var(--cd)",background:"var(--ci)",color:C.muted,cursor:"pointer",fontSize:12}}>▲</button>
            <button onClick={()=>moveSection(i,1)}  style={{width:28,height:28,borderRadius:8,border:"1px solid var(--cd)",background:"var(--ci)",color:C.muted,cursor:"pointer",fontSize:12}}>▼</button>
          </div>
          {SECTIONS[key]}
        </div>
      ))}
    </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART LINE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
const CHART_LINES=[
  {k:"chk", label:"Checking",   color:ACC.yellow},
  {k:"sav", label:"Savings",    color:ACC.green},
  {k:"ret", label:"Retirement", color:ACC.purple},
  {k:"em",  label:"Emergency",  color:ACC.red},
  {k:"sv",  label:"Sm. Vac",    color:ACC.teal},
  {k:"lv",  label:"Lg. Vac",    color:ACC.blue},
  {k:"inv", label:"Investment",  color:"#30D158"},
];


// ─────────────────────────────────────────────────────────────────────────────
// EXPENSE CHART LINES
// ─────────────────────────────────────────────────────────────────────────────
const EXP_LINES=[
  {k:"eEl",   label:"Electric",  color:"#FFD60A"},
  {k:"eGas",  label:"Gas/Heat",  color:"#FF9F0A"},
  {k:"eGro",  label:"Groceries", color:"#30D158"},
  {k:"eDin",  label:"Dining",    color:"#FF6B35"},
  {k:"eInt",  label:"Internet",  color:"#5AC8FA"},
  {k:"eTra",  label:"Transport", color:"#0A84FF"},
  {k:"eHlth", label:"Health",    color:"#BF5AF2"},
  {k:"eMisc", label:"Misc",      color:"#FF453A"},
  {k:"eSav",  label:"To Savings",color:"#64D2FF"},
];

const CHART_TYPES=[
  ["networth","📈 Net Worth"],
  ["mortgage","🏠 Mortgage"],
  ["accounts","💰 Accounts"],
  ["expenses","💸 Expenses"],
  ["balances","📊 Bar"],
];

// ─────────────────────────────────────────────────────────────────────────────
// ZOOM LEVELS & INTERPOLATION
// ─────────────────────────────────────────────────────────────────────────────
const ZOOM_LEVELS=[
  {k:"1D", label:"1D", stepsPerMonth:30},
  {k:"1W", label:"1W", stepsPerMonth:4},
  {k:"2W", label:"2W", stepsPerMonth:2},
  {k:"1M", label:"1M", stepsPerMonth:1},
  {k:"3M", label:"3M", stepsPerMonth:1/3},
  {k:"6M", label:"6M", stepsPerMonth:1/6},
  {k:"1Y", label:"1Y", stepsPerMonth:1/12},
];

const MAX_CHART_PTS=400;

function zoomInterpolate(hist,zoom){
  if(!hist||hist.length===0)return hist;
  const z=ZOOM_LEVELS.find(l=>l.k===zoom)||ZOOM_LEVELS[3];
  const spm=z.stepsPerMonth;

  if(spm<=1){
    // Coarse: every N months
    const step=Math.max(1,Math.round(1/spm));
    const out=hist.filter((_,i)=>i===0||i===hist.length-1||i%step===0);
    return out;
  }

  // Fine: interpolate between monthly points
  const steps=Math.round(spm);
  const raw=[];
  for(let i=0;i<hist.length-1;i++){
    const a=hist[i],b=hist[i+1];
    for(let s=0;s<steps;s++){
      const t=s/steps;
      const pt={...a};
      for(const k of Object.keys(a)){
        if(typeof a[k]==="number"&&typeof b[k]==="number"){
          pt[k]=a[k]+(b[k]-a[k])*t;
        }
      }
      // sub-label: show week within month
      if(steps>1) pt.lbl=s===0?a.lbl:`···`;
      raw.push(pt);
    }
  }
  raw.push(hist[hist.length-1]);

  // Cap to MAX_CHART_PTS
  if(raw.length>MAX_CHART_PTS){
    const st=Math.ceil(raw.length/MAX_CHART_PTS);
    return raw.filter((_,i)=>i===0||i===raw.length-1||i%st===0);
  }
  return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART WINDOW — switchable, no collapse, fills assigned height
// ─────────────────────────────────────────────────────────────────────────────
function ChartWindow({chartData,barData,histData,defaultType,pfx,height,hideRet}){
  const[type,setType]=useState(defaultType||"networth");
  const[sel,setSel]=useState(()=>{const s=new Set(CHART_LINES.map(l=>l.k));if(hideRet)s.delete("ret");return s;});
  const[expSel,setExpSel]=useState(()=>new Set(["exp"]));
  const[barSel,setBarSel]=useState(()=>new Set(ACCT_BAR_KEYS));
  const[zoom,setZoom]=useState("1M");
  const[zoomAnimating,setZoomAnimating]=useState(false);
  const p=pfx||"a";

  // X-axis label formatter based on zoom
  const xFmt=useCallback((mo)=>{
    if(mo==null||isNaN(mo))return"";
    const moInt=Math.round(mo);
    const yr=Math.floor(moInt/12)+1;
    const mo12=moInt%12;
    const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if(zoom==="1Y") return "Y"+yr;
    if(zoom==="6M"){ if(moInt%6!==0)return""; return (moInt%12<6?"H1 ":"H2 ")+"Y"+yr; }
    if(zoom==="3M"){ if(moInt%3!==0)return""; return "Q"+(Math.floor(mo12/3)+1)+" Y"+yr; }
    if(zoom==="1M") return MON[mo12]+" Y"+yr;
    const wk=Math.round(moInt*WEEKS_PER_MO);
    if(zoom==="2W"){ return wk%2===0?"W"+wk+" Y"+yr:""; }
    if(zoom==="1W") return "W"+wk+" Y"+yr;
    if(zoom==="1D"){ const day=Math.round((mo-Math.floor(mo))*30)+1; return day===1?MON[mo12]+"1 Y"+yr:""; }
    return MON[mo12]+" Y"+yr;
  },[zoom]);

  // Zoom-interpolated data
  const raw=histData||chartData;
  const zoomedData=useMemo(()=>zoomInterpolate(raw,zoom),[raw,zoom]);

  // Animate on zoom change
  const prevZoomRef=useRef(zoom);
  useEffect(()=>{
    if(zoom!==prevZoomRef.current){
      prevZoomRef.current=zoom;
      setZoomAnimating(true);
      const t=setTimeout(()=>setZoomAnimating(false),700);
      return()=>clearTimeout(t);
    }
  },[zoom]);

  // Only animate when a genuinely new data point arrives, not on every re-render
  const prevChartLen=useRef(chartData.length);
  const prevBarLen=useRef(barData.length);
  const newChartPoint=chartData.length>prevChartLen.current;
  const newBarPoint=barData.length>prevBarLen.current;
  useEffect(()=>{ prevChartLen.current=chartData.length; },[chartData.length]);
  useEffect(()=>{ prevBarLen.current=barData.length; },[barData.length]);
  const chartAnim=newChartPoint||zoomAnimating;
  const barAnim=newBarPoint||zoomAnimating;

  const toggleAcct=k=>setSel(prev=>{const n=new Set(prev);n.has(k)?n.delete(k):n.add(k);return n;});
  const toggleExp =k=>setExpSel(prev=>{const n=new Set(prev);n.has(k)?n.delete(k):n.add(k);return n;});
  const toggleBar =k=>setBarSel(prev=>{const n=new Set(prev);n.has(k)?n.delete(k):n.add(k);return n;});

  const yDomain=useMemo(()=>{
    if(type!=="accounts"||!sel.size)return["auto","auto"];
    let mn=Infinity,mx=-Infinity;
    for(const d of zoomedData){for(const k of sel){const v=d[k]??0;if(v>mx)mx=v;if(v<mn)mn=v;}}
    return mn===Infinity?[0,100]:[Math.min(0,mn*1.05),(mx||100)*1.1];
  },[zoomedData,sel,type]);

  const allExpLines=[{k:"exp",label:"Total",color:ACC.orange},...EXP_LINES];
  // Reserve px for type pills + optional toggles row
  const PILL_H=36, TOGGLE_H=34;
  const hasToggles=(type==="accounts"||type==="expenses"||type==="balances");
  const chartH=Math.max(80,(height||220)-PILL_H-(hasToggles?TOGGLE_H:0)-8);
  const filteredBar=barData.filter(b=>barSel.has(b.key));

  return(
    <div style={{height:height||220,display:"flex",flexDirection:"column"}}>
      {/* Type pills + zoom pills on same row */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:4,flexShrink:0,padding:"4px 0 4px",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:3,flexWrap:"wrap"}}>
          {CHART_TYPES.map(([k,l])=>(
            <button key={k} onClick={()=>setType(k)} style={{padding:"4px 8px",borderRadius:7,border:"none",cursor:"pointer",
              background:type===k?ACC.blue+"33":"transparent",color:type===k?ACC.blue:C.sub,fontSize:11,fontWeight:700,whiteSpace:"nowrap",transition:"all .12s"}}>{l}</button>
          ))}
        </div>
        {/* Zoom pills */}
        <div style={{display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
          {ZOOM_LEVELS.map(z=>(
            <button key={z.k} onClick={()=>setZoom(z.k)} style={{
              padding:"3px 6px",borderRadius:6,border:"none",cursor:"pointer",
              background:zoom===z.k?ACC.teal+"33":"transparent",
              color:zoom===z.k?ACC.teal:C.muted,
              fontSize:10,fontWeight:700,transition:"all .12s",letterSpacing:".02em"}}>{z.label}</button>
          ))}
        </div>
      </div>

      {/* Toggle row */}
      {type==="accounts"&&(
        <div style={{display:"flex",gap:3,flexWrap:"wrap",flexShrink:0,marginBottom:4}}>
          {CHART_LINES.map(l=>(
            <button key={l.k} onClick={()=>toggleAcct(l.k)} style={{padding:"2px 7px",borderRadius:6,
              border:`1px solid ${sel.has(l.k)?l.color:"var(--cd)"}`,background:sel.has(l.k)?l.color+"22":"transparent",
              color:sel.has(l.k)?l.color:C.sub,fontSize:11,fontWeight:600,cursor:"pointer"}}>{l.label}</button>
          ))}
        </div>
      )}
      {type==="expenses"&&(
        <div style={{display:"flex",gap:3,flexWrap:"wrap",flexShrink:0,marginBottom:4}}>
          {allExpLines.map(l=>(
            <button key={l.k} onClick={()=>toggleExp(l.k)} style={{padding:"2px 7px",borderRadius:6,
              border:`1px solid ${expSel.has(l.k)?l.color:"var(--cd)"}`,background:expSel.has(l.k)?l.color+"22":"transparent",
              color:expSel.has(l.k)?l.color:C.sub,fontSize:11,fontWeight:600,cursor:"pointer"}}>{l.label}</button>
          ))}
        </div>
      )}
      {type==="balances"&&(
        <div style={{display:"flex",gap:3,flexWrap:"wrap",flexShrink:0,marginBottom:4}}>
          {ACCT_BAR_CFG.map(a=>(
            <button key={a.key} onClick={()=>toggleBar(a.key)} style={{padding:"2px 7px",borderRadius:6,
              border:`1px solid ${barSel.has(a.key)?a.color:"var(--cd)"}`,background:barSel.has(a.key)?a.color+"22":"transparent",
              color:barSel.has(a.key)?a.color:C.sub,fontSize:11,fontWeight:600,cursor:"pointer"}}>{a.label}</button>
          ))}
        </div>
      )}

      {/* Chart fills remaining space */}
      <div style={{flex:1,minHeight:0}}>
        {/* BAR */}
        <div style={{display:type==="balances"?"block":"none",height:"100%"}}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredBar} margin={{top:4,right:4,left:4,bottom:26}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.08)"/>
              <XAxis dataKey="name" tick={{fill:"var(--ca)",fontSize:9}} angle={-20} textAnchor="end" interval={0}/>
              <YAxis tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={40}/>
              <Tooltip content={<ChartTip/>}/>
              <Bar dataKey="value" radius={[4,4,0,0]} isAnimationActive={barAnim} animationDuration={600} animationEasing="ease-out" minPointSize={4}>
                {filteredBar.map((e,i)=><Cell key={i} fill={e.color}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* MORTGAGE */}
        <div style={{display:type==="mortgage"?"flex":"none",flexDirection:"column",height:"100%"}}>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:5,flexShrink:0}}>
            {[[ACC.red,"Loan Balance"],[ACC.orange,"Interest Paid"],[ACC.green,"Principal Paid"]].map(([co,lb])=>(
              <div key={lb} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:co,flexShrink:0}}/>
                <span style={{fontSize:10,color:C.sub,fontWeight:600}}>{lb}</span>
              </div>
            ))}
          </div>
          <div style={{flex:1,minHeight:0}}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={zoomedData} margin={{top:4,right:4,left:4,bottom:5}}>
                <defs>{[[`${p}mBal`,ACC.red],[`${p}mInt`,ACC.orange],[`${p}mPri`,ACC.green]].map(([id,co])=>(
                  <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={co} stopOpacity={0.22}/><stop offset="95%" stopColor={co} stopOpacity={0.02}/>
                  </linearGradient>
                ))}</defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.08)"/>
                <XAxis dataKey="mo" tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={xFmt} interval="preserveStartEnd" minTickGap={40}/>
                <YAxis tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={40}/>
                <Tooltip content={<ChartTip/>}/>
                <Area type="monotone" dataKey="mort"  stroke={ACC.red}    fill={`url(#${p}mBal)`} strokeWidth={2} dot={false} name="Loan Balance"  isAnimationActive={chartAnim} animationDuration={600} animationEasing="ease-out"/>
                <Area type="monotone" dataKey="iPaid" stroke={ACC.orange} fill={`url(#${p}mInt)`} strokeWidth={2} dot={false} name="Interest Paid"  isAnimationActive={chartAnim} animationDuration={600} animationEasing="ease-out"/>
                <Area type="monotone" dataKey="pPaid" stroke={ACC.green}  fill={`url(#${p}mPri)`} strokeWidth={2} dot={false} name="Principal Paid" isAnimationActive={chartAnim} animationDuration={600} animationEasing="ease-out"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        {/* NET WORTH */}
        <div style={{display:type==="networth"?"block":"none",height:"100%"}}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={zoomedData} margin={{top:4,right:4,left:4,bottom:5}}>
              <defs><linearGradient id={`${p}nwG`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ACC.green} stopOpacity={0.28}/><stop offset="95%" stopColor={ACC.green} stopOpacity={0.02}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.08)"/>
              <XAxis dataKey="mo" tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={xFmt} interval="preserveStartEnd" minTickGap={40}/>
              <YAxis tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={40}/>
              <Tooltip content={<ChartTip/>}/>
              <Area type="monotone" dataKey="nw" stroke={ACC.green} fill={`url(#${p}nwG)`} strokeWidth={2} dot={false} name="Net Worth" isAnimationActive={chartAnim} animationDuration={600} animationEasing="ease-out"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* ACCOUNTS */}
        <div style={{display:type==="accounts"?"block":"none",height:"100%"}}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={zoomedData} margin={{top:4,right:4,left:4,bottom:5}}>
              <defs>{CHART_LINES.map(l=>(
                <linearGradient key={l.k} id={`${p}g_${l.k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={l.color} stopOpacity={0.2}/><stop offset="95%" stopColor={l.color} stopOpacity={0.02}/>
                </linearGradient>
              ))}</defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.08)"/>
              <XAxis dataKey="mo" tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={xFmt} interval="preserveStartEnd" minTickGap={40}/>
              <YAxis domain={yDomain} tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={40}/>
              <Tooltip content={<ChartTip/>}/>
              {CHART_LINES.filter(l=>sel.has(l.k)).map(l=>(
                <Area key={l.k} type="monotone" dataKey={l.k} stroke={l.color} fill={`url(#${p}g_${l.k})`} strokeWidth={2} dot={false} name={l.label} isAnimationActive={chartAnim} animationDuration={600} animationEasing="ease-out"/>
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* EXPENSES */}
        <div style={{display:type==="expenses"?"block":"none",height:"100%"}}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={zoomedData} margin={{top:4,right:4,left:4,bottom:5}}>
              <defs>{allExpLines.map(l=>(
                <linearGradient key={l.k} id={`${p}ge_${l.k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={l.color} stopOpacity={0.22}/><stop offset="95%" stopColor={l.color} stopOpacity={0.02}/>
                </linearGradient>
              ))}</defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.08)"/>
              <XAxis dataKey="mo" tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={xFmt} interval="preserveStartEnd" minTickGap={40}/>
              <YAxis tick={{fill:"var(--ca)",fontSize:9}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={40}/>
              <Tooltip content={<ChartTip/>}/>
              {allExpLines.filter(l=>expSel.has(l.k)).map(l=>(
                <Area key={l.k} type="monotone" dataKey={l.k} stroke={l.color} fill={`url(#${p}ge_${l.k})`} strokeWidth={2} dot={false} name={l.label} isAnimationActive={chartAnim} animationDuration={600} animationEasing="ease-out"/>
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIZABLE CHART CELL — Card with drag handle on bottom edge
// ─────────────────────────────────────────────────────────────────────────────
function ResizableChartCell({chartData,barData,histData,defaultType,pfx,defaultH,hideRet}){
  const[h,setH]=useState(defaultH||280);
  const dragging=useRef(false);
  const startY=useRef(0);
  const startH=useRef(0);
  const MIN=120;

  const beginDrag=(clientY)=>{
    dragging.current=true;
    startY.current=clientY;
    startH.current=h;
  };
  const onMouseDown=e=>{e.preventDefault();beginDrag(e.clientY);window.addEventListener('mousemove',onMouseMove);window.addEventListener('mouseup',onUp);};
  const onTouchStart=e=>{beginDrag(e.touches[0].clientY);window.addEventListener('touchmove',onTouchMove,{passive:false});window.addEventListener('touchend',onUp);};
  const onMouseMove=e=>{if(!dragging.current)return;setH(Math.max(MIN,startH.current+(e.clientY-startY.current)));};
  const onTouchMove=e=>{if(!dragging.current)return;e.preventDefault();setH(Math.max(MIN,startH.current+(e.touches[0].clientY-startY.current)));};
  const onUp=()=>{dragging.current=false;window.removeEventListener('mousemove',onMouseMove);window.removeEventListener('mouseup',onUp);window.removeEventListener('touchmove',onTouchMove);window.removeEventListener('touchend',onUp);};

  return(
    <div style={{display:"flex",flexDirection:"column",minWidth:0,marginBottom:2}}>
      <Card style={{padding:"10px 14px 6px",minWidth:0}}>
        <ChartWindow chartData={chartData} barData={barData} histData={histData} defaultType={defaultType} pfx={pfx} height={h} hideRet={hideRet}/>
      </Card>
      {/* Bottom resize handle */}
      <div onMouseDown={onMouseDown} onTouchStart={onTouchStart}
        style={{height:14,cursor:"row-resize",display:"flex",alignItems:"center",justifyContent:"center",userSelect:"none",flexShrink:0}}>
        <div style={{width:52,height:4,borderRadius:4,background:"var(--cd)",transition:"background .15s"}}
          onMouseEnter={e=>e.currentTarget.style.background=ACC.blue}
          onMouseLeave={e=>e.currentTarget.style.background="var(--cd)"}/>
      </div>
    </div>
  );
}

function ResizableChartStack({chartData,barData,histData}){
  return(
    <div style={{display:"flex",flexDirection:"column",gap:0,minWidth:0}}>
      <ResizableChartCell chartData={chartData} barData={barData} histData={histData} defaultType="accounts" pfx="w1" defaultH={280} hideRet={true}/>
      <ResizableChartCell chartData={chartData} barData={barData} histData={histData} defaultType="mortgage" pfx="w2" defaultH={280}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIZABLE ACTIVITY LOG
// ─────────────────────────────────────────────────────────────────────────────
const logColor=msg=>{
  if(/🎉|PAID OFF|hit \$|vacation #|🏠 Mortgage \d|EmergFund hit|Retirement hit|Savings hit|Investment hit/.test(msg)) return ACC.blue;
  if(/🚨|Crisis|shortfall|drained|Pulled|Liquidated|📉 Market|Crash|🐾|🚗|📺|🏥|🔧|🚙|❄|📱|🌡|🦷|🚑/.test(msg)) return ACC.red;
  return C.text;
};

function ResizableActivityLog({logs}){
  const[h,setH]=useState(180);
  const dragging=useRef(false);
  const startY=useRef(0);
  const startH=useRef(0);
  const MIN=80, MAX=600;
  const beginDrag=cy=>{dragging.current=true;startY.current=cy;startH.current=h;};
  const onMouseDown=e=>{e.preventDefault();beginDrag(e.clientY);window.addEventListener('mousemove',onMM);window.addEventListener('mouseup',onUp);};
  const onTouchStart=e=>{beginDrag(e.touches[0].clientY);window.addEventListener('touchmove',onTM,{passive:false});window.addEventListener('touchend',onUp);};
  const onMM=e=>{if(!dragging.current)return;setH(Math.min(MAX,Math.max(MIN,startH.current+(e.clientY-startY.current))));};
  const onTM=e=>{if(!dragging.current)return;e.preventDefault();setH(Math.min(MAX,Math.max(MIN,startH.current+(e.touches[0].clientY-startY.current))));};
  const onUp=()=>{dragging.current=false;window.removeEventListener('mousemove',onMM);window.removeEventListener('mouseup',onUp);window.removeEventListener('touchmove',onTM);window.removeEventListener('touchend',onUp);};
  const reversed=useMemo(()=>[...logs].reverse().slice(0,150),[logs]);
  return(
    <div style={{marginBottom:2}}>
      <Card style={{padding:"10px 14px 8px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <div style={{fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:".05em"}}>📋 Activity Log</div>
          <div style={{fontSize:11,color:C.muted}}>{logs.length} events</div>
        </div>
        <div style={{height:h,overflowY:"auto",display:"flex",flexDirection:"column",gap:3}}>
          {!logs.length
            ? <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:C.muted,fontSize:13}}>Press play to begin…</div>
            : reversed.map((e,i)=>{
                const col=logColor(e.msg);
                return(
                  <div key={i} style={{padding:"4px 8px",background:"var(--nm-bg)",borderRadius:7,display:"flex",gap:8,alignItems:"flex-start",flexShrink:0,
                    borderLeft:`2px solid ${col=== C.text ? "var(--cd)" : col}`}}>
                    <span style={{fontSize:10,color:C.muted,flexShrink:0,marginTop:1,whiteSpace:"nowrap"}}>{toDate(e.mo)}</span>
                    <span style={{fontSize:12,fontWeight:600,color:col,lineHeight:1.3}}>{e.msg}</span>
                  </div>
                );
              })
          }
        </div>
      </Card>
      <div onMouseDown={onMouseDown} onTouchStart={onTouchStart}
        style={{height:14,cursor:"row-resize",display:"flex",alignItems:"center",justifyContent:"center",userSelect:"none"}}>
        <div style={{width:52,height:4,borderRadius:4,background:"var(--cd)",transition:"background .15s"}}
          onMouseEnter={e=>e.currentTarget.style.background=ACC.teal}
          onMouseLeave={e=>e.currentTarget.style.background="var(--cd)"}/>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// SIMULATE TAB — dashboard layout
// ─────────────────────────────────────────────────────────────────────────────
function SimTab({sim,cfg,setCfg,playing,setPlaying,timeStep,setTimeStep,speedMult,setSpeedMult,stickyTop,ctrlBarRef,stepOnce,onReset,chart,setChart,
  derived,chartData,barData,acctOrder,setAcctOrder,trendMode,setTrendMode,
  selLines,setSelLines,winW,updSimMulti}){
  const{tHouse,mNet,expBase,allFunds,leftover,equity,nw,pctPaid,estPayoff}=derived;
  const updSim=sim._updSim;
  const wide=winW>=860;
  const mobile=winW<540;
  const inCrash=sim.spCrashLeft>0;
  const yr=Math.floor(sim.mo/12)+1;
  const pctTime=Math.min(100,(sim.mo/480)*100);
  // Smooth display values — live here in SimTab so RAF doesn't disturb root interval
  const smoothNw      = useSmoothValue(nw,      0.14);
  const smoothEquity  = useSmoothValue(equity,  0.14);
  const smoothMort    = useSmoothValue(sim.mort,0.14);
  const smoothPctPaid = useSmoothValue(pctPaid, 0.14);
  const smoothPctTime = useSmoothValue(pctTime, 0.14);

  // ── Checking Flow helper ────────────────────────────────────────────────────
  const CheckingFlow=(
    <Card style={{marginBottom:"var(--nm-gap,10px)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px 10px"}}>
        <div style={{fontSize:15,fontWeight:700,color:C.text}}>Monthly Cash Flow</div>
      </div>
      {(()=>{
        const hist=sim.hist;
        const prev=hist.length>=2?hist[hist.length-2]:null;
        const startBal=prev?prev.chk:sim.chk;
        const endBal=sim.chk;
        const incomeActual=sim.mo>0?(sim.lastIncome||0):mNet;
        const housingActual=sim.mo>0?(sim.lastHousing||0):tHouse;
        const expActual=sim.mo>0?(sim.lastExp||0):expBase;
        const savActual=sim.mo>0?(sim.lastSavings||0):allFunds;
        // True monthly growth = income minus all outflows, regardless of cap overflow
        const trueGrowth=incomeActual-housingActual-expActual-savActual;
        const rows=[
          {label:"Opening",  val:startBal,     color:C.sub,     sign:" ", icon:"🏦"},
          {label:"Income",   val:incomeActual, color:ACC.green, sign:"+", icon:"💵"},
          {label:"Housing",  val:housingActual,color:ACC.red,   sign:"−", icon:"🏠"},
          {label:"Expenses", val:expActual,    color:ACC.orange,sign:"−", icon:"🧾"},
          {label:"Savings",  val:savActual,    color:ACC.blue,  sign:"−", icon:"🏦"},
          {label:"Closing",  val:endBal,       color:ACC.yellow,sign:" ", icon:"💳"},
        ];
        return(
          <div style={{padding:"0 12px 14px",display:"flex",flexDirection:"column",gap:"var(--nm-gap,10px)"}}>
            {rows.map(({label,val,color,sign,icon},idx)=>(
              <div key={label} className="sim-row" style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",borderRadius:14,
                background:"var(--nm-bg)",border:"none",boxShadow:idx===rows.length-1?`var(--nm-out), 0 0 0 1px ${color}33`:"var(--nm-sm-out)"}}>
                <span style={{fontSize:20,flexShrink:0}}>{icon}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,color:C.sub,fontWeight:600,marginBottom:1}}>{label}</div>
                  <div style={{fontSize:19,fontWeight:800,color,letterSpacing:"-.4px",lineHeight:1}}>
                    {sign===" "?"":sign+" "}{fmt(Math.abs(val))}
                  </div>
                </div>
              </div>
            ))}
            {/* True monthly growth — unaffected by checking cap */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"8px 12px",
              background:"var(--nm-bg)",
              border:"none",
              boxShadow:trueGrowth>=0?`var(--nm-in),0 0 0 1px ${ACC.green}33`:`var(--nm-in),0 0 0 1px ${ACC.red}33`,
              borderRadius:12,marginTop:2}}>
              <span style={{fontSize:11,color:C.sub,fontWeight:600}}>Monthly growth</span>
              <span style={{fontSize:14,fontWeight:900,color:trueGrowth>=0?ACC.green:ACC.red}}>
                {trueGrowth>=0?"▲ +":"▼ "}{fmt(Math.abs(trueGrowth))}
              </span>
            </div>
          </div>
        );
      })()}
    </Card>
  );

  // ── Left column ──────────────────────────────────────────────────────────────
  const LeftCol=(
    <div style={{minWidth:0}}>
      <div style={wide?{position:"sticky",top:stickyTop}:{}}>
        {CheckingFlow}
      </div>
    </div>
  );

  // ── Sidebar ─────────────────────────────────────────────────────────────────
  const Sidebar=(
    <div style={{minWidth:0}}>
      <div style={wide?{position:"sticky",top:stickyTop,display:"flex",flexDirection:"column",gap:10}:{display:"flex",flexDirection:"column",gap:10}}>
      <AccountsPanel sim={sim} cfg={cfg} order={acctOrder} setOrder={setAcctOrder} trendMode={trendMode} setTrendMode={setTrendMode} mobile={mobile}/>
    </div>
    </div>
  );

  // ── Main column ──────────────────────────────────────────────────────────────
  const Main=(
    <div style={{display:"flex",flexDirection:"column",gap:10,minWidth:0}}>

      {/* TIMELINE + ACTIVITY LOG — side by side */}
      <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"1fr 1fr",gap:"var(--nm-gap,10px)"}}>
      <div style={{minWidth:0}}><Card style={{padding:mobile?"12px 12px":"16px 18px",...(wide?{position:"sticky",top:stickyTop}:{})}}>
        {/* Top row: ring + date/info + net worth */}
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14}}>
          <div style={{position:"relative",flexShrink:0}}>
            <ProgressRing pct={smoothPctPaid??pctPaid} color={sim.paidOff?ACC.green:ACC.orange} size={72}/>
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <div style={{fontSize:13,fontWeight:900,color:C.text}}>{(smoothPctPaid??pctPaid).toFixed(0)}%</div>
              <div style={{fontSize:8,color:C.sub}}>paid</div>
            </div>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:22,fontWeight:900,color:C.text,letterSpacing:"-.6px",lineHeight:1}}>{toDate(sim.mo)}</div>
            <div style={{fontSize:12,color:C.sub,marginTop:2}}>Month {sim.mo} · Year {yr} of 40</div>
            <div style={{fontSize:12,color:sim.paidOff?ACC.green:ACC.teal,fontWeight:600,marginTop:2}}>🎯 {estPayoff}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:10,color:C.sub,textTransform:"uppercase",letterSpacing:".05em"}}>Net Worth</div>
            <div style={{fontSize:24,fontWeight:900,color:ACC.green,letterSpacing:"-.5px"}}>{fmtK(nw)}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{background:"var(--nm-bg)",borderRadius:8,overflow:"hidden",height:8,marginBottom:4,boxShadow:"var(--nm-in)"}}>
          <div className="sim-bar" style={{height:"100%",background:`linear-gradient(90deg,${ACC.orange},${ACC.yellow},${ACC.green})`,
            width:`${smoothPctTime??pctTime}%`,borderRadius:8}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.muted,marginBottom:14}}>
          <span>Start</span><span>Yr 10</span><span>Yr 20</span><span>Yr 30</span><span>Yr 40</span>
        </div>

        {/* Travel life merged in */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[{label:"Small Trips",val:sim.svTrips||0,color:ACC.teal,icon:"✈",target:cfg.svTarget||1500,
              next:Math.max(0,(cfg.svTarget||1500)-sim.sv),cur:sim.sv},
            {label:"Big Trips",  val:sim.lvTrips||0,color:ACC.blue, icon:"🌴",target:cfg.lvTarget||5000,
              next:Math.max(0,(cfg.lvTarget||5000)-sim.lv),cur:sim.lv}
          ].map(t=>{
            const pct=Math.min(100,(t.cur/t.target)*100);
            return(
              <div key={t.label} style={{background:"var(--nm-bg)",borderRadius:18,padding:"12px 14px",border:"none",boxShadow:"var(--nm-out)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:18}}>{t.icon}</span>
                  <span style={{fontSize:22,fontWeight:900,color:t.color,lineHeight:1}}>{t.val}</span>
                </div>
                <div style={{fontSize:11,color:C.sub,marginBottom:5}}>{t.label}</div>
                <div style={{background:"var(--ci)",borderRadius:4,height:4,overflow:"hidden",marginBottom:4}}>
                  <div style={{height:"100%",background:t.color,width:`${pct}%`,borderRadius:4,transition:"width .7s cubic-bezier(.4,0,.2,1)"}}/>
                </div>
                <div style={{fontSize:10,color:C.muted}}>{fmt(t.cur)} / {fmt(t.target)}</div>
              </div>
            );
          })}
        </div>

        {sim.warns.map((w,i)=><div key={i} style={{marginTop:10,background:"rgba(255,69,58,.15)",borderRadius:8,padding:"6px 10px",fontSize:12,color:ACC.red,fontWeight:600}}>{w}</div>)}
      </Card></div>
      <ResizableActivityLog logs={sim.logs}/>
      </div>{/* end timeline+activity grid */}

      <ResizableChartStack chartData={chartData} barData={barData} histData={sim.hist}/>

      {/* Live Adjustments */}
      <SectionPanel title="Live Adjustments" icon="🎛" accent={ACC.blue} subtitle="Updates instantly" defaultOpen={false}>
        {/* helper: consistent compact card */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>

          {/* ── Income raises ── */}
          {[{n:1,name:"Joseph",color:ACC.green},{n:2,name:"Torrey",color:ACC.teal}].map(({n,name,color})=>{
            const incKey=`inc${n}`, raiseMoKey=`inc${n}RaiseMo`;
            const curInc=sim[incKey]||0, raiseMo=sim[raiseMoKey]||0;
            const moSince=raiseMo>0?sim.mo-raiseMo:null;
            return(
              <div key={n} style={{gridColumn:"span 1",background:"var(--nm-bg)",borderRadius:18,padding:"12px 14px",border:"none",boxShadow:"var(--nm-out)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:700,color:C.text}}>💰 {name}</span>
                  <span style={{fontSize:11,color:C.muted}}>{moSince!=null?`${moSince}mo`:"—"}</span>
                </div>
                <div style={{fontSize:15,fontWeight:900,color,marginBottom:6}}>{fmt(curInc)}<span style={{fontSize:10,color:C.muted}}>/yr</span></div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {[{l:"+2%",v:Math.round(curInc*1.02)},{l:"+5%",v:Math.round(curInc*1.05)},
                    {l:"+10%",v:Math.round(curInc*1.10)},{l:"+$5k",v:curInc+5000}
                  ].map(({l,v})=>(
                    <button key={l} onClick={()=>updSimMulti({[incKey]:v,[raiseMoKey]:sim.mo})}
                      style={{padding:"5px 10px",borderRadius:10,border:"none",background:"var(--nm-bg)",boxShadow:"var(--nm-sm-out)",
                        color,fontSize:11,fontWeight:700,cursor:"pointer"}} className="btn-nm-sm">{l}</button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── Sim-state knobs: all same card style ── */}
          {[
            {label:"Extra Mortgage",icon:"🏠",k:"xpmt",step:25,format:fmt,presets:[0,100,250,500],color:ACC.orange,disp:v=>v===0?"Off":fmt(v),src:"sim"},
            {label:"Savings / mo",  icon:"🏦",k:"savMo",step:25,format:fmt,presets:[0,25,100,200],color:ACC.green, disp:v=>v===0?"Off":fmt(v),src:"sim"},
            {label:"Investment/mo", icon:"📈",k:"invMo",step:25,format:fmt,presets:[0,50,100,200],color:"#30D158",disp:v=>v===0?"Off":fmt(v),src:"sim"},
            {label:"Retirement %",  icon:"📊",k:"retPct",step:0.5,format:v=>`${Number(v).toFixed(1)}%`,presets:[3,4,6,8],color:ACC.purple,disp:v=>`${v}%`,src:"sim",max:25},
            {label:"Small Vac/mo",  icon:"✈",k:"svMo",step:10,format:fmt,presets:[0,10,25,50],color:ACC.teal,disp:v=>v===0?"Off":fmt(v),src:"sim"},
            {label:"Big Vac/mo",    icon:"🌴",k:"lvMo",step:10,format:fmt,presets:[0,25,50,100],color:ACC.blue,disp:v=>v===0?"Off":fmt(v),src:"sim"},
          ].map(f=>{
            const val=f.src==="sim"?sim[f.k]:cfg[f.k];
            const onChange=f.src==="sim"?(v=>updSim(f.k,f.max?Math.min(f.max,v):v)):(v=>setCfg(p=>({...p,[f.k]:v})));
            return(
              <div key={f.k} style={{background:"var(--nm-bg)",borderRadius:18,padding:"12px 14px",border:"none",boxShadow:"var(--nm-out)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:700,color:C.text}}>{f.icon} {f.label}</span>
                  <span style={{fontSize:14,fontWeight:900,color:f.color}}>{f.format(val)}</span>
                </div>
                <Stepper value={val} onChange={onChange} step={f.step} min={0} max={f.max} format={f.format}/>
                <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                  {f.presets.map(v=>(
                    <PillBtn key={v} active={f.src==="sim"?sim[f.k]===v:cfg[f.k]===v} color={f.color}
                      onClick={()=>onChange(v)} style={{padding:"3px 8px",fontSize:11,minHeight:26}}>{f.disp(v)}</PillBtn>
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── Expenses ── */}
          {[
            {label:"Dining / Fun",  icon:"🍕",ek:"dining",presets:[100,200,300,400],color:ACC.orange},
            {label:"Misc / Personal",icon:"🎯",ek:"misc",  presets:[100,200,300,400],color:ACC.red},
          ].map(f=>(
            <div key={f.ek} style={{background:"var(--nm-bg)",borderRadius:18,padding:"12px 14px",border:"none",boxShadow:"var(--nm-out)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:700,color:C.text}}>{f.icon} {f.label}</span>
                <span style={{fontSize:14,fontWeight:900,color:f.color}}>{fmt(cfg.expenses?.[f.ek]??EXP_DEFS[f.ek]?.base??0)}</span>
              </div>
              <Stepper value={cfg.expenses?.[f.ek]??EXP_DEFS[f.ek]?.base??0}
                onChange={v=>setCfg(p=>({...p,expenses:{...p.expenses,[f.ek]:Math.max(0,v)}}))}
                step={25} min={0} format={fmt}/>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                {f.presets.map(v=>(
                  <PillBtn key={v} active={(cfg.expenses?.[f.ek]??EXP_DEFS[f.ek]?.base)===v} color={f.color}
                    onClick={()=>setCfg(p=>({...p,expenses:{...p.expenses,[f.ek]:v}}))}
                    style={{padding:"3px 8px",fontSize:11,minHeight:26}}>{fmt(v)}</PillBtn>
                ))}
              </div>
            </div>
          ))}

          {/* ── Account Caps ── */}
          {[
            {label:"Emergency Fund/mo", icon:"🛡",k:"emMo",step:25,presets:[0,25,50,100,150],color:ACC.red,src:"sim"},
          ].map(f=>{
            const val=f.src==="sim"?sim[f.k]:cfg[f.k];
            const onChange=f.src==="sim"?(v=>updSim(f.k,v)):(v=>setCfg(p=>({...p,[f.k]:v})));
            return(
              <div key={f.k} style={{background:"var(--nm-bg)",borderRadius:18,padding:"12px 14px",border:"none",boxShadow:"var(--nm-out)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:700,color:C.text}}>{f.icon} {f.label}</span>
                  <span style={{fontSize:14,fontWeight:900,color:f.color}}>{fmt(val)}</span>
                </div>
                <Stepper value={val} onChange={onChange} step={f.step} min={0} format={fmt}/>
                <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                  {f.presets.map(v=>(
                    <PillBtn key={v} active={val===v} color={f.color}
                      onClick={()=>onChange(v)}
                      style={{padding:"3px 8px",fontSize:11,minHeight:26}}>{v===0?"Off":fmt(v)}</PillBtn>
                  ))}
                </div>
              </div>
            );
          })}

        </div>
      </SectionPanel>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return(
    <div>
      {/* ═══ CONTROL BAR ══════════════════════════════════════════════════════ */}
      <div ref={ctrlBarRef} style={{position:"sticky",top:54,zIndex:90,
        background:"var(--cn)",borderBottom:"1px solid var(--cd)",padding:mobile?"8px 12px 10px":"10px 24px 12px"}}>
        <div style={{maxWidth:1400,margin:"0 auto"}}>

          {/* Row 1: transport controls + date + net worth */}
          <div style={{display:"flex",alignItems:"center",gap:"var(--nm-gap,10px)",marginBottom:"var(--nm-gap,10px)",flexWrap:"wrap"}}>

            {/* Play/Pause */}
            <button onClick={()=>setPlaying(p=>!p)}
              style={{width:mobile?50:64,height:mobile?50:64,borderRadius:mobile?14:18,border:"none",cursor:"pointer",fontSize:mobile?20:26,flexShrink:0,
                background:playing?ACC.red:ACC.green,
                color:"#fff",boxShadow:playing?`6px 6px 18px ${ACC.red}55,-2px -2px 8px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.2)`:`6px 6px 18px ${ACC.green}55,-2px -2px 8px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.2)`,
                transition:"all .2s",display:"flex",alignItems:"center",justifyContent:"center"}} className="btn-nm">
              {playing?"⏸":"▶"}
            </button>

            {/* Step + Reset */}
            <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
              <button onClick={stepOnce}
                style={{width:44,height:29,borderRadius:9,border:"1px solid var(--cd)",cursor:"pointer",
                  background:"var(--nm-bg)",color:C.text,fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"var(--nm-sm-out)"}} className="btn-nm-sm">⏭</button>
              <button onClick={onReset}
                style={{width:44,height:29,borderRadius:9,border:"1px solid var(--cd)",cursor:"pointer",
                  background:"var(--nm-bg)",color:C.sub,fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"var(--nm-sm-out)"}} className="btn-nm-sm">↺</button>
            </div>

            {/* Date + year badge */}
            <div style={{flexShrink:0}}>
              <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:".08em",lineHeight:1}}>Simulating</div>
              <div style={{fontSize:20,fontWeight:900,color:C.text,letterSpacing:"-.5px",lineHeight:1.1}}>{toDate(sim.mo)}</div>
              <div style={{display:"inline-block",marginTop:3,padding:"2px 8px",borderRadius:6,
                background:ACC.blue+"22",color:ACC.blue,fontSize:11,fontWeight:700}}>Yr {yr}</div>
            </div>

            {/* Net worth */}
            <div style={{flexShrink:0,minWidth:mobile?90:130,background:"var(--nm-bg)",borderRadius:16,padding:mobile?"5px 9px":"8px 14px",border:"none",boxShadow:"var(--nm-out)"}}>
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:".06em"}}>Net Worth</div>
              <div style={{fontSize:mobile?15:22,fontWeight:900,color:ACC.green,letterSpacing:"-.5px",fontVariantNumeric:"tabular-nums"}}>{fmtK(smoothNw??nw)}</div>
            </div>

            {/* Equity */}
            {!mobile&&<div style={{flexShrink:0,minWidth:130,background:"var(--nm-bg)",borderRadius:16,padding:"8px 14px",border:"none",boxShadow:"var(--nm-out)"}}>
              <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:".06em"}}>Home Equity</div>
              <div style={{fontSize:22,fontWeight:900,color:ACC.orange,letterSpacing:"-.5px",fontVariantNumeric:"tabular-nums"}}>{fmtK(smoothEquity??equity)}</div>
            </div>}

            {/* Mortgage balance */}
            {!mobile&&!sim.paidOff&&(
              <div style={{flexShrink:0,minWidth:130,background:"var(--nm-bg)",borderRadius:16,padding:"8px 14px",border:"none",boxShadow:"var(--nm-out)"}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:".06em"}}>Mortgage</div>
                <div style={{fontSize:22,fontWeight:900,color:ACC.red,letterSpacing:"-.5px",fontVariantNumeric:"tabular-nums"}}>{fmtK(smoothMort??sim.mort)}</div>
              </div>
            )}
            {sim.paidOff&&(
              <div style={{flexShrink:0,background:`${ACC.green}18`,borderRadius:12,padding:"8px 14px",border:`1px solid ${ACC.green}44`}}>
                <div style={{fontSize:10,color:ACC.green,textTransform:"uppercase",letterSpacing:".06em",fontWeight:700}}>🎉 Paid Off</div>
                <div style={{fontSize:22,fontWeight:900,color:ACC.green,letterSpacing:"-.5px"}}>{toDate(sim.paidOffMo||0)}</div>
              </div>
            )}

            {inCrash&&(
              <div style={{flexShrink:0,padding:"6px 12px",borderRadius:10,
                background:`${ACC.red}22`,border:`1px solid ${ACC.red}55`,
                fontSize:13,fontWeight:800,color:ACC.red}}>
                📉 Crash<br/><span style={{fontSize:11,fontWeight:600}}>{sim.spCrashLeft}mo left</span>
              </div>
            )}
          </div>

          {/* Row 2: time step + speed multiplier */}
          <div style={{display:"flex",alignItems:"center",gap:mobile?6:10,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:".05em",flexShrink:0}}>Time Step</span>
            <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
              {TIME_STEPS.map((ts,i)=>(
                <button key={i} onClick={()=>setTimeStep(i)} style={{
                  padding:mobile?"4px 8px":"5px 12px",borderRadius:8,border:"none",cursor:"pointer",
                  fontSize:mobile?11:12,fontWeight:800,
                  background:"var(--nm-bg)",
                  color:timeStep===i?ACC.teal:C.sub,
                  boxShadow:timeStep===i?"var(--nm-in)":"var(--nm-sm-out)",
                  transform:timeStep===i?"translateY(1px)":"none",
                  transition:"all .15s ease"}} className={timeStep===i?"btn-nm-inset":"btn-nm-sm"}>
                  {ts.label}
                </button>
              ))}
            </div>
            <div style={{width:1,height:20,background:"var(--cd)",flexShrink:0}}/>
            <span style={{fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:".05em",flexShrink:0}}>Speed</span>
            <div style={{display:"flex",gap:3}}>
              {SPEED_MULTS.map(m=>(
                <button key={m} onClick={()=>setSpeedMult(m)} style={{
                  padding:mobile?"4px 8px":"5px 11px",borderRadius:8,border:"none",cursor:"pointer",
                  fontSize:mobile?11:12,fontWeight:800,
                  background:"var(--nm-bg)",
                  color:speedMult===m?ACC.green:C.sub,
                  boxShadow:speedMult===m?"var(--nm-in)":"var(--nm-sm-out)",
                  transform:speedMult===m?"translateY(1px)":"none",
                  transition:"all .15s ease"}} className={speedMult===m?"btn-nm-inset":"btn-nm-sm"}>
                  {m}×
                </button>
              ))}
            </div>
            {!mobile&&<div style={{fontSize:11,color:C.muted,fontWeight:600,marginLeft:4}}>
              {speedToMs(speedMult)}ms/tick
            </div>}
          </div>

        </div>
      </div>

      {/* DASHBOARD */}
      <div style={{maxWidth:1400,margin:"0 auto",padding:mobile?"6px 12px 40px":"10px 24px 40px",
        display:"grid",gridTemplateColumns:wide?"220px 1fr 300px":"1fr",gap:"var(--nm-gap,10px)"}}>
        {wide&&LeftCol}
        {Main}
        {!wide&&LeftCol}
        {Sidebar}
      </div>
    </div>
  );
}

const DEF_ACCT_ORDER=["mort","chk","sav","ret","em","sv","lv","inv","eq"];
const ACCT_BAR_CFG=[{key:"chk",label:"Checking",color:ACC.yellow},{key:"sav",label:"Savings",color:ACC.green},{key:"ret",label:"Retirement",color:ACC.purple},{key:"em",label:"Emergency",color:ACC.red},{key:"sv",label:"Sm.Vac",color:ACC.teal},{key:"lv",label:"Lg.Vac",color:ACC.blue},{key:"inv",label:"Investment",color:"#30D158"}];
const ACCT_BAR_KEYS=ACCT_BAR_CFG.map(a=>a.key);

// ─────────────────────────────────────────────────────────────────────────────
// useSmoothValue — lerps a numeric value at 60fps for fluid display
// ─────────────────────────────────────────────────────────────────────────────
function useSmoothValue(target, speed=0.12){
  const [display, setDisplay] = useState(target);
  const current = useRef(target);
  const rafRef  = useRef(null);
  const targetRef = useRef(target);

  useEffect(()=>{
    targetRef.current = target;
    const animate = ()=>{
      const diff = targetRef.current - current.current;
      if(Math.abs(diff) < 1){
        current.current = targetRef.current;
        setDisplay(targetRef.current);
        return;
      }
      current.current += diff * speed;
      setDisplay(Math.round(current.current));
      rafRef.current = requestAnimationFrame(animate);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
    return ()=> cancelAnimationFrame(rafRef.current);
  },[target, speed]);

  return display;
}

export default function MortgageSim(){
  const[cfg,setCfg]       = useState({...DEFAULT_CFG});
  const[sim,setSim]       = useState(()=>initSim(DEFAULT_CFG));
  const[tab,setTab]       = useState("setup");
  const[dark,setDark]     = useState(true);
  const[theme,setTheme]   = useState({...DEFAULT_THEME});
  const[themeOpen,setThemeOpen] = useState(false);
  const updTheme=useCallback((k,v)=>setTheme(p=>({...p,[k]:v})),[]);
  const[playing,setPlaying] = useState(false);
  const[timeStep,setTimeStep] = useState(3); // default 1M
  const[speedMult,setSpeedMult] = useState(1); // default 1×
  const[chart,setChart]   = useState("networth");
  const[acctOrder,setAcctOrder] = useState([...DEF_ACCT_ORDER]);
  const[trendMode,setTrendMode] = useState("$");
  const[selLines,setSelLines]   = useState(new Set(CHART_LINES.map(l=>l.k)));
  const[setupOrder,setSetupOrder] = useState([...DEF_SETUP_ORDER]);
  const[winW,setWinW]           = useState(()=>window.innerWidth);
  useEffect(()=>{const h=()=>setWinW(window.innerWidth);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);
  const ctrlBarRef=useRef(null);
  const[stickyTop,setStickyTop] = useState(190);
  useEffect(()=>{
    if(!ctrlBarRef.current)return;
    const obs=new ResizeObserver(()=>{
      const r=ctrlBarRef.current?.getBoundingClientRect();
      if(r) setStickyTop(Math.round(r.bottom)+4);
    });
    obs.observe(ctrlBarRef.current);
    return()=>obs.disconnect();
  },[]);
  const iRef=useRef(null), accumRef=useRef(0);
  // Refs so doTick never needs to be recreated when these change
  const timeStepRef=useRef(timeStep), cfgRef=useRef(cfg), speedMultRef=useRef(speedMult), tickMsRef=useRef(16);
  useEffect(()=>{ timeStepRef.current=timeStep; },[timeStep]);
  useEffect(()=>{ cfgRef.current=cfg; },[cfg]);
  useEffect(()=>{ speedMultRef.current=speedMult; },[speedMult]);

  const updSim=useCallback((k,v)=>setSim(p=>({...p,[k]:Math.max(0,Number(v)||0)})),[]);
  const updSimMulti=useCallback((obj)=>setSim(p=>({...p,...obj})),[]);

  // advance is pure — no closure over changing state
  const advance=useCallback((mo,cs,cc)=>{
    let s=cs;
    for(let i=0;i<Math.floor(mo);i++) if(s.mo<MAX_MO) s=tick(s,cc);
    return s;
  },[]);

  // doTick: each tick advances exactly one time step
  const doTick=useCallback(()=>{
    const mpt=(TIME_STEPS[timeStepRef.current]||TIME_STEPS[3]).mpt;
    setSim(prev=>{
      accumRef.current+=mpt;
      if(accumRef.current<1)return prev;
      const n=Math.floor(accumRef.current); accumRef.current-=n;
      return advance(n,prev,cfgRef.current);
    });
  },[advance]);

  const stepOnce=useCallback(()=>{
    setPlaying(false);
    const mpt=(TIME_STEPS[timeStepRef.current]||TIME_STEPS[3]).mpt;
    setSim(prev=>advance(Math.max(1,Math.round(mpt))||1,prev,cfgRef.current));
  },[advance]);

  // Interval: restarts when playing, speedMult, or timeStep changes
  useEffect(()=>{
    clearInterval(iRef.current);
    if(playing) iRef.current=setInterval(doTick,speedToMs(speedMult));
    return()=>clearInterval(iRef.current);
  },[playing,speedMult,timeStep,doTick]);
  useEffect(()=>{ if(playing&&sim.mo>=MAX_MO)setPlaying(false); },[sim.mo,playing]);

  const applyReset=useCallback(()=>{ setSim(initSim(cfg)); setPlaying(false); accumRef.current=0; },[cfg]);

  const derived=useMemo(()=>{
    const mr=(cfg.mortRate||6.8)/100;
    const loan=Math.max(0,cfg.homePrice-cfg.downPayment);
    const pi=calcPI(loan,mr);
    const pt=(cfg.homePrice*TX_TAX)/12,ins=(cfg.homePrice*(cfg.homeIns||TX_INS*100)/100)/12;
    const hoa=(cfg.hoaMo||0);
    const pmi=(sim.mort/cfg.homePrice>0.8)?Math.round(sim.mort*0.006/12):0;
    const tHouse=pi+sim.xpmt+pt+ins+pmi+hoa;
    const inc1A=getIncome(cfg,1),inc2A=getIncome(cfg,2);
    const tGross=inc1A+inc2A,rAnn=tGross*sim.retPct/100,rMo=rAnn/12;
    const aTax=calcTax(tGross-rAnn),mNet=Math.max(0,Math.round(tGross/12-rMo-aTax/12));
    const expBase=Object.entries(EXP_DEFS).reduce((a,[k,d])=>a+(cfg.expenses?.[k]??d.base),0);
    const allFunds=sim.savMo+sim.emMo+sim.svMo+sim.lvMo+(sim.invMo||0);
    const leftover=mNet-tHouse-allFunds-expBase;
    const equity=cfg.homePrice-sim.mort;
    const nw=sim.chk+sim.sav+sim.ret+sim.em+sim.sv+sim.lv+sim.inv+equity;
    const pctPaid=loan>0?((loan-sim.mort)/loan*100):100;
    const estPayoff=sim.paidOff?`Paid off ${sim.paidOffMo?toDate(sim.paidOffMo):""}`:
      (()=>{const ir=sim.mort*(mr/12),ppm=pi-ir+sim.xpmt;if(ppm<=0)return"Est. payoff: ∞";return`Est. payoff: ${toDate(sim.mo+Math.ceil(sim.mort/ppm))}`;})();
    return{mr,loan,pi,tHouse,tGross,rAnn,rMo,aTax,mNet,expBase,allFunds,leftover,equity,nw,pctPaid,estPayoff,ltv:(loan/cfg.homePrice*100).toFixed(1),pmiActive:loan/cfg.homePrice>0.8};
  },[cfg,sim]);

  const chartData=useMemo(()=>{
    const h=sim.hist; if(h.length<=120)return h;
    const st=Math.ceil(h.length/120); return h.filter((_,i)=>i%st===0||i===h.length-1);
  },[sim.hist]);

  const barData=useMemo(()=>ACCT_BAR_CFG.map(a=>({key:a.key,name:a.label,value:Math.max(0,sim[a.key]||0),color:a.color})),[sim]);
  const simWithUpdater=useMemo(()=>({...sim,_updSim:updSim}),[sim,updSim]);

  const css=`
  @viewport{width=device-width;}
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&family=DM+Mono:wght@400;500&display=swap');
    :root{${buildThemeVars(dark,theme)}}
    *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
    html,body{height:100%}
    body{font-family:'DM Sans',system-ui,sans-serif;background:var(--cbg);font-variant-numeric:tabular-nums}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:var(--cd);border-radius:10px}
    input[type=number]{-moz-appearance:textfield}
    input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
    input[type=range]{-webkit-appearance:none;appearance:none;height:6px;border-radius:6px;outline:none;cursor:pointer;background:var(--nm-in,#333);box-shadow:var(--nm-in)}
    input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:var(--nm-bg);box-shadow:var(--nm-sm-out);cursor:pointer;transition:transform .1s ease}
    input[type=range]::-webkit-slider-thumb:active{transform:scale(1.15)}
    button{font-family:'DM Sans',sans-serif}
    .mono{font-family:'DM Mono',monospace}
    .sim-bar{transition:width .6s cubic-bezier(.4,0,.2,1)}
    .sim-row{transition:background .2s ease}
    /* ── Button press animations ── */
    .btn-nm{
      transition:box-shadow .18s cubic-bezier(.4,0,.2,1),
                 transform .18s cubic-bezier(.4,0,.2,1),
                 background .18s ease;
      cursor:pointer;
    }
    .btn-nm:active{
      box-shadow:var(--nm-in) !important;
      transform:translateY(2px) scale(0.98) !important;
    }
    .btn-nm-sm{
      transition:box-shadow .15s cubic-bezier(.4,0,.2,1),
                 transform .15s cubic-bezier(.4,0,.2,1),
                 background .15s ease;
      cursor:pointer;
    }
    .btn-nm-sm:active{
      box-shadow:var(--nm-in) !important;
      transform:translateY(1px) scale(0.97) !important;
    }
    /* Inset buttons (active state) press outward */
    .btn-nm-inset{
      transition:box-shadow .18s cubic-bezier(.4,0,.2,1),
                 transform .18s cubic-bezier(.4,0,.2,1);
      cursor:pointer;
    }
    .btn-nm-inset:active{
      box-shadow:var(--nm-out) !important;
      transform:translateY(-1px) scale(1.01) !important;
    }
  `;


  // ── ThemePanel ───────────────────────────────────────────────────────────────
  const[themeSec,setThemeSec] = useState("surface");

  const TSECS=[
    {id:"surface",icon:"⬜",label:"Surface"},
    {id:"gradient",icon:"🌈",label:"Gradient"},
    {id:"text",   icon:"Aa", label:"Text"},
    {id:"depth",  icon:"◉",  label:"Depth"},
    {id:"shape",  icon:"⬡",  label:"Shape"},
  ];

  const TSLIDERS={
    surface:[
      {k:"hue",      label:"Hue",             min:0,  max:360,step:1,   fmt:v=>v+"°",
       css:"linear-gradient(to right,hsl(0,70%,50%),hsl(60,70%,50%),hsl(120,70%,50%),hsl(180,70%,50%),hsl(240,70%,50%),hsl(300,70%,50%),hsl(360,70%,50%))"},
      {k:"sat",      label:"Saturation",       min:0,  max:60, step:1,   fmt:v=>v+"%",
       css:dark?"linear-gradient(to right,hsl("+theme.hue+",0%,12%),hsl("+theme.hue+",60%,20%))":"linear-gradient(to right,hsl("+theme.hue+",0%,90%),hsl("+theme.hue+",60%,75%))"},
      {k:"bgL",      label:"Background Dark",  min:3,  max:22, step:0.5, fmt:v=>v.toFixed(1)+"% L",
       css:"linear-gradient(to right,hsl("+theme.hue+",18%,3%),hsl("+theme.hue+",18%,22%))"},
      {k:"fgL",      label:"Foreground Dark",  min:5,  max:26, step:0.5, fmt:v=>v.toFixed(1)+"% L",
       css:"linear-gradient(to right,hsl("+theme.hue+",18%,5%),hsl("+theme.hue+",18%,26%))"},
    ],
    gradient:[
      {k:"gradAngle",label:"Angle",            min:0,  max:360,step:1,   fmt:v=>v+"°",
       css:"conic-gradient(from 270deg,hsl("+theme.hue+",40%,30%),hsl("+(theme.hue+60)+",40%,20%),hsl("+(theme.hue-60)+",40%,15%),hsl("+theme.hue+",40%,30%))"},
      {k:"grad0H",   label:"Stop 1 Hue Shift", min:-60,max:60, step:1,   fmt:v=>(v>=0?"+":"")+v+"°",
       css:"linear-gradient(to right,hsl("+(theme.hue-60)+","+theme.sat+"%,"+theme.bgL+"%),hsl("+(theme.hue+60)+","+theme.sat+"%,"+theme.bgL+"%))"},
      {k:"grad0L",   label:"Stop 1 Lightness", min:-10,max:14, step:0.5, fmt:v=>(v>=0?"+":"")+v.toFixed(1),
       css:"linear-gradient(to right,hsl("+theme.hue+","+theme.sat+"%,2%),hsl("+theme.hue+","+theme.sat+"%,22%))"},
      {k:"grad1H",   label:"Stop 2 Hue Shift", min:-60,max:60, step:1,   fmt:v=>(v>=0?"+":"")+v+"°",
       css:"linear-gradient(to right,hsl("+(theme.hue-60)+","+theme.sat+"%,"+theme.bgL+"%),hsl("+(theme.hue+60)+","+theme.sat+"%,"+theme.bgL+"%))"},
      {k:"grad1L",   label:"Stop 2 Lightness", min:-10,max:14, step:0.5, fmt:v=>(v>=0?"+":"")+v.toFixed(1),
       css:"linear-gradient(to right,hsl("+theme.hue+","+theme.sat+"%,2%),hsl("+theme.hue+","+theme.sat+"%,22%))"},
      {k:"grad2H",   label:"Stop 3 Hue Shift", min:-60,max:60, step:1,   fmt:v=>(v>=0?"+":"")+v+"°",
       css:"linear-gradient(to right,hsl("+(theme.hue-60)+","+theme.sat+"%,"+theme.bgL+"%),hsl("+(theme.hue+60)+","+theme.sat+"%,"+theme.bgL+"%))"},
      {k:"grad2L",   label:"Stop 3 Lightness", min:-10,max:14, step:0.5, fmt:v=>(v>=0?"+":"")+v.toFixed(1),
       css:"linear-gradient(to right,hsl("+theme.hue+","+theme.sat+"%,2%),hsl("+theme.hue+","+theme.sat+"%,22%))"},
    ],
    text:[
      {k:"textOp",   label:"Primary Text",     min:0.3,max:1,  step:0.01,fmt:v=>Math.round(v*100)+"%",
       css:dark?"linear-gradient(to right,rgba(255,255,255,.25),rgba(255,255,255,1))":"linear-gradient(to right,rgba(0,0,0,.25),rgba(0,0,0,1))"},
      {k:"subOp",    label:"Secondary Text",   min:0.1,max:0.9,step:0.01,fmt:v=>Math.round(v*100)+"%",
       css:dark?"linear-gradient(to right,rgba(255,255,255,.1),rgba(255,255,255,.85))":"linear-gradient(to right,rgba(0,0,0,.1),rgba(0,0,0,.85))"},
      {k:"borderOp", label:"Border Opacity",   min:0,  max:0.4,step:0.005,fmt:v=>Math.round(v*100)+"%",
       css:dark?"linear-gradient(to right,rgba(255,255,255,0),rgba(255,255,255,.4))":"linear-gradient(to right,rgba(0,0,0,0),rgba(0,0,0,.3))"},
      {k:"accentSat",label:"Accent Vividness", min:20, max:100,step:1,   fmt:v=>v+"%",
       css:"linear-gradient(to right,hsl("+theme.hue+",20%,55%),hsl("+theme.hue+",100%,55%))"},
    ],
    depth:[
      {k:"emboss",   label:"Emboss Strength",  min:0,  max:2.5,step:0.05,fmt:v=>v.toFixed(2)+"×",
       css:dark?"linear-gradient(to right,hsl("+theme.hue+",10%,10%),hsl("+theme.hue+",20%,30%))":"linear-gradient(to right,#d0d8e8,#f0f4ff)"},
      {k:"shadowSz", label:"Shadow Spread",    min:2,  max:18, step:1,   fmt:v=>v+"px",
       css:dark?"linear-gradient(to right,hsl("+theme.hue+",15%,8%),hsl("+theme.hue+",25%,25%))":"linear-gradient(to right,#c8d0e0,#ecf0fa)"},
    ],
    shape:[
      {k:"radius",   label:"Corner Radius",    min:4,  max:32, step:1,   fmt:v=>v+"px",
       css:dark?"linear-gradient(to right,hsl("+theme.hue+",15%,10%),hsl("+theme.hue+",15%,22%))":"linear-gradient(to right,#d0d8e8,#f0f4ff)"},
    ],
  };

  const panelBg = "hsl("+theme.hue+","+theme.sat+"%,"+(dark?Math.min(18,theme.bgL+4):94)+"%)";

  const ThemePanel = themeOpen && (
    <div style={{
      position:"fixed",top:58,right:14,zIndex:300,
      width:310,
      background:panelBg,
      
      borderRadius:"var(--radius,18px)",
      border:"1px solid var(--cd)",
      boxShadow:"var(--nm-out)",
      overflowX:"clip",
      maxHeight:"90vh",
      display:"flex",flexDirection:"column",
    }}>
      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",height:"100%"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px 10px",borderBottom:"1px solid var(--cd)"}}>
          <span style={{fontSize:13,fontWeight:800,color:"var(--ct)",letterSpacing:"-.2px"}}>🎨 Theme Studio</span>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={()=>{const nd=!dark;updTheme("dark",nd);setDark(nd);}}
              style={{padding:"4px 10px",borderRadius:8,border:"1px solid var(--cd)",
                background:"var(--nm-bg)",color:"var(--ct)",fontSize:11,fontWeight:700,cursor:"pointer",
                boxShadow:"var(--nm-sm-out)"}}>
              {dark?"☀ Light":"🌙 Dark"}
            </button>
            <button onClick={()=>setThemeOpen(false)}
              style={{width:26,height:26,borderRadius:8,border:"none",background:"var(--nm-bg)",
                color:"var(--cu)",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",
                justifyContent:"center",boxShadow:"var(--nm-sm-out)"}}>✕</button>
          </div>
        </div>

        {/* Section tabs */}
        <div style={{display:"flex",gap:3,padding:"10px 10px 6px"}}>
          {TSECS.map(sec=>(
            <button key={sec.id} onClick={()=>setThemeSec(sec.id)} style={{
              flex:1,padding:"7px 2px",borderRadius:12,border:"none",cursor:"pointer",
              background:"var(--nm-bg)",
              color:themeSec===sec.id?"var(--ct)":"var(--cu)",
              boxShadow:themeSec===sec.id?"var(--nm-in)":"var(--nm-sm-out)",
              transform:themeSec===sec.id?"translateY(1px)":"none",
              fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".04em",
              display:"flex",flexDirection:"column",alignItems:"center",gap:2,
              transition:"all .12s ease"}}>
              <span style={{fontSize:15,lineHeight:1}}>{sec.icon}</span>
              {sec.label}
            </button>
          ))}
        </div>

        {/* Gradient live preview (gradient section only) */}
        {themeSec==="gradient"&&(
          <div style={{margin:"0 12px 8px",height:36,borderRadius:10,
            background:"var(--cbg)",boxShadow:"var(--nm-in)",border:"1px solid var(--cd)"}}/>
        )}

        {/* Sliders */}
        <div style={{overflowY:"auto",padding:"4px 14px 14px",flex:1}}>
          {(TSLIDERS[themeSec]||[]).map(({k,label,min,max,step,fmt,css})=>{
            const pct=((theme[k]-min)/(max-min)*100).toFixed(1);
            return(
              <div key={k} style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <span style={{fontSize:10,fontWeight:700,color:"var(--cu)",textTransform:"uppercase",letterSpacing:".07em"}}>{label}</span>
                  <span className="mono" style={{fontSize:11,fontWeight:700,color:"var(--ct)",
                    background:"var(--nm-bg)",padding:"2px 7px",borderRadius:6,
                    boxShadow:"var(--nm-in)"}}>{fmt(theme[k])}</span>
                </div>
                <div style={{position:"relative",height:22,display:"flex",alignItems:"center"}}>
                  {/* Track */}
                  <div style={{position:"absolute",left:0,right:0,height:7,top:"50%",transform:"translateY(-50%)",
                    borderRadius:6,background:css,
                    boxShadow:"inset 0 2px 5px rgba(0,0,0,.4),inset 0 -1px 0 rgba(255,255,255,.06)"}}/>
                  {/* Neumorphic thumb */}
                  <div style={{
                    position:"absolute",
                    left:"calc("+pct+"% - 9px)",
                    top:"50%",transform:"translateY(-50%)",
                    width:18,height:18,borderRadius:"50%",
                    background:"var(--nm-bg)",
                    boxShadow:"var(--nm-sm-out)",
                    pointerEvents:"none",zIndex:2}}/>
                  {/* Invisible native range for interaction */}
                  <input type="range" min={min} max={max} step={step} value={theme[k]}
                    onChange={e=>updTheme(k,Number(e.target.value))}
                    style={{position:"absolute",inset:0,width:"100%",opacity:0,cursor:"pointer",zIndex:3,height:22,margin:0}}/>
                </div>
              </div>
            );
          })}

          {/* Divider + reset */}
          <div style={{height:1,background:"var(--cd)",marginTop:8,marginBottom:12}}/>
          <button onClick={()=>{setTheme({...DEFAULT_THEME});setDark(DEFAULT_THEME.dark);}}
            style={{width:"100%",padding:"9px",borderRadius:10,border:"none",
              background:"var(--nm-bg)",color:"var(--cm)",fontSize:11,fontWeight:700,
              cursor:"pointer",boxShadow:"var(--nm-sm-out)"}}>
            ↺ Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );



  return(
    <div style={{minHeight:"100vh",background:"var(--cbg)",fontFamily:"'DM Sans',system-ui,sans-serif",color:C.text}}>
      <style>{css}</style>

      {/* Nav */}
      <div style={{position:"sticky",top:0,zIndex:100,borderBottom:"1px solid var(--cd)",background:"var(--cn)",boxShadow:"inset 0 -1px 0 rgba(255,255,255,.04)"}}>
        <div style={{maxWidth:1400,margin:"0 auto",padding:"10px 24px",display:"flex",alignItems:"center",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:800,color:C.text,letterSpacing:"-.4px",display:"flex",alignItems:"center",gap:6}}>
              <span style={{display:"inline-flex",width:28,height:28,borderRadius:8,background:`linear-gradient(135deg,${ACC.orange},${ACC.yellow})`,alignItems:"center",justifyContent:"center",fontSize:14,boxShadow:`0 3px 10px ${ACC.orange}55,inset 0 1px 0 rgba(255,255,255,.4)`}}>🏡</span>
              MortgageSim
            </div>
            <div style={{fontSize:10,color:C.muted,letterSpacing:".02em",marginTop:1}}>{fmt(cfg.homePrice)} · {(cfg.mortRate||6.8).toFixed(2)}% · {toDate(sim.mo)}</div>
          </div>
          <div style={{display:"flex",background:"var(--nm-bg)",borderRadius:14,padding:4,gap:3,boxShadow:"var(--nm-in)"}}>
            {[["setup","⚙ Setup"],["simulate","▶ Simulate"]].map(([t,l])=>(
              <button key={t} onClick={()=>setTab(t)} style={{
                padding:"7px 14px",borderRadius:11,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,
                background:tab===t?"var(--nm-bg)":"transparent",
                color:tab===t?C.text:C.sub,
                boxShadow:tab===t?"var(--nm-out)":"none",
                transition:"all .2s"}}>{l}</button>
            ))}
          </div>
          {/* Theme toggle */}
          <button onClick={()=>setThemeOpen(o=>!o)} style={{
            width:38,height:38,borderRadius:12,
            border:`1px solid ${themeOpen?ACC.teal+"88":"var(--cd)"}`,
            background:themeOpen?"var(--nm-bg)":"var(--ci)",
            cursor:"pointer",fontSize:16,
            boxShadow:themeOpen?`var(--nm-in), 0 0 12px ${ACC.teal}33`:"var(--nm-sm-out)",
            transition:"all .2s",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} className="btn-nm-sm">
            🎨
          </button>
          {tab==="simulate"&&<div style={{width:9,height:9,borderRadius:"50%",background:playing?ACC.green:C.muted,boxShadow:playing?`0 0 10px ${ACC.green},0 0 4px ${ACC.green}`:"none",transition:"all .3s",flexShrink:0}}/>}
          {tab==="setup"&&(
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={()=>{applyReset();setTab("simulate");}} style={{
                padding:"8px 16px",borderRadius:12,border:"none",cursor:"pointer",
                fontSize:12,fontWeight:800,
                background:ACC.green,color:"#fff",
                boxShadow:"4px 4px 10px "+ACC.green+"55, inset 0 1px 0 rgba(255,255,255,.25)"
              }} className="btn-nm">▶ Start</button>
              <button onClick={applyReset} style={{
                padding:"8px 12px",borderRadius:12,border:"none",cursor:"pointer",
                fontSize:12,fontWeight:700,
                background:"var(--nm-bg)",color:C.sub,
                boxShadow:"var(--nm-sm-out)"
              }} className="btn-nm-sm">↺</button>
            </div>
          )}
        </div>
      </div>
      {ThemePanel}

      <div style={{paddingTop:16}}>
        <div style={{display:tab==="setup"?"block":"none"}}>
          <SetupTab cfg={cfg} setCfg={setCfg} sim={sim} onStart={()=>{applyReset();setTab("simulate");}} onReset={applyReset} derived={derived} setupOrder={setupOrder} setSetupOrder={setSetupOrder} winW={winW}/>
        </div>
        <div style={{display:tab==="simulate"?"block":"none"}}>
          <SimTab sim={simWithUpdater} cfg={cfg} setCfg={setCfg} playing={playing} setPlaying={setPlaying} timeStep={timeStep} setTimeStep={setTimeStep} speedMult={speedMult} setSpeedMult={setSpeedMult} stickyTop={stickyTop} ctrlBarRef={ctrlBarRef} stepOnce={stepOnce} onReset={applyReset} chart={chart} setChart={setChart} derived={derived} chartData={chartData} barData={barData} acctOrder={acctOrder} setAcctOrder={setAcctOrder} trendMode={trendMode} setTrendMode={setTrendMode} selLines={selLines} setSelLines={setSelLines} winW={winW} updSimMulti={updSimMulti}/>
        </div>
      </div>
    </div>
  );
}
