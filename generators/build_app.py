# -*- coding: utf-8 -*-
import json
import os
# Paths resolve from THIS file's location, so the project runs from any folder and
# in either layout: flat (everything beside this script) or the handoff layout
# (generators/ + data/ + apps/static/). Never hardcode an absolute path here.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE) if os.path.basename(HERE) == "generators" else HERE
_d   = os.path.join(ROOT, "data")
DATA_DIR = _d if os.path.isdir(_d) else HERE
base = HERE + os.sep                      # where the build_*.py modules live
DATA=open(os.path.join(DATA_DIR,"binder_data.json")).read()
USER_EMAIL="dustyn@blasig.us"

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MTG Sealed Collecting Binder</title>
<style>
:root{
  --purple:#3a2d6b; --purple2:#4b3a86; --lpurple:#6a4fb0; --accent:#8a6ee0;
  --bg:#f5f3fb; --card:#ffffff; --ink:#1f1b32; --muted:#6b6680; --line:#e7e3f2;
  --rowalt:#faf9fd; --gold:#b5852a; --green:#3f9d6b; --good:#34c27a;
  --shadow:0 1px 3px rgba(40,25,90,.08),0 8px 24px rgba(40,25,90,.06);
}
[data-theme="dark"]{
  --purple:#1c1730; --purple2:#241d3d; --lpurple:#9d86e8; --accent:#b39cff;
  --bg:#14111f; --card:#1d1930; --ink:#ece9f6; --muted:#9b95b3;
  --line:#2c2742; --rowalt:#211c36; --shadow:0 1px 3px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;}
a{color:inherit}
.wrap{max-width:1560px;margin:0 auto;padding:0 18px 70px}

/* header */
header.top{position:sticky;top:0;z-index:40;background:linear-gradient(120deg,var(--purple),var(--purple2));
  color:#fff;box-shadow:0 2px 18px rgba(30,18,70,.25)}
.top-in{max-width:1560px;margin:0 auto;padding:13px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:11px;min-width:0}
.logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#b39cff,#6a4fb0);
  display:grid;place-items:center;font-weight:800;color:#fff;box-shadow:0 3px 10px rgba(0,0,0,.25);flex:none}
.brand h1{font-size:15.5px;margin:0;font-weight:700;letter-spacing:.2px;line-height:1.15}
.brand p{margin:1px 0 0;font-size:11px;opacity:.7}
.spacer{flex:1}
/* Everything after the brand rides the right edge as one cluster, so the ring,
   the sync pill and the buttons share a baseline and end flush with the card
   below rather than drifting. */
.hright{display:flex;align-items:center;gap:14px;margin-left:auto;flex:none}
.ring{display:flex;align-items:center;gap:10px}
.ring small{font-size:10.5px;opacity:.8;text-transform:uppercase;letter-spacing:.6px}
.ring b{font-size:14px}
.hbtns{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.btn{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.10);color:#fff;
  font-size:12px;padding:7px 11px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:6px;
  transition:.15s;white-space:nowrap}
.btn:hover{background:rgba(255,255,255,.2)}
.btn.solid{background:#fff;color:var(--purple);border-color:#fff;font-weight:600}
.btn.solid:hover{background:#f0ecff}
/* Sync LED. The wrapper holds a fixed 29px slot; the pill is absolutely
   positioned against its right edge so expanding grows leftward into empty
   header space instead of shoving the buttons around. */
.ledwrap{position:relative;width:29px;height:29px;flex:none}
.drivepill{position:absolute;right:0;top:0;height:29px;display:flex;align-items:center;
  padding:0 10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);
  border-radius:20px;font-size:11.5px;color:#fff;font-family:inherit;cursor:pointer;
  white-space:nowrap;overflow:hidden;transition:background .15s}
.drivepill:hover{background:rgba(255,255,255,.2)}
.synctxt{max-width:0;opacity:0;overflow:hidden;
  transition:max-width .2s ease, opacity .15s ease, margin-left .2s ease}
.ledwrap:hover .synctxt,
.drivepill:focus-visible .synctxt,
.ledwrap.alert .synctxt{max-width:190px;opacity:1;margin-left:7px}
/* square icon buttons in the header, sized to match the pill */
.ibtn{width:31px;height:29px;padding:0;justify-content:center;font-size:14px;line-height:1}
.hmenu{color:var(--ink)}
.msep{height:1px;background:var(--line);margin:4px 7px}
.mkey{color:var(--muted);font-size:12px}
.dot{width:8px;height:8px;border-radius:50%;background:#ffd36b;flex:none}
.dot.on{background:var(--good);box-shadow:0 0 0 3px rgba(52,194,122,.25)}

/* tabs */
.tabs{display:flex;gap:6px;overflow-x:auto;padding:12px 0 0}
.tab{flex:none;background:var(--card);border:1px solid var(--line);border-bottom:none;
  border-radius:12px 12px 0 0;padding:11px 15px;cursor:pointer;min-width:172px;transition:.15s;box-shadow:var(--shadow)}
.tab:hover{transform:translateY(-1px)}
.tab.active{background:var(--card);border-color:var(--lpurple)}
.tab .tt{font-size:12.5px;font-weight:700;display:flex;justify-content:space-between;gap:8px}
.tab .tpct{font-size:11px;color:var(--lpurple);font-weight:700}
.tbar{height:5px;border-radius:4px;background:var(--line);margin-top:7px;overflow:hidden}
.tbar > i{display:block;height:100%;background:linear-gradient(90deg,var(--lpurple),var(--accent));border-radius:4px;transition:width .35s}
.tab .tsub{font-size:10px;color:var(--muted);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* controls */
/* Was welded to the bottom of the tab strip (no top border, square top corners).
   With the tabs gone it stands alone, so it gets all four sides back. */
/* nowrap is deliberate. A wrapping flex container places items on lines using
   their natural widths and only shrinks what is already on a line — so with
   flex-wrap:wrap the picker never shrank, it just pushed the buttons down. With
   nowrap it has to shrink, which is what the ellipsis is for. */
.controls{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;background:var(--card);
  border:1px solid var(--lpurple);border-radius:12px;padding:11px 14px;margin-top:12px;
  box-shadow:var(--shadow);position:sticky;top:62px;z-index:30}
/* Search collapses to its icon. It was flex:1 with a 170px floor, which is what
   pushed the buttons onto a second line in narrow windows. Like the sync LED it
   is pinned to the right edge of a fixed slot, so it expands leftward across
   empty bar space instead of displacing anything. */
.searchwrap{position:relative;width:33px;height:31px;flex:none}
.search{position:absolute;right:0;top:0;height:31px;width:33px;overflow:hidden;
  display:flex;align-items:center;gap:7px;background:var(--bg);
  border:1px solid var(--line);border-radius:9px;padding:0 8px;
  transition:width .2s ease;z-index:45}
.sicon{font-size:13px;line-height:1;flex:none}
.searchwrap:hover .search,.search:focus-within,.searchwrap.has .search{width:min(330px,52vw)}
.search input{border:none;background:none;outline:none;font-size:13px;color:var(--ink);
  width:100%;min-width:0}
.toggle{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);cursor:pointer;user-select:none}
.sw{width:34px;height:19px;border-radius:20px;background:var(--line);position:relative;transition:.2s;flex:none}
.sw i{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.sw.on{background:var(--lpurple)} .sw.on i{left:17px}
.minibtn{font-size:11.5px;color:var(--lpurple);background:none;border:1px solid var(--line);
  padding:6px 9px;border-radius:8px;cursor:pointer}
.minibtn:hover{background:var(--bg)}

/* checklist picker */
/* The picker yields before the bar wraps: it shrinks and ellipsises the title
   rather than holding its natural width and pushing the buttons to a new line. */
.controls > .menuwrap{flex:0 1 auto;min-width:74px}
.clbtn{display:flex;align-items:center;gap:8px;width:100%;min-width:0;max-width:300px;height:31px;padding:0 10px;
  border:1px solid var(--line);border-radius:9px;background:var(--card);cursor:pointer;
  font-family:inherit;font-size:12.5px;font-weight:700;color:var(--ink)}
.clbtn:hover{background:var(--bg)}
/* min-width:0 on both the button and the label — without it the nowrap title
   sets the min-content width and the whole thing refuses to shrink. */
.clname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.clpct{color:var(--lpurple);font-weight:700;font-size:11.5px;flex:none}
.clcaret{color:var(--muted);font-size:10px;flex:none}
.clmenu{left:0;right:auto;min-width:296px;max-height:min(70vh,520px);overflow:auto}
.clitem{padding:8px 10px;border-radius:8px;cursor:pointer}
.clitem:hover{background:var(--bg)}
.clitem.on{background:rgba(106,79,176,.10);box-shadow:inset 0 0 0 1px var(--lpurple)}
.clitop{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;font-weight:700}
.clisub{font-size:10.5px;color:var(--muted);margin-top:4px}

/* Control bar: search takes the slack, the buttons stay put and never wrap. */
.cbtns{display:flex;align-items:center;gap:8px;flex:none}
.iconbtn{width:33px;height:31px;flex:none;display:grid;place-items:center;padding:0;
  border:1px solid var(--line);border-radius:8px;background:none;color:var(--lpurple);cursor:pointer}
.iconbtn:hover{background:var(--bg)}
.iconbtn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;
  stroke-linecap:round;stroke-linejoin:round}
.vbtn{display:flex;align-items:center;gap:6px;height:31px}
.vgear{font-size:13px;line-height:1}
.menuwrap{position:relative}
.menu{position:absolute;right:0;top:calc(100% + 6px);min-width:212px;padding:5px;z-index:50;
  background:var(--card);border:1px solid var(--line);border-radius:11px;box-shadow:var(--shadow);display:none}
.menu.show{display:block}
.mrow{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 10px;
  border-radius:8px;font-size:12.5px;color:var(--ink);cursor:pointer;user-select:none}
.mrow:hover{background:var(--bg)}
.menu select{font-size:12px;color:var(--lpurple);background:var(--card);
  border:1px solid var(--line);border-radius:7px;padding:4px 6px;cursor:pointer}

/* the collecting rule for the active checklist */
.rulebox{column-span:all;-webkit-column-span:all;margin:14px 2px 12px;padding:10px 13px;
  background:var(--rowalt);border:1px solid var(--line);border-left:3px solid var(--lpurple);
  border-radius:9px;font-size:12px;color:var(--muted);line-height:1.6}
.rulebox b{color:var(--ink);font-weight:700;margin-right:3px}
.boxlegend{display:flex;align-items:center;gap:13px;flex-wrap:wrap;margin-top:5px;font-size:10.5px}
.boxlegend span{display:inline-flex;align-items:center;gap:5px}
.legendgoal i,.legendbonus i{width:19px;height:17px;border-radius:5px;display:grid;place-items:center;
  font:700 9px/1 inherit;background:var(--card);font-style:normal}
.legendgoal i{border:2px solid var(--gold);color:var(--gold)}
.legendbonus i{border:1.6px dashed var(--muted);color:var(--muted)}

/* era cards — NOTE: no overflow:hidden here. An ancestor with overflow:hidden
   silently disables position:sticky on the frozen column header inside. */
.era{background:var(--card);border:1px solid var(--line);border-radius:13px;
  box-shadow:var(--shadow)}
.era-h{display:flex;align-items:center;gap:12px;padding:12px 15px;cursor:pointer;
  border-radius:12px 12px 0 0;background:linear-gradient(90deg,rgba(106,79,176,.07),transparent)}
/* frozen column headings */
.era-cols{display:flex;gap:12px;align-items:flex-end;padding:7px 8px 6px;
  position:sticky;top:var(--stickytop,122px);z-index:20;
  background:var(--card);border-bottom:1px solid var(--line)}
.era-cols .slotlab{color:var(--lpurple);font-weight:700}
.colera{font-size:10.5px;color:var(--muted);font-weight:600;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;align-self:center}
.chev{transition:.2s;color:var(--muted);font-size:13px}
.era.closed .chev{transform:rotate(-90deg)}
.era-h h3{margin:0;font-size:13.5px;font-weight:700;flex:1}
.ebar{width:120px;height:7px;border-radius:5px;background:var(--line);overflow:hidden;flex:none}
.ebar > i{display:block;height:100%;background:linear-gradient(90deg,var(--lpurple),var(--accent));transition:width .35s}
.ecount{font-size:11.5px;color:var(--muted);min-width:54px;text-align:right;font-variant-numeric:tabular-nums}
.ecount.bonus{font-size:9px;font-weight:800;letter-spacing:.08em;color:var(--gold)}
.ebar.bonus{visibility:hidden}
.era-b{padding:2px 8px 8px}
.era.closed .era-b{display:none}

/* rows */
/* Each entry is an .item: the visible .row plus a collapsed detail drawer.
   Striping, borders and the done state live on the wrapper so an open drawer
   stays visually attached to its row. */
.item{border-bottom:1px solid var(--line);border-radius:9px}
.item:last-child{border-bottom:none}
.item:nth-child(even){background:var(--rowalt)}
.item.done .meta,.item.done .val,.item.done .qtyctrl.goal{opacity:.62}
.row{display:flex;align-items:center;gap:12px;padding:6px 8px;border-radius:9px}
/* name, code and type on one line */
.mline{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
/* detail drawer */
.rowtog{width:22px;height:22px;flex:none;display:grid;place-items:center;padding:0;
  border:none;background:none;color:var(--muted);cursor:pointer;border-radius:6px}
.rowtog:hover{background:var(--line);color:var(--lpurple)}
.rowtog svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;
  stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}
.item.open .rowtog svg{transform:rotate(180deg)}
.ghosttog{pointer-events:none}   /* keeps rows without details aligned */
.rowdet{display:none;padding:2px 34px 10px 8px;font-size:11.5px;color:var(--muted);
  line-height:1.55;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:start}
.item.open .rowdet{display:grid}
.rowpics{display:flex;gap:8px;flex-wrap:wrap}
.productpic{margin:0;width:112px}
.productpic img{display:block;width:112px;height:112px;object-fit:contain;border-radius:9px;
  border:1px solid var(--line);background:#fff;padding:4px}
.productpic figcaption{margin-top:4px;font-size:9.5px;line-height:1.25;color:var(--muted)}
.productpic figcaption b{display:block;color:var(--ink);font-size:10px;font-weight:650}
.rowcopy{min-width:0;padding-top:2px}
.rowcopy.wide{grid-column:1/-1}
.checks{display:flex;flex-wrap:wrap;gap:6px;flex:none;min-width:30px}
/* Compact quantity control. The number owns the layout footprint; +/- slide out
   over the surrounding whitespace on hover or keyboard/touch focus. */
.qtyctrl{position:relative;width:30px;height:24px;display:grid;place-items:center;z-index:1}
.qtyctrl:hover,.qtyctrl:focus-within{z-index:12}
/* Once opened, this invisible bridge keeps :hover alive while the pointer crosses
   the 2px gap between the compact count and either translated button. */
.qtyctrl::before{content:"";position:absolute;z-index:1;inset:-4px -32px;pointer-events:none}
.qtyctrl:hover::before,.qtyctrl:focus-within::before{pointer-events:auto}
.qtynum,.qtybtn{height:24px;border-radius:7px;border:1.6px solid var(--lpurple);
  font:700 12px/1 inherit;display:grid;place-items:center;cursor:pointer;transition:.18s ease}
.qtynum{position:relative;z-index:3;width:30px;padding:0;background:var(--card);color:var(--ink);
  font-variant-numeric:tabular-nums;box-shadow:0 1px 3px rgba(30,18,70,.08)}
.qtynum.met{background:var(--qtyc,var(--lpurple));border-color:var(--qtyc,var(--lpurple));color:#fff}
.qtyctrl.goal .qtynum{box-shadow:0 0 0 1.5px var(--gold),0 1px 3px rgba(30,18,70,.08)}
.qtyctrl.goal::after{content:"★";position:absolute;z-index:5;right:-6px;top:-7px;color:var(--gold);
  font-size:8px;line-height:1;text-shadow:0 1px var(--card);pointer-events:none}
.qtyctrl.bonus .qtynum{border-style:dashed;border-color:var(--muted);color:var(--muted);box-shadow:none}
.qtyctrl.bonus .qtynum.owned{border-style:solid;background:var(--qtyc,var(--lpurple));
  border-color:var(--qtyc,var(--lpurple));color:#fff;opacity:.82}
.qtybtn{position:absolute;z-index:2;top:0;width:25px;padding:0;background:var(--card);color:var(--lpurple);
  opacity:0;pointer-events:none;transform:translateX(0) scale(.75)}
.qtybtn.minus{right:2px}.qtybtn.plus{left:2px}
.qtyctrl:hover .qtybtn,.qtyctrl:focus-within .qtybtn{opacity:1;pointer-events:auto;transform:scale(1)}
.qtyctrl:hover .qtybtn.minus,.qtyctrl:focus-within .qtybtn.minus{transform:translateX(-30px) scale(1)}
.qtyctrl:hover .qtybtn.plus,.qtyctrl:focus-within .qtybtn.plus{transform:translateX(30px) scale(1)}
.qtybtn:hover,.qtybtn:focus-visible{background:var(--lpurple);color:#fff;outline:none}
.qtybtn:disabled{opacity:0!important;pointer-events:none!important}
.meta{flex:1;min-width:0}
.mname{font-size:13px;font-weight:650;line-height:1.2}
.msub{display:flex;align-items:center;gap:7px;margin-top:3px;flex-wrap:wrap}
.code{font-size:10px;color:var(--muted);font-variant:small-caps;letter-spacing:.3px;
  border:1px solid var(--line);border-radius:5px;padding:1px 5px}
.tag{font-size:9.5px;color:#fff;padding:1.5px 7px;border-radius:9px;font-weight:600;white-space:nowrap}
/* (row notes now live in the .rowdet drawer, not a tooltip) */
.val{font-size:12.5px;font-weight:700;color:var(--ink);min-width:60px;text-align:right;flex:none;font-variant-numeric:tabular-nums}
.val.est{color:var(--gold)}
.slotlabel{font-size:9px;color:var(--muted);margin-right:2px}

/* toast + modal */
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);
  background:var(--purple);color:#fff;padding:11px 18px;border-radius:11px;font-size:13px;
  box-shadow:0 10px 30px rgba(0,0,0,.3);opacity:0;transition:.3s;z-index:80;display:flex;gap:9px;align-items:center}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.modal-bg{position:fixed;inset:0;background:rgba(20,12,40,.5);backdrop-filter:blur(3px);
  display:none;place-items:center;z-index:70;padding:18px}
.modal-bg.show{display:grid}
.modal{background:var(--card);border-radius:16px;max-width:440px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.modal h2{margin:0 0 4px;font-size:18px;display:flex;align-items:center;gap:10px}
.modal p{font-size:13px;color:var(--muted);line-height:1.5}
.gicon{width:30px;height:30px;border-radius:8px;background:#fff;border:1px solid var(--line);display:grid;place-items:center;font-weight:800}
.modal .actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
.pbtn{flex:1;min-width:130px;padding:11px;border-radius:10px;border:none;cursor:pointer;font-size:13px;font-weight:600}
.pbtn.g{background:#1a73e8;color:#fff} .pbtn.g:hover{background:#1666d4}
.pbtn.ghost{background:var(--bg);color:var(--ink);border:1px solid var(--line)}
.foot{font-size:11px;color:var(--muted);text-align:center;margin-top:26px;line-height:1.6}
.info{font-size:11.5px;color:var(--muted);background:var(--bg);border:1px solid var(--line);
  border-radius:9px;padding:9px 11px;margin-top:14px;line-height:1.5}

/* ---- responsive multi-column: 1 col phone / 2 laptop / 3 big monitor ---- */
#content{column-width:480px;column-gap:16px}
#content > .subhead{column-span:all;-webkit-column-span:all}
.era{break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;
  display:inline-block;width:100%;margin:0 0 14px}
@media(max-width:900px){#content{column-width:auto;column-count:1}}

/* labelled checkbox clusters — so 2/4/6 boxes are never ambiguous */
.checks{display:flex;flex-wrap:wrap;gap:11px;flex:none;align-items:flex-end}
.slotgrp{display:flex;flex-direction:column;gap:3px}
.slotlab{font-size:8.5px;font-style:normal;color:var(--muted);letter-spacing:.2px;white-space:nowrap;line-height:1}
.slotboxes{display:flex;gap:5px;min-width:30px;justify-content:center}
/* Mixed-type eras: fixed-width columns so the boxes AND the set name line up
   down the whole era, with a blank cell where a set had no such product. */
.checkgrid{display:grid;grid-template-columns:repeat(var(--n),var(--gcol,58px));
  gap:11px;align-items:flex-end;flex-wrap:nowrap}
.checkgrid .slotgrp{min-width:0}
.checkgrid .slotgrp.blank{visibility:hidden}
/* Single-type eras with a varying box count: fixed block, wraps past 5. */
.era-b .checks{min-width:var(--onew,30px)}
.era-b .slotboxes{flex-wrap:wrap;max-width:var(--onew,none)}
.checkgrid .slotboxes{max-width:none}
@media(max-width:620px){
  .val{display:none}.tab{min-width:150px}.brand p{display:none}
  .row{gap:8px;padding-left:5px;padding-right:5px}
  .checkgrid{grid-template-columns:repeat(var(--n),38px);gap:5px}
  .checkgrid .slotlab{font-size:7px;white-space:normal;overflow-wrap:anywhere;
    line-height:1.05;text-align:center;min-height:15px;display:grid;place-items:end center}
  .era-cols{gap:8px;padding-left:5px;padding-right:5px}
  .rowdet{grid-template-columns:88px minmax(0,1fr);padding-right:8px;gap:9px}
  .productpic,.productpic img{width:82px}
  .productpic img{height:96px}
}
/* Tightest widths: the gear alone carries the View menu. */
@media(max-width:480px){
  .clbtn{max-width:150px}
  .vlabel{display:none}
  .vbtn{width:33px;justify-content:center;padding:0}
  .search{min-width:120px}
}
</style>
</head>
<body>
<header class="top">
 <div class="top-in">
   <div class="brand">
     <div class="logo">M</div>
     <div><h1>MTG Sealed Collecting Binder</h1><p>Live checklist &bull; auto-saved &bull; build __BUILD__</p></div>
   </div>
   <div class="spacer"></div>
   <div class="hright">
   <div class="hbtns">
     <!-- Normally just an LED. Hover (or keyboard-focus) expands it leftward to
          say when it last synced; it also self-opens when there is something you
          should notice — unsaved changes or a sync error. The pill is the sync
          control too: it opens the same dialog the old "Sync Drive" button did. -->
     <div class="ledwrap" id="ledWrap">
       <button class="drivepill" id="drivePill" title="Sync settings">
         <span class="dot" id="driveDot"></span><span class="synctxt" id="driveTxt">Sync: off</span></button>
     </div>
     <button class="btn ibtn" id="themeBtn" title="Toggle light / dark" aria-label="Toggle light / dark">◐</button>
     <div class="menuwrap">
       <button class="btn ibtn" id="moreBtn" title="More actions" aria-label="More actions"
               aria-haspopup="true" aria-expanded="false">&#8943;</button>
       <div class="menu hmenu" id="moreMenu">
         <div class="mrow" id="syncItem"><span>Sync settings…</span></div>
         <div class="msep"></div>
         <div class="mrow" id="exportBtn"><span>Export progress</span><span class="mkey">&#10515;</span></div>
         <div class="mrow" id="importBtn"><span>Import progress</span><span class="mkey">&#10514;</span></div>
       </div>
     </div>
   </div>
   <div class="ring">
     <svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="5"/>
       <circle id="ringArc" cx="20" cy="20" r="16" fill="none" stroke="#b39cff" stroke-width="5" stroke-linecap="round" stroke-dasharray="100.5" stroke-dashoffset="100.5" transform="rotate(-90 20 20)"/></svg>
     <div><div class="ring"><b id="ovPct">0%</b></div><small id="ovNum">0 / 0</small></div>
   </div>
   </div>
 </div>
</header>

<div class="wrap">
  <div id="storeWarn" style="display:none"></div>
  <div class="controls">
    <!-- The checklist picker lives in the sticky bar, so which list you are
         looking at stays on screen while you scroll. It replaces the tab strip
         and still shows every list's progress, on demand. -->
    <div class="menuwrap">
      <button class="clbtn" id="clBtn" aria-haspopup="true" aria-expanded="false" title="Switch checklist">
        <span class="clname" id="clName">&nbsp;</span>
        <span class="clpct" id="clPct"></span>
        <span class="clcaret">&#9662;</span>
      </button>
      <div class="menu clmenu" id="clMenu"></div>
    </div>
    <div class="spacer"></div>
    <div class="cbtns">
      <div class="searchwrap" id="searchWrap">
        <div class="search"><span class="sicon">&#128269;</span>
          <input id="search" placeholder="Search sets or codes…" aria-label="Search sets or codes"></div>
      </div>
      <button class="iconbtn" id="expandAll" title="Expand all eras" aria-label="Expand all eras">
        <svg viewBox="0 0 24 24"><polyline points="7 6 12 11 17 6"/><polyline points="7 13 12 18 17 13"/></svg>
      </button>
      <button class="iconbtn" id="collapseAll" title="Collapse all eras" aria-label="Collapse all eras">
        <svg viewBox="0 0 24 24"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
      </button>
      <div class="menuwrap">
        <button class="minibtn vbtn" id="viewBtn" aria-haspopup="true" aria-expanded="false"
                title="View options"><span class="vgear">&#9881;</span><span class="vlabel">View</span></button>
        <div class="menu" id="viewMenu">
          <div class="mrow" id="hideDoneT"><span>Hide completed</span><div class="sw" id="hideDoneSw"><i></i></div></div>
          <div class="mrow"><span>Columns</span>
            <select id="colSel">
              <option value="auto">Auto</option><option value="1">1</option>
              <option value="2">2</option><option value="3">3</option></select></div>
        </div>
      </div>
    </div>
  </div>
  <div id="content"></div>
  <div class="foot">Values & counts are best-effort estimates compiled July 2026 — verify before purchase. MTG is © Wizards of the Coast. Personal collecting tool.</div>
</div>

<div class="toast" id="toast"></div>
<input type="file" id="fileIn" accept="application/json" style="display:none">

<div class="modal-bg" id="driveModal">
 <div class="modal">
   <h2><span class="gicon">&#9679;</span> Sync &amp; backup</h2>
   <p>Paste a GitHub token and this dashboard saves each checklist to its own private
      gist — straight from your browser, no server needed. Open the app anywhere, paste
      the same token, and your progress follows you.</p>
   <label style="font-size:11px;color:var(--muted);display:block;margin:14px 0 4px">GitHub token (classic, <b>gist</b> scope only)</label>
   <input id="ghToken" type="password" placeholder="ghp_..." style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;font-size:13px;background:var(--bg);color:var(--ink);box-sizing:border-box">
   <div class="info" id="driveInfo"></div>
   <div class="actions" id="modalActions"></div>
 </div>
</div>

<script>
const DATA = /*__DATA__*/;
const KEY = "mtgBinder_v1";

const LEGACY_KEY_RE=/^([^|]+)\|(\d+)\|(\d+)\|(\d+)$/;
function normKeyPart(v){return String(v||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');}
function contentHash(v){
  let h=0xcbf29ce484222325n;
  for(let i=0;i<v.length;i++){h^=BigInt(v.charCodeAt(i));h=BigInt.asUintN(64,h*0x100000001b3n);}
  return h.toString(16).padStart(16,'0');
}
function keyFor(cl,it,si){
  const sl=it.slots[si],group=normKeyPart(sl.k||sl.g||sl.l),ordinal=it.slots
    .slice(0,si).filter(s=>normKeyPart(s.k||s.g||s.l)===group).length;
  const seed=[normKeyPart(cl),normKeyPart(it.name),normKeyPart(it.code),group,ordinal].join('\u001f');
  return cl+'|v2|'+contentHash(seed);
}
function groupKeyFor(cl,it,group){
  const seed=[normKeyPart(cl),normKeyPart(it.name),normKeyPart(it.code),normKeyPart(group)].join('\u001f');
  return cl+'|extra|'+contentHash(seed);
}
function displayGroupFor(it,sl){
  const kidCopies=it.slots.length>1&&it.slots.every(s=>/^Kid\s+\d+$/i.test(s.g||s.l||''));
  return kidCopies?'Copies':(sl.g||(sl.l||''));
}
function slotRequired(sl){return sl.r!==false;}
function groupedSlots(it){
  const groups=[];
  it.slots.forEach((sl,si)=>{const n=displayGroupFor(it,sl);let g=groups.find(x=>x.n===n);
    if(!g){g={n,k:sl.k||n,items:[]};groups.push(g);}g.items.push({sl,si});});
  return groups;
}
function groupTarget(g){return g.items.filter(({sl})=>slotRequired(sl)).length;}
function legacyKeyMap(){
  const out={},seen={};
  DATA.checklists.forEach(cl=>cl.eras.forEach((era,ei)=>era.items.forEach((it,ii)=>
    it.slots.forEach((sl,si)=>{const pinned=Object.prototype.hasOwnProperty.call(sl,'legacy');
      const old=pinned?sl.legacy:(cl.id+'|'+ei+'|'+ii+'|'+si),next=keyFor(cl.id,it,si);
      const source=old===null?('unmapped '+cl.id+'|'+ei+'|'+ii+'|'+si):old;
      if(seen[next])throw new Error('Duplicate content key for '+source+' and '+seen[next]);
      seen[next]=source;if(old!==null)out[old]=next;
    }))));
  return out;
}
const LEGACY_KEYS=legacyKeyMap();
function migrateChecks(checks){
  const current={},legacy={},unknown={};let migrated=0;
  for(const[k,v]of Object.entries(checks||{})){if(!v)continue;
    if(LEGACY_KEY_RE.test(k)){legacy[k]=true;if(LEGACY_KEYS[k]){current[LEGACY_KEYS[k]]=true;migrated++;}else unknown[k]=true;}
    else current[k]=true;
  }
  return {checks:current,legacy,unknown,migrated};
}
function migrateState(s){
  s=s&&s.checks?s:{checks:{},drive:{connected:false,email:null,last:null},ui:{active:null,hideDone:false,closed:{}},theme:'light'};
  s.ui=s.ui||{active:null,hideDone:false,closed:{}};
  const m=migrateChecks(s.checks);
  if(m.migrated||Object.keys(m.unknown).length){
    s.checks=m.checks;
    s.legacyChecksV1=Object.assign({},s.legacyChecksV1||{},m.legacy,m.unknown);
    s.keyMigration={from:1,to:2,migrated:m.migrated,unknown:Object.keys(m.unknown).length,at:new Date().toISOString()};
    s._needsMigrationSave=true;
  }
  s.extras=s.extras||{};
  s.keyVersion=2;return s;
}
let state=load();
if(state._needsMigrationSave){delete state._needsMigrationSave;save();}
let active=state.ui.active||DATA.checklists[0].id;
let search="";
publishKeyDebug();
function load(){
  try{ const s=JSON.parse(localStorage.getItem(KEY)); if(s&&s.checks)return migrateState(s); }catch(e){}
  return migrateState({checks:{},drive:{connected:false,email:null,last:null},ui:{active:null,hideDone:false,closed:{}},theme:"light"});
}
function publishKeyDebug(){
  if(typeof document==='undefined')return;
  const root=document.documentElement;
  root.dataset.keyVersion=String(state.keyVersion||1);
  root.dataset.legacyRecoveryKeys=String(Object.keys(state.legacyChecksV1||{}).filter(k=>state.legacyChecksV1[k]).length);
  root.dataset.activeKeyVersion=Object.keys(state.checks||{}).filter(k=>state.checks[k])
    .every(k=>/^[^|]+\|v2\|[0-9a-f]{16}$/.test(k))?'v2':'mixed';
}
function save(){localStorage.setItem(KEY,JSON.stringify(state));publishKeyDebug();}

function isChecked(k){ return !!state.checks[k]; }
function checkedInGroup(cl,it,g){return g.items.filter(({si})=>isChecked(keyFor(cl,it,si))).length;}
function ownedForGroup(cl,it,g){return checkedInGroup(cl,it,g)+Math.max(0,Number(state.extras[groupKeyFor(cl,it,g.k||g.n)]||0));}
function itemComplete(cl,it){const required=groupedSlots(it).filter(g=>groupTarget(g)>0);
  return required.length>0&&required.every(g=>ownedForGroup(cl,it,g)>=groupTarget(g));}
function quantityNoun(group,count){return group==='Copies'?(count===1?'copy':'copies'):group;}
const COMPLETION_LINGER_MS=4000;
const completionLinger=new Map();
let completionLingerTimer=null;
function completionLingerKey(cl,it){return keyFor(cl,it,0);}
function isCompletionLingering(cl,it){
  const k=completionLingerKey(cl,it),until=completionLinger.get(k)||0;
  if(until<=Date.now()){if(until)completionLinger.delete(k);return false;}
  return true;
}
function scheduleCompletionLinger(){
  if(completionLingerTimer){clearTimeout(completionLingerTimer);completionLingerTimer=null;}
  const now=Date.now();
  for(const[k,until]of completionLinger){if(until<=now)completionLinger.delete(k);}
  if(!completionLinger.size)return;
  const next=Math.min(...completionLinger.values());
  completionLingerTimer=setTimeout(()=>{completionLingerTimer=null;updateAll();scheduleCompletionLinger();},
    Math.max(20,next-now+20));
}
function noteQuantityActivity(cl,it){
  const k=completionLingerKey(cl,it);
  if(state.ui.hideDone&&itemComplete(cl,it))completionLinger.set(k,Date.now()+COMPLETION_LINGER_MS);
  else completionLinger.delete(k);
  scheduleCompletionLinger();
}
function clearCompletionLinger(){
  completionLinger.clear();
  if(completionLingerTimer){clearTimeout(completionLingerTimer);completionLingerTimer=null;}
}
function changeQuantity(cl,it,g,delta){
  const extraKey=groupKeyFor(cl,it,g.k||g.n),extra=Math.max(0,Number(state.extras[extraKey]||0));
  if(delta>0){
    const next=g.items.find(({si})=>!isChecked(keyFor(cl,it,si)));
    if(next)state.checks[keyFor(cl,it,next.si)]=true;
    else state.extras[extraKey]=extra+1;
  }else if(delta<0){
    if(extra>0){if(extra===1)delete state.extras[extraKey];else state.extras[extraKey]=extra-1;}
    else{const checked=g.items.filter(({si})=>isChecked(keyFor(cl,it,si)));const last=checked[checked.length-1];
      if(last)delete state.checks[keyFor(cl,it,last.si)];}
  }
  noteQuantityActivity(cl,it);
  save();driveTouch();updateAll();
}

function clProgress(cl){
  let done=0,total=0;
  cl.eras.forEach((e,ei)=>e.items.forEach((it,ii)=>it.slots.forEach((sl,si)=>{
    if(!slotRequired(sl))return; total++; if(isChecked(keyFor(cl.id,it,si))) done++;
  })));
  return {done,total};
}
function eraProgress(cl,ei){
  let done=0,total=0;
  cl.eras[ei].items.forEach((it,ii)=>it.slots.forEach((sl,si)=>{
    if(!slotRequired(sl))return; total++; if(isChecked(keyFor(cl.id,it,si)))done++;}));
  return {done,total};
}
function overall(){
  let done=0,total=0;
  DATA.checklists.forEach(cl=>{const p=clProgress(cl);done+=p.done;total+=p.total;});
  return {done,total};
}
const pct=(d,t)=>t?Math.round(d/t*100):0;

/* The old tab strip scrolled out of view, taking with it the answer to "which
   list am I looking at?". The picker sits in the sticky bar instead, so the
   answer is always on screen, and the menu still shows every list's progress. */
function renderTabs(){
  const menu=document.getElementById('clMenu'); if(!menu) return;
  menu.innerHTML='';
  DATA.checklists.forEach(cl=>{
    const p=clProgress(cl); const pc=pct(p.done,p.total);
    if(cl.id===active){
      const n=document.getElementById('clName'), q=document.getElementById('clPct');
      if(n) n.textContent=cl.title;
      if(q) q.textContent=pc+'%';
    }
    const d=document.createElement('div'); d.className='clitem'+(cl.id===active?' on':'');
    d.innerHTML=`<div class="clitop"><span>${cl.title}</span><span class="tpct">${pc}%</span></div>
      <div class="tbar"><i style="width:${pc}%"></i></div>
      <div class="clisub">${p.done} / ${p.total} collected</div>`;
    d.onclick=()=>{ ghSyncIfDirty(); active=cl.id; state.ui.active=active; save();
      window.scrollTo(0,0); renderTabs(); renderContent(); };
    menu.appendChild(d);
  });
}

/* "$144 / $1,200" → faint MSRP, bold market (market is what matters) */
function valueHTML(val, est){
  if(!val) return '';
  if(val.indexOf(' / ')>-1){
    const p=val.split(' / ');
    const mkt=p[1].trim(), tba=/TBA/i.test(mkt);
    return '<span style="color:var(--muted);font-weight:400;font-size:10.5px">'+p[0].trim()+'</span>'
      +' <span style="font-weight:800;'+(tba?'font-style:italic;color:var(--muted)':(est?'color:var(--gold)':''))+'">'+mkt+'</span>';
  }
  return val;
}

/* The frozen headers must park directly under the search bar, which is itself
   sticky at 62px and changes height if it ever wraps — so measure, don't guess. */
function syncStickyTop(){
  const c=document.querySelector('.controls'); if(!c) return;
  document.documentElement.style.setProperty('--stickytop',(62+c.offsetHeight)+'px');
}
window.addEventListener('resize', syncStickyTop);

function applyCols(){
  const c=document.getElementById('content'); const v=(state.ui.cols||'auto');
  if(v==='auto'){ c.style.columnCount=''; c.style.columnWidth='480px'; }
  else { c.style.columnWidth='auto'; c.style.columnCount=v; }
  const sel=document.getElementById('colSel'); if(sel) sel.value=v;
}
function checkSVG(){return '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>';}

function renderContent(){
  const cl=DATA.checklists.find(c=>c.id===active);
  const host=document.getElementById('content'); host.innerHTML='';
  /* The collecting rule lives here, not in the checklist name — the picker stays
     short ("MTG Booster Packs") and the rule gets room to be a real sentence. */
  const sub=document.createElement('div');
  sub.className="rulebox";
  sub.innerHTML='<b>The rule</b> '+cl.sub+(cl.id==='boxes'?
    '<div class="boxlegend"><span class="legendgoal"><i>★</i> Goal — counts toward completion</span>'+
    '<span class="legendbonus"><i>0</i> Bonus — inventory only</span></div>':'');
  host.appendChild(sub);
  const q=search.trim().toLowerCase();
  cl.eras.forEach((era,ei)=>{
    const items=era.items.map((it,ii)=>({it,ii})).filter(({it,ii})=>{
      if(q && !(it.name.toLowerCase().includes(q)||(it.code||'').toLowerCase().includes(q))) return false;
      if(state.ui.hideDone&&itemComplete(cl.id,it)&&!isCompletionLingering(cl.id,it))return false;
      return true;
    });
    if(items.length===0) return;
    const ep=eraProgress(cl,ei); const epc=pct(ep.done,ep.total);
    const closed = state.ui.closed[cl.id+'|'+ei];
    const card=document.createElement('div'); card.className='era'+(closed?' closed':'');
    const h=document.createElement('div'); h.className='era-h';
    h.innerHTML=`<span class="chev">▼</span><h3>${era.name}</h3>
      <div class="ebar${ep.total?'':' bonus'}"><i style="width:${epc}%"></i></div>`+
      `<span class="ecount${ep.total?'':' bonus'}">${ep.total?(ep.done+'/'+ep.total):'BONUS'}</span>`;
    h.onclick=()=>{state.ui.closed[cl.id+'|'+ei]=!closed;save();renderContent();};
    card.appendChild(h);
    const body=document.createElement('div'); body.className='era-b';
    /* Column plan for this era: the ordered union of every product type any set
       in it has, plus a width wide enough for the widest label and the most
       boxes. Fixed px, because each row is its own grid — they can only line up
       if every column is the same declared width. */
    const eraCols=[]; let maxBoxes=1, maxLabel=1;
    era.items.forEach(it=>{
      const seen={};
      it.slots.forEach(sl=>{
        const g=displayGroupFor(it,sl);
        if(eraCols.indexOf(g)<0) eraCols.push(g);
        seen[g]=(seen[g]||0)+1;
        if(seen[g]>maxBoxes) maxBoxes=seen[g];
        if(g.length>maxLabel) maxLabel=g.length;
      });
    });
    /* Order columns by product tier, not by whichever set happened to come
       first — otherwise an era whose first set has no Set Booster renders
       Draft | Collector | Set. Unknown labels keep their appearance order. */
    const COLRANK={'Booster':0,'Draft':1,'Set':2,'Play':3,'Beyond':4,'Epilogue':5,
                   'Theme':6,'Jumpstart':7,'JS Vol. 2':8,'Mystery':9,'Collector':10,
                   'Variant':11,'Box':12,'Display':13,'Copies':14,'Kid 1':15,'Kid 2':16};
    eraCols.sort((a,b)=>{
      const ra=COLRANK[a], rb=COLRANK[b];
      if(ra===undefined && rb===undefined) return 0;
      if(ra===undefined) return 1;
      if(rb===undefined) return -1;
      return ra-rb;
    });
    const colW=Math.max(30,Math.ceil(maxLabel*5.2)+2);
    if(eraCols.length>1){ body.style.setProperty('--gcol', colW+'px'); }
    else {
      /* Single type, but a varying number of boxes — prerelease runs 1 to 10
         variants. Reserve a fixed block (wrapping past 5, as the PDF does) so
         the set names still start on one line. */
      body.style.setProperty('--onew','30px');
    }
    /* Frozen column headings, like a spreadsheet: one sticky bar per era that
       holds the type labels and the era name, so scrolling a long era never
       leaves you guessing which column is which. It replaces the per-row
       labels rather than adding to them. */
    const wantHead = eraCols.length>1 || maxBoxes>1;
    if(wantHead){
      const hd=document.createElement('div'); hd.className='era-cols';
      const hc=document.createElement('div');
      hc.className='checks'+(eraCols.length>1?' checkgrid':'');
      if(eraCols.length>1) hc.style.setProperty('--n', eraCols.length);
      eraCols.forEach(n=>{
        const g=document.createElement('div'); g.className='slotgrp';
        const lab=document.createElement('i'); lab.className='slotlab'; lab.textContent=n;
        g.appendChild(lab); hc.appendChild(g);
      });
      hd.appendChild(hc);
      const nm=document.createElement('span'); nm.className='colera'; nm.textContent=era.name;
      hd.appendChild(nm);
      body.appendChild(hd);
    }
    items.forEach(({it,ii})=>{
      const allDone=itemComplete(cl.id,it);
      const item=document.createElement('div'); item.className='item'+(allDone?' done':'');
      const row=document.createElement('div'); row.className='row';
      const checks=document.createElement('div'); checks.className='checks';
      let groups=groupedSlots(it);
      /* When an era mixes product types (Draft here, Draft+Set+Collector there,
         Collector only for Doctor Who), give every row the SAME columns in the
         same order and leave a gap where a set had no such product. Otherwise
         each row started at a different x and nothing lined up. */
      if(eraCols && eraCols.length>1){
        checks.classList.add('checkgrid');
        checks.style.setProperty('--n', eraCols.length);
        const byName={}; groups.forEach(g=>byName[g.n]=g);
        groups=eraCols.map(n=>byName[n]||{n,items:[],blank:true});
      }
      groups.forEach(g=>{
        const wrap=document.createElement('div'); wrap.className='slotgrp';
        if(g.blank){ wrap.className='slotgrp blank'; checks.appendChild(wrap); return; }
        /* Only label the row when there is no frozen header doing that job. */
        if(!wantHead && it.slots.length>1){
          const lab=document.createElement('i');lab.className='slotlab';lab.textContent=g.n;wrap.appendChild(lab);}
        const bx=document.createElement('div'); bx.className='slotboxes';
        const target=groupTarget(g),goal=target>0,owned=ownedForGroup(cl.id,it,g),color=g.items[0].sl.c||'var(--lpurple)';
        const ctrl=document.createElement('div');ctrl.className='qtyctrl '+(goal?'goal':'bonus');ctrl.style.setProperty('--qtyc',color);
        const minus=document.createElement('button');minus.type='button';minus.className='qtybtn minus';minus.textContent='−';
        minus.disabled=owned===0;minus.setAttribute('aria-label','Remove one '+(goal?'':'bonus ')+quantityNoun(g.n,1)+' from '+it.name);
        minus.onclick=()=>changeQuantity(cl.id,it,g,-1);
        const num=document.createElement('button');num.type='button';num.className='qtynum'+
          (goal&&owned>=target?' met':(!goal&&owned>0?' owned':''));
        num.textContent=owned;num.title=goal?(owned+' owned · goal '+target):(owned+' owned · bonus inventory · not part of completion');
        num.setAttribute('aria-label',owned+' '+quantityNoun(g.n,owned)+' owned for '+it.name+'; '+
          (goal?('goal '+target+'.'):('bonus inventory, not part of completion.'))+' Focus to adjust.');
        const plus=document.createElement('button');plus.type='button';plus.className='qtybtn plus';plus.textContent='+';
        plus.setAttribute('aria-label','Add one '+(goal?'':'bonus ')+quantityNoun(g.n,1)+' to '+it.name);plus.onclick=()=>changeQuantity(cl.id,it,g,1);
        ctrl.appendChild(minus);ctrl.appendChild(num);ctrl.appendChild(plus);bx.appendChild(ctrl);
        wrap.appendChild(bx); checks.appendChild(wrap);
      });
      const meta=document.createElement('div'); meta.className='meta';
      /* Drop any tag that just repeats a column heading — on the Packs tab the
         Draft/Set/Collector pills said exactly what the columns already say.
         Tags that carry real information (box type, set type, release date)
         don't match a column name and survive. */
      const tags=it.tags.filter(t=>eraCols.indexOf(t.t)<0)
        .map(t=>`<span class="tag" style="background:${t.c}">${t.t}</span>`).join('');
      /* Name, code and type share one line — the old two-line stack made every
         row ~20px taller for information that fits comfortably beside it. */
      meta.innerHTML=`<div class="mline"><span class="mname">${it.name}</span>`
        + (it.code?`<span class="code">${it.code}</span>`:'') + tags + `</div>`;
      row.appendChild(checks); row.appendChild(meta);
      if(it.value){ const v=document.createElement('div'); v.className='val'+(it.est?' est':'');
        v.innerHTML=valueHTML(it.value,it.est); v.title=it.value.includes(' / ')?'MSRP / current market':''; row.appendChild(v); }
      /* Detail drawer: only built when there is something to say. */
      const extra=[];
      if(it.note) extra.push(it.note);
      if(it.est)  extra.push('Value is a best-effort estimate — verify before buying.');
      const productImages=it.images||[];
      if(extra.length||productImages.length){
        const tog=document.createElement('button');
        tog.className='rowtog'; tog.setAttribute('aria-expanded','false');
        tog.setAttribute('aria-label','Show details for '+it.name);
        tog.innerHTML='<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';
        tog.onclick=(e)=>{ e.stopPropagation();
          const open=item.classList.toggle('open');
          if(open)item.querySelectorAll('img[data-src]').forEach(img=>{
            img.src=img.dataset.src;delete img.dataset.src;});
          tog.setAttribute('aria-expanded', open?'true':'false'); };
        row.appendChild(tog);
        const det=document.createElement('div'); det.className='rowdet';
        if(productImages.length){
          const pics=document.createElement('div');pics.className='rowpics';
          productImages.forEach(image=>{
            const fig=document.createElement('figure');fig.className='productpic';
            const img=document.createElement('img');img.dataset.src=image.url;
            img.alt=image.caption+' for '+it.name;img.loading='lazy';img.decoding='async';
            img.onerror=()=>{fig.style.display='none';};
            const cap=document.createElement('figcaption');
            const label=document.createElement('b');label.textContent=image.caption;
            const source=document.createElement('span');source.textContent='Image: '+image.source;
            cap.appendChild(label);cap.appendChild(source);fig.appendChild(img);fig.appendChild(cap);
            pics.appendChild(fig);
          });
          det.appendChild(pics);
        }
        if(extra.length){
          const copy=document.createElement('div');copy.className='rowcopy';
          if(!productImages.length)copy.classList.add('wide');
          copy.textContent=extra.join(' · ');det.appendChild(copy);
        }
        item.appendChild(row); item.appendChild(det);
      } else {
        const sp=document.createElement('span'); sp.className='rowtog ghosttog'; row.appendChild(sp);
        item.appendChild(row);
      }
      body.appendChild(item);
    });
    card.appendChild(body); host.appendChild(card);
  });
  if(host.children.length<=1){
    const none=document.createElement('div'); none.style.cssText="text-align:center;color:var(--muted);padding:50px;font-size:14px";
    none.textContent="No matches."; host.appendChild(none);
  }
}

function updateAll(){ renderTabs(); renderContent(); updateOverall(); syncStickyTop(); }
function updateOverall(){
  const o=overall(); const p=pct(o.done,o.total);
  document.getElementById('ovPct').textContent=p+'%';
  document.getElementById('ovNum').textContent=o.done+' / '+o.total;
  const arc=document.getElementById('ringArc'); const C=2*Math.PI*16;
  arc.setAttribute('stroke-dasharray',C); arc.setAttribute('stroke-dashoffset', C*(1-o.done/(o.total||1)));
}

/* ---- GitHub Gist sync — runs entirely in this browser ---- */
const BUILD="__BUILD__";
const GH_KEY="mtgBinder_gh", GH_API="https://api.github.com";
/* The whole connection is persisted, not just the token — so a refresh restores
   the username, the gist ids and the "synced Xm ago" state instead of looking
   like a fresh, unconnected app. Older builds stored a bare token string. */
function ghLoad(){
  const raw=localStorage.getItem(GH_KEY);
  const blank={token:"",user:null,ids:{},snap:{},last:null,busy:false};
  if(!raw) return blank;
  if(raw.charAt(0)!=="{") return Object.assign(blank,{token:raw});   // migrate old format
  try{ const o=JSON.parse(raw);
    return {token:o.token||"",user:o.user||null,ids:o.ids||{},snap:o.snap||{},
            last:o.last||null,busy:false}; }
  catch(e){ return blank; }
}
let gh=ghLoad();
let ghBootState=gh.token?"restoring":"off";   // off | restoring | ok | error
let ghBootMsg="";
function ghRemember(){ if(!gh.token){localStorage.removeItem(GH_KEY);return;}
  try{ localStorage.setItem(GH_KEY,JSON.stringify(
    {token:gh.token,user:gh.user,ids:gh.ids,snap:gh.snap,last:gh.last})); }catch(e){} }
const ghH=()=>({Authorization:"Bearer "+gh.token,Accept:"application/vnd.github+json",
  "X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"});
const fileFor=id=>"mtg-binder-"+id+".json";
const titleFor=id=>((DATA.checklists.find(c=>c.id===id)||{}).title||id);

async function ghWho(){const r=await fetch(GH_API+"/user",{headers:ghH()});
  if(r.status===401)throw new Error("GitHub returned 401 (token invalid or expired)");
  if(r.status===403)throw new Error("GitHub returned 403 (missing gist scope, or rate-limited)");
  if(!r.ok)throw new Error("GitHub returned "+r.status);
  return (await r.json()).login;}

async function ghDiscover(){const r=await fetch(GH_API+"/gists?per_page=100",{headers:ghH()});
  if(!r.ok)return {};const out={};
  for(const g of await r.json())for(const f of Object.keys(g.files||{})){
    const m=/^mtg-binder-(.+)\.json$/.exec(f); if(m)out[m[1]]=g.id;}
  return out;}

async function ghPull(firstConnect){if(!gh.token)return;
  gh.ids=await ghDiscover();const merged={},mergedExtras={},legacy={};
  await Promise.all(Object.entries(gh.ids).map(async([cl,id])=>{
    try{const r=await fetch(GH_API+"/gists/"+id,{headers:ghH()});if(!r.ok)return;
      const j=await r.json(),f=(j.files||{})[fileFor(cl)];if(!f)return;
      let c=f.content; if(f.truncated&&f.raw_url)c=await (await fetch(f.raw_url)).text();
      const b=JSON.parse(c),m=migrateChecks(b.checks||{});Object.assign(merged,m.checks);
      Object.assign(mergedExtras,b.extras||{});
      Object.assign(legacy,b.legacyChecksV1||{},m.legacy,m.unknown);
      gh.snap[cl]=JSON.stringify({checks:b.checks||{},extras:b.extras||{}});
      if(m.migrated||Object.keys(m.unknown).length)ghDirty=true;}catch(e){}}));
  if(Object.keys(merged).length||Object.keys(mergedExtras).length){
    // First connect on a device: keep BOTH sides (local wins ties) so an existing
    // local checklist can never be wiped by whatever is already in the gists.
    state.checks = firstConnect ? Object.assign({}, merged, state.checks) : merged;
    state.extras = firstConnect ? Object.assign({},mergedExtras,state.extras||{}) : mergedExtras;
    state.legacyChecksV1=Object.assign({},legacy,state.legacyChecksV1||{});
    state=migrateState(state);delete state._needsMigrationSave;
    save();}
  gh.last=Date.now(); ghRemember();}

async function ghPush(unloading){if(!gh.token||gh.busy)return;gh.busy=true;
  if(!unloading){const t=document.getElementById('driveTxt'); if(t)t.textContent='Syncing…';}
  try{const groups={};
    for(const[k,v] of Object.entries(state.checks)){if(!v)continue;
      const cl=k.split("|")[0];(groups[cl]=groups[cl]||{})[k]=v;}
    const extraGroups={};
    for(const[k,v]of Object.entries(state.extras||{})){if(Number(v)<=0)continue;
      const cl=k.split("|")[0];(extraGroups[cl]=extraGroups[cl]||{})[k]=Number(v);}
    const legacyGroups={};
    for(const[k,v]of Object.entries(state.legacyChecksV1||{})){if(!v)continue;
      const cl=k.split("|")[0];(legacyGroups[cl]=legacyGroups[cl]||{})[k]=v;}
    const clIds=new Set([...Object.keys(groups),...Object.keys(extraGroups),...Object.keys(legacyGroups)]);
    for(const cl of clIds){const checks=groups[cl]||{},extras=extraGroups[cl]||{},legacy=legacyGroups[cl]||{};
      const snap=JSON.stringify({checks,extras});
      if(gh.snap[cl]===snap&&gh.ids[cl])continue;            // unchanged → skip
      const title=titleFor(cl);
      const body={description:"MTG Binder · "+title,
        files:{[fileFor(cl)]:{content:JSON.stringify({checklist:cl,title,keyVersion:2,checks,extras,legacyChecksV1:legacy,
          updatedAt:new Date().toISOString()},null,2)}}};
      if(gh.ids[cl]){await fetch(GH_API+"/gists/"+gh.ids[cl],
        {method:"PATCH",headers:ghH(),body:JSON.stringify(body),keepalive:!!unloading});}
      else{const r=await fetch(GH_API+"/gists",{method:"POST",headers:ghH(),
        body:JSON.stringify(Object.assign({public:false},body)),keepalive:!!unloading});
        if(r.ok)gh.ids[cl]=(await r.json()).id;}
      gh.snap[cl]=snap;}
    gh.last=Date.now(); ghDirty=false; ghRemember();
  }catch(e){}finally{gh.busy=false;paintSync();}}

function timeAgo(t){const s=Math.floor((Date.now()-t)/1000);
  if(s<60)return 'just now'; if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago';}

/* Sync policy: ticking a box only marks things dirty. Actual uploads happen
   every few minutes, when you switch checklists, when the tab is hidden/closed,
   or when you hit Sync now — so a session of clicking is one or two writes. */
const GH_EVERY=120000;            // 2 minutes
let ghDirty=false;
function driveTouch(){ if(!gh.token)return; ghDirty=true; paintSync(); }
function ghSyncIfDirty(){ if(gh.token && ghDirty && !gh.busy) return ghPush(); }
setInterval(ghSyncIfDirty, GH_EVERY);
setInterval(()=>{ if(!ghDirty) paintSync(); }, 30000);   // keep "Synced 3m ago" fresh
document.addEventListener('visibilitychange',()=>{ if(document.hidden) ghSyncIfDirty(); });
window.addEventListener('beforeunload',()=>{ if(gh.token&&ghDirty) ghPush(true); });

function paintSync(){const dot=document.getElementById('driveDot'),txt=document.getElementById('driveTxt');
  /* Stay collapsed when all is well; hold open when something needs attention. */
  const wrap=document.getElementById('ledWrap');
  if(wrap) wrap.classList.toggle('alert', !gh.token || ghDirty || ghBootState==='error');
  if(!gh.token){dot.classList.remove('on');txt.textContent='Sync: off';return;}
  dot.classList.add('on');
  if(ghBootState==='restoring'){ dot.style.background='#ffd36b'; txt.textContent='Reconnecting…'; return; }
  if(ghBootState==='error'){ dot.style.background='#e05c5c'; txt.textContent='Sync error — click'; return; }
  if(ghDirty){ dot.style.background='#ffd36b'; txt.textContent='Unsaved changes'; }
  else { dot.style.background=''; txt.textContent=gh.last?('Synced '+timeAgo(gh.last))
         :(gh.user?('Gist · '+gh.user):'Gist connected'); }}
const refreshDrive=paintSync;

/* Nothing here works if the browser won't keep localStorage for this page, and
   that failure used to be invisible: load() swallowed the error, and re-entering
   the token pulled the checkmarks back from the gist, so it looked like only the
   token was being lost. Opening the file over file:// is the usual cause — say so
   loudly instead of letting it look like a sync bug. */
function storageWorks(){
  try{ const k="__probe"; localStorage.setItem(k,"1");
       const ok=localStorage.getItem(k)==="1"; localStorage.removeItem(k); return ok; }
  catch(e){ return false; }
}
function warnIfNoStorage(){
  if(storageWorks()) return true;
  const w=document.getElementById('storeWarn'); if(!w) return false;
  w.style.display='block';
  w.style.cssText='display:block;margin:12px 0 0;padding:12px 14px;border-radius:11px;'+
    'background:#5b1f1f;color:#ffdede;font-size:12.5px;line-height:1.5;border:1px solid #8a3a3a';
  w.innerHTML='<b>&#9888; This browser is not saving anything for this page.</b><br>'+
    'Your GitHub token <i>and</i> your checkmarks are lost on every refresh — that is why you keep '+
    'having to reconnect. It is not a sync bug.<br><br>'+
    (location.protocol==='file:'
      ? 'Cause: the page is open as a <code>file://</code> document, and Chrome does not give those '+
        'pages persistent storage. <b>Fix:</b> serve the folder over http instead — double-click '+
        '<code>serve_binder.command</code> in your outputs folder, or run '+
        '<code>python3 -m http.server 8765</code> there and open '+
        '<code>http://localhost:8765/mtg_binder_app.html</code>. Your deployed GitHub Pages URL works too.'
      : 'Cause: storage is blocked for this site — check for private/incognito mode, or a setting '+
        'that clears site data on exit.');
  return false;
}

/* Diagnostics. Deliberately reports the SHAPE of the stored connection and never
   the token itself, so its output is safe to paste anywhere. */
window.__binderDebug=function(){
  const raw=(()=>{try{return localStorage.getItem(GH_KEY);}catch(e){return "THREW: "+e.message;}})();
  let lsWorks=false, lsErr=null;
  try{ localStorage.setItem("__t","1"); lsWorks=localStorage.getItem("__t")==="1";
       localStorage.removeItem("__t"); }catch(e){ lsErr=e.name+": "+e.message; }
  return {
    build: BUILD,
    href: location.href,
    protocol: location.protocol,
    localStorageWorks: lsWorks,
    localStorageError: lsErr,
    storedFormat: raw==null?"NOTHING STORED":(raw.charAt(0)==="{"?"json (current)":"bare token (legacy)"),
    hasToken: !!gh.token,
    tokenLength: gh.token?gh.token.length:0,
    tokenPrefix: gh.token?gh.token.slice(0,4)+"…":null,
    user: gh.user,
    gistIds: Object.keys(gh.ids||{}),
    lastSync: gh.last?new Date(gh.last).toISOString():null,
    bootState: ghBootState,
    bootError: ghBootMsg||null,
    checkedBoxes: Object.keys(state.checks||{}).filter(k=>state.checks[k]).length,
    extraOwned: Object.values(state.extras||{}).reduce((n,v)=>n+Math.max(0,Number(v)||0),0),
    keyVersion: state.keyVersion||1,
    legacyRecoveryKeys: Object.keys(state.legacyChecksV1||{}).filter(k=>state.legacyChecksV1[k]).length,
    keyMigration: state.keyMigration||null,
    activeKeyShapes: Object.keys(state.checks||{}).filter(k=>state.checks[k]).slice(0,5)
      .map(k=>/^([^|]+)\|v2\|[0-9a-f]{16}$/.test(k)?'v2':'other')
  };
};

/* Reconnect automatically on page load using the stored token — no need to open
   Settings and click Connect. Failures are surfaced on the pill (and the reason
   is kept for the Settings panel) rather than swallowed. */
async function ghBoot(){
  if(!gh.token){ ghBootState='off'; paintSync(); return; }
  ghBootState='restoring'; ghBootMsg=''; paintSync();
  try{
    gh.user=await ghWho();
    await ghPull();
    ghBootState='ok'; ghRemember(); updateAll(); paintSync();
  }catch(e){
    ghBootState='error'; ghBootMsg=String((e&&e.message)||e); paintSync();
  }
}

function toast(msg){ const t=document.getElementById('toast'); t.innerHTML='✓ '+msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200); }

/* ---- wire up ---- */
function openSync(){
  const info=document.getElementById('driveInfo'),act=document.getElementById('modalActions'),
        inp=document.getElementById('ghToken');
  if(gh.token){
    inp.value=gh.token;
    const links=Object.entries(gh.ids).map(([cl,id])=>
      '<div style="margin-top:4px">&#8226; <a href="https://gist.github.com/'+id+'" target="_blank" style="color:var(--lpurple)">'+titleFor(cl)+'</a></div>').join('');
    const nChecks=Object.keys(state.checks).filter(k=>state.checks[k]).length;
    const nGists=Object.keys(gh.ids).length;
    info.innerHTML=(ghBootState==='error'
      ? '<div style="color:#e05c5c;margin-bottom:6px">&#9888; Auto-reconnect failed: '+ghBootMsg+
        '<br>Hit <b>Save &amp; sync now</b> to retry.</div>' : '')+
      (ghBootState==='restoring'?'<div style="margin-bottom:6px">Reconnecting…</div>':'')+
      '&#10003; Connected'+(gh.user?' as <b>'+gh.user+'</b>':'')+
      '.<br><b>'+nChecks+'</b> checkmark'+(nChecks===1?'':'s')+' synced across <b>'+nGists+'</b> gist'+(nGists===1?'':'s')+
      (gh.last?' &middot; last sync '+timeAgo(gh.last):'')+
      '<div style="margin-top:6px">'+(links||'none yet — tick something to create them')+'</div>';
    act.innerHTML='<button class="pbtn g" id="ghSave">Save &amp; sync now</button>'+
      '<button class="pbtn ghost" id="ghOff">Disconnect</button>'+
      '<button class="pbtn ghost" id="closeModal">Close</button>';
  } else {
    info.innerHTML='&#128274; Stored only in this browser. Scope it to <b>gist</b> only — it can\'t touch your repos. Keep a copy of the token somewhere you can reach, and you can paste it into the app on any device.';
    act.innerHTML='<button class="pbtn g" id="ghSave">Connect</button>'+
      '<button class="pbtn ghost" id="closeModal">Maybe later</button>';
  }
  const cm=document.getElementById('closeModal'); if(cm)cm.onclick=()=>document.getElementById('driveModal').classList.remove('show');
  const off=document.getElementById('ghOff'); if(off)off.onclick=()=>{gh={token:"",user:null,ids:{},snap:{},last:null,busy:false};
    ghBootState='off';localStorage.removeItem(GH_KEY);paintSync();openSync();toast('Disconnected');};
  const sv=document.getElementById('ghSave'); if(sv)sv.onclick=async()=>{
    const t=document.getElementById('ghToken').value.trim(); if(!t){toast('Paste a token first');return;}
    gh.token=t; ghBootState='ok'; ghRemember();
    document.getElementById('driveInfo').innerHTML='Connecting…';
    try{ gh.user=await ghWho(); await ghPull(true); await ghPush(); updateAll(); paintSync(); openSync();
         toast('Synced to GitHub Gist'); }
    catch(e){ const msg=String((e&&e.message)||e);
      const hint=/\b(401|403)\b/.test(msg)
        ? ' <br><br>That status means GitHub rejected the token — check it is a <b>classic</b> token (starts <code>ghp_</code>) with the <b>gist</b> scope ticked.'
        : ' <br><br>That is not a token problem — it is an app error. Send me this message.';
      document.getElementById('driveInfo').innerHTML='<span style="color:#e05c5c">'+msg+hint+'</span>'; }};
  document.getElementById('driveModal').classList.add('show');
}
/* Wire by id, tolerating absence. This used to be a bare
   document.getElementById('closeModal').onclick = ... — but #closeModal is built
   dynamically by openSync(), so at load time it was null, the assignment threw,
   and EVERY statement after it (including the whole init block and ghBoot) never
   ran. The page rendered nothing until something else called updateAll(). One
   missing element must never be able to abort startup again. */
function on(id, ev, fn){
  const el=document.getElementById(id);
  if(!el){ console.warn('[binder] no #'+id+' to bind '+ev+' — skipped'); return false; }
  el.addEventListener(ev, fn); return true;
}

/* Popover menus. Two of them: View (control bar) and More (header). Opening one
   closes the other, both close on outside click and Escape.
   closeOnItem distinguishes them — the More menu holds one-shot actions and should
   dismiss after a pick, while the View menu holds a toggle and a select you may
   want to change together, so it stays put. */
const MENUS=[];
function closeMenus(){
  MENUS.forEach(([b,m])=>{ m.classList.remove('show'); b.setAttribute('aria-expanded','false'); });
}
function wireMenu(btnId, menuId, closeOnItem){
  const b=document.getElementById(btnId), m=document.getElementById(menuId);
  if(!b||!m){ console.warn('[binder] menu '+btnId+'/'+menuId+' missing — skipped'); return; }
  MENUS.push([b,m]);
  b.addEventListener('click',(e)=>{
    e.stopPropagation();
    const open=!m.classList.contains('show');
    closeMenus();
    m.classList.toggle('show',open); b.setAttribute('aria-expanded',open?'true':'false');
  });
  m.addEventListener('click',(e)=>{
    e.stopPropagation();
    if(closeOnItem && e.target.closest('.mrow,.clitem')) setTimeout(closeMenus,0);
  });
}
wireMenu('clBtn','clMenu',true);
wireMenu('viewBtn','viewMenu',false);
wireMenu('moreBtn','moreMenu',true);
document.addEventListener('click',closeMenus);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeMenus(); });

on('syncItem','click',openSync);
/* #closeModal is created by openSync(), which binds it there. Nothing to do here. */
on('driveModal','click',(e)=>{ if(e.target.id==='driveModal')e.target.classList.remove('show'); });
on('drivePill','click',openSync);
document.getElementById('exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='mtg-binder-progress.json'; a.click(); toast('Exported progress file');
};
document.getElementById('importBtn').onclick=()=>document.getElementById('fileIn').click();
document.getElementById('fileIn').onchange=(e)=>{
  const f=e.target.files[0]; if(!f)return; const r=new FileReader();
  r.onload=()=>{ try{ const s=JSON.parse(r.result); if(s.checks){state=migrateState(s);delete state._needsMigrationSave;save(); active=state.ui.active||active; /* Startup is deliberately fault-isolated: a failure in rendering must not stop
   the sync from reconnecting, and vice versa. */
try{ paintSync(); applyCols(); updateAll(); }
catch(e){ console.error('[binder] initial render failed:', e); }
try{ warnIfNoStorage(); }catch(e){ console.error('[binder] storage probe failed:', e); }
ghBoot(); toast('Imported progress'); } }catch(err){ toast('Invalid file'); } };
  r.readAsText(f);
};
on('search','input',(e)=>{
  search=e.target.value; renderContent();
  /* Hold it open while a query is active, so a filtered list never hides why. */
  const w=document.getElementById('searchWrap');
  if(w) w.classList.toggle('has', !!search.trim());
});
/* Clicking the magnifier should put the caret in the field, not just widen it. */
on('searchWrap','click',()=>{ const i=document.getElementById('search'); if(i) i.focus(); });
/* Escape clears and closes; "/" from anywhere jumps into search. */
on('search','keydown',(e)=>{
  if(e.key==='Escape'){ e.target.value=''; search=''; renderContent();
    const w=document.getElementById('searchWrap'); if(w) w.classList.remove('has');
    e.target.blur(); }
});
document.addEventListener('keydown',(e)=>{
  if(e.key==='/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName||''))){
    e.preventDefault(); const i=document.getElementById('search'); if(i) i.focus(); }
});
document.getElementById('hideDoneT').onclick=()=>{ state.ui.hideDone=!state.ui.hideDone;clearCompletionLinger();
  document.getElementById('hideDoneSw').classList.toggle('on',state.ui.hideDone); save(); renderContent(); };
document.getElementById('expandAll').onclick=()=>{ const cl=DATA.checklists.find(c=>c.id===active);
  cl.eras.forEach((e,ei)=>delete state.ui.closed[cl.id+'|'+ei]); save(); renderContent(); };
document.getElementById('collapseAll').onclick=()=>{ const cl=DATA.checklists.find(c=>c.id===active);
  cl.eras.forEach((e,ei)=>state.ui.closed[cl.id+'|'+ei]=true); save(); renderContent(); };
document.getElementById('colSel').onchange=(e)=>{state.ui.cols=e.target.value;save();applyCols();};
document.getElementById('themeBtn').onclick=()=>{ state.theme=state.theme==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',state.theme); save(); };

/* init */
if(state.theme==='dark')document.documentElement.setAttribute('data-theme','dark');
document.getElementById('hideDoneSw').classList.toggle('on',state.ui.hideDone);
paintSync(); updateAll();
ghBoot();
</script>
</body>
</html>"""

import datetime
BUILD = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
out = HTML.replace("/*__DATA__*/", DATA).replace("__BUILD__", BUILD)
targets=[
    os.path.join(ROOT,"mtg_binder_app.html"),
    os.path.join(ROOT,"index.html"),
]
# Keep every published/staging copy in step automatically — drift between the
# root GitHub Pages file and the local app cost real debugging time once.
_static=os.path.join(ROOT,"apps","static")
if os.path.isdir(_static): targets.append(os.path.join(_static,"index.html"))
for t in targets:
    with open(t,"w") as f: f.write(out)
print("wrote app:", len(out), "bytes ->", ", ".join(os.path.relpath(t,ROOT) for t in targets))
