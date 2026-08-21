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
WRAPPER_ART_PATH=os.path.join(DATA_DIR,"booster_wrapper_art_catalog.json")
with open(WRAPPER_ART_PATH,encoding="utf-8") as _wrapper_file:
    WRAPPER_ART_CATALOG=json.load(_wrapper_file)
if WRAPPER_ART_CATALOG.get("schema") != "mtg-booster-wrapper-art-catalog/v1":
    raise ValueError("unsupported booster wrapper-art catalog schema")
_wrapper_sets=WRAPPER_ART_CATALOG.get("sets") or []
_wrapper_arts=[art for wrapper_set in _wrapper_sets for art in wrapper_set.get("artworks",[])]
if len(_wrapper_sets) != 96 or len(_wrapper_arts) != 378:
    raise ValueError("booster wrapper-art catalog must contain 96 sets / 378 artworks")
_wrapper_codes=[wrapper_set.get("setCode") for wrapper_set in _wrapper_sets]
if len(set(_wrapper_codes)) != len(_wrapper_codes) or any(not code for code in _wrapper_codes):
    raise ValueError("booster wrapper-art set codes must be present and unique")
if any(wrapper_set.get("artCount") != len(wrapper_set.get("artworks",[])) for wrapper_set in _wrapper_sets):
    raise ValueError("booster wrapper-art declared counts must match artwork rows")
_wrapper_ids=[art.get("id") for art in _wrapper_arts]
if len(set(_wrapper_ids)) != len(_wrapper_ids) or any(not art_id for art_id in _wrapper_ids):
    raise ValueError("booster wrapper-art IDs must be present and unique")
_wrapper_statuses={"exact_individual","group_reference","review_only","pending_image_source"}
if any(art.get("imageStatus") not in _wrapper_statuses for art in _wrapper_arts):
    raise ValueError("booster wrapper-art image status is not allowed")
WRAPPER_ART=json.dumps(WRAPPER_ART_CATALOG,separators=(",",":"),ensure_ascii=False)
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
.iconbtn.pricing-active{color:var(--gold);border-color:var(--gold)}
.iconbtn.pricing-active svg,.rowpricebtn.loading svg{animation:price-spin .85s linear infinite}
.pricemenu .mrow.disabled{opacity:.48;cursor:not-allowed;pointer-events:none}
.pricingmenustatus{padding:7px 10px 8px;color:var(--muted);font-size:10.5px;line-height:1.4;
  border-top:1px solid var(--line)}
@keyframes price-spin{to{transform:rotate(360deg)}}
.vbtn{display:flex;align-items:center;gap:6px;height:31px}
.vgear{font-size:13px;line-height:1}
.menuwrap{position:relative}
.menu{position:absolute;right:0;top:calc(100% + 6px);min-width:212px;padding:5px;z-index:50;
  background:var(--card);border:1px solid var(--line);border-radius:11px;box-shadow:var(--shadow);display:none}
.menu.show{display:block}
.mrow{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 10px;
  border-radius:8px;font-size:12.5px;color:var(--ink);cursor:pointer;user-select:none}
.mrow:hover{background:var(--bg)}
.menu button.mrow{width:100%;border:0;background:transparent;font-family:inherit;font-size:12.5px;text-align:left}
.menu button.mrow:hover,.menu button.mrow:focus-visible{background:var(--bg);outline:none}
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
/* Completed rows stay subdued at rest, but an active quantity control must be
   fully legible — especially its floated owned/order/Receive actions. */
.item.done .qtyctrl.goal:hover,.item.done .qtyctrl.goal:focus-within{opacity:1}
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
.rowpricebtn{width:22px;height:22px;flex:none;display:grid;place-items:center;padding:0;
  border:none;background:none;color:var(--muted);cursor:pointer;border-radius:6px}
.rowpricebtn:hover,.rowpricebtn:focus-visible{background:var(--line);color:var(--lpurple);outline:none}
.rowpricebtn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;
  stroke-linecap:round;stroke-linejoin:round}
.rowpricebtn.live{color:var(--good)}
.rowpricebtn.error{color:#c94d4d}
.rowpricebtn:disabled{cursor:not-allowed;opacity:.38;background:none}
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
.variantlist{grid-column:1/-1;border-top:1px solid var(--line);padding-top:8px}
.varianttitle{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  font-weight:700;color:var(--ink);margin-bottom:6px}
.variantsummary{font-size:10px;font-weight:650;color:var(--muted);text-align:right}
.variantgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:5px 12px}
.variantrow{display:flex;align-items:center;gap:7px;min-width:0;color:var(--ink);
  border-radius:7px;padding:4px 6px;background:color-mix(in srgb,var(--rowalt) 72%,transparent)}
.variantrow:hover{background:var(--line)}
.variantname{min-width:0;flex:1;overflow-wrap:anywhere}
.variantgoal{font-size:9px;color:var(--muted);white-space:nowrap}
.variantqty{display:flex;align-items:center;flex:none;border:1px solid var(--line);border-radius:7px;
  overflow:hidden;background:var(--card)}
.variantqtybtn,.variantqtynum{height:24px;min-width:25px;border:0;background:transparent;color:var(--ink);
  font:700 12px/1 inherit;padding:0;display:grid;place-items:center}
.variantqtybtn{cursor:pointer;color:var(--lpurple)}
.variantqtybtn:hover,.variantqtybtn:focus-visible{background:var(--line)}
.variantqtybtn:disabled{cursor:default;color:var(--muted);opacity:.45}
.variantqtynum{min-width:27px;border-inline:1px solid var(--line);font-variant-numeric:tabular-nums}
.variantqtynum.met{background:color-mix(in srgb,var(--good) 18%,var(--card));color:var(--good)}
.variantmanage,.wrappermanage{display:flex;align-items:center;gap:5px;flex:none}.wrappermanage{position:relative}
.orderedqty{display:flex;align-items:center;flex:none;height:26px;border:1px solid var(--gold);border-radius:7px;
  overflow:hidden;background:var(--card);color:var(--gold);box-shadow:0 2px 8px rgba(30,18,70,.08)}
.orderedqty .ordericon{width:23px;height:24px;display:grid;place-items:center;background:color-mix(in srgb,var(--gold) 12%,var(--card))}
.orderedqty .ordericon svg,.receiveqty svg,.incomingbadge svg{width:14px;height:14px;fill:none;stroke:currentColor;
  stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.orderedqtybtn,.orderedqtynum,.receiveqty{height:24px;min-width:24px;border:0;border-left:1px solid var(--line);
  background:transparent;color:var(--gold);font:700 11px/1 inherit;padding:0;display:grid;place-items:center}
.orderedqtybtn,.receiveqty{cursor:pointer}.orderedqtybtn:hover,.orderedqtybtn:focus-visible,
.receiveqty:hover,.receiveqty:focus-visible{background:var(--gold);color:#fff;outline:none}
.orderedqtybtn:disabled,.receiveqty:disabled{cursor:default;opacity:.4;background:transparent;color:var(--muted)}
.orderedqtynum{min-width:25px;font-variant-numeric:tabular-nums}.receiveqty{width:27px;color:var(--good)}
.orderpeek{height:26px;min-width:32px;padding:0 4px;border:1px solid var(--gold);border-radius:7px;background:var(--card);
  color:var(--gold);display:flex;align-items:center;justify-content:center;gap:2px;font:800 9px/1 inherit;cursor:pointer}
.orderpeek:hover,.orderpeek:focus-visible{background:color-mix(in srgb,var(--gold) 14%,var(--card));outline:none}
.orderpeek svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.detailordertray{position:absolute;z-index:8;right:0;top:29px;opacity:0;pointer-events:none;transform:translateY(-2px);transition:.15s ease}
.wrappermanage:hover .detailordertray,.wrappermanage:focus-within .detailordertray{opacity:1;pointer-events:auto;transform:translateY(0)}
.wrapperarts{grid-column:1/-1;border-top:1px solid var(--line);padding-top:8px}
.wrapperarts>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;
  cursor:pointer;color:var(--ink);font-weight:700;list-style:none;border-radius:7px;padding:3px 5px}
.wrapperarts>summary::-webkit-details-marker{display:none}
.wrapperarts>summary:hover,.wrapperarts>summary:focus-visible{background:var(--line);outline:none}
.wrapperarts>summary::before{content:'›';color:var(--lpurple);font-size:18px;line-height:1;transition:transform .15s}
.wrapperarts[open]>summary::before{transform:rotate(90deg)}
.wrapperart-title{flex:1}.wrapperart-summary{font-size:10px;font-weight:650;color:var(--muted);text-align:right}
.wrapperart-note{font-size:10px;color:var(--muted);margin:6px 5px 8px}
.wrapperart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}
.wrapperart-card{position:relative;min-width:0;display:grid;gap:5px;border:1px solid var(--line);
  border-radius:9px;padding:7px;background:var(--card);color:var(--ink)}
.wrapperart-card:hover{border-color:var(--lpurple)}
.wrapperart-card.owned{border-color:var(--good);background:color-mix(in srgb,var(--good) 10%,var(--card))}
.wrapperart-card.ordered:not(.owned){border-color:var(--gold);background:color-mix(in srgb,var(--gold) 10%,var(--card))}
.wrapperart-media{position:relative;width:100%;aspect-ratio:3/4;display:grid;place-items:center;
  overflow:hidden;border-radius:7px;border:1px solid var(--line);background:#fff}
.wrapperart-media img{width:100%;height:100%;display:block;object-fit:contain;padding:3px}
.wrapperart-fallback{display:grid;place-items:center;width:100%;height:100%;padding:8px;text-align:center;
  color:#6b6680;background:linear-gradient(135deg,#f5f3fb,#e7e3f2);font-size:9.5px;font-weight:700}
.wrapperart-fallback[hidden]{display:none}
.wrapperart-head{display:flex;align-items:center;justify-content:space-between;gap:6px}
.wrapperart-check{min-width:0;font-size:10.5px;font-weight:700;overflow-wrap:anywhere}
.wrapperart-status{font-size:8.5px;line-height:1.25;color:var(--muted);overflow-wrap:anywhere}
.wrapperart-status.exact{color:var(--green)}
.wrapperart-status.review,.wrapperart-status.group{color:var(--gold)}
.wrapperart-status.pending{color:#c94d4d}
.pricinglist{grid-column:1/-1;border-top:1px solid var(--line);padding-top:8px;display:grid;gap:7px}
.pricingtitle{font-weight:700;color:var(--ink)}
.pricecard{border:1px solid var(--line);border-radius:9px;padding:8px;background:var(--card);display:grid;gap:6px}
.pricehead{display:flex;align-items:center;gap:8px;min-width:0}
.pricehead b{min-width:0;overflow-wrap:anywhere;color:var(--ink)}
.pricebadge{margin-left:auto;flex:none;border-radius:999px;padding:2px 7px;font-size:9px;font-weight:800;
  letter-spacing:.04em;text-transform:uppercase;background:var(--rowalt);color:var(--muted)}
.pricebadge.live{background:rgba(39,134,95,.14);color:var(--good)}
.pricebadge.loading{background:rgba(181,133,42,.16);color:var(--gold)}
.pricebadge.error{background:rgba(224,92,92,.14);color:#c94d4d}
.pricebadge.stale{background:rgba(181,133,42,.16);color:var(--gold)}
.pricefacts{display:flex;flex-wrap:wrap;gap:5px 13px;color:var(--muted)}
.pricefacts span{white-space:nowrap}.pricefacts b{color:var(--ink)}
.pricefallback{font-size:10.5px;color:var(--muted)}
.pricefallback b{color:var(--gold)}
.priceerror{font-size:10.5px;color:#c94d4d;overflow-wrap:anywhere}
.priceactions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.pricebtn{border:1px solid var(--line);background:var(--rowalt);color:var(--lpurple);border-radius:7px;
  padding:5px 8px;font:700 10.5px/1.2 inherit;cursor:pointer}
.pricebtn:hover,.pricebtn:focus-visible{border-color:var(--lpurple);background:var(--card)}
.pricebtn:disabled{opacity:.55;cursor:wait}
.watchbox{display:flex;align-items:center;gap:6px;flex-wrap:wrap;border-top:1px dashed var(--line);padding-top:6px}
.watchbox label{font-size:10px;color:var(--muted)}
.watchbox input{width:88px;height:27px;border:1px solid var(--line);border-radius:6px;background:var(--card);
  color:var(--ink);padding:0 7px;font:inherit;font-size:11px}
.watchmsg{font-size:10px;color:var(--muted)}
.checks{display:flex;flex-wrap:wrap;gap:6px;flex:none;min-width:30px}
/* Compact quantity control. The number owns the layout footprint; +/- slide out
   over the surrounding whitespace on hover or keyboard/touch focus. */
.qtyctrl{position:relative;width:30px;height:24px;display:grid;place-items:center;z-index:1}
.qtyctrl.ratio,.qtyctrl.ratio .qtynum{width:40px}
.qtyctrl.ratio .qtybtn.minus{right:7px}.qtyctrl.ratio .qtybtn.plus{left:7px}
.qtyctrl.ratio:hover .qtybtn.minus,.qtyctrl.ratio:focus-within .qtybtn.minus{transform:translateX(-35px) scale(1)}
.qtyctrl.ratio:hover .qtybtn.plus,.qtyctrl.ratio:focus-within .qtybtn.plus{transform:translateX(35px) scale(1)}
.qtyctrl:hover,.qtyctrl:focus-within{z-index:12}
/* Once opened, this invisible bridge keeps :hover alive while the pointer crosses
   the 2px gap between the compact count and either translated button. */
.qtyctrl::before{content:"";position:absolute;z-index:1;inset:-4px -190px -4px -32px;pointer-events:none}
.qtyctrl:hover::before,.qtyctrl:focus-within::before{pointer-events:auto}
.qtynum,.qtybtn{height:24px;border-radius:7px;border:1.6px solid var(--lpurple);
  font:700 12px/1 inherit;display:grid;place-items:center;cursor:pointer;transition:.18s ease}
.qtynum{position:relative;z-index:3;width:30px;padding:0;background:var(--card);color:var(--ink);
  font-variant-numeric:tabular-nums;box-shadow:0 1px 3px rgba(30,18,70,.08)}
.qtynum.met{background:var(--qtyc,var(--lpurple));border-color:var(--qtyc,var(--lpurple));color:#fff}
.qtynum.covered{background:color-mix(in srgb,var(--gold) 18%,var(--card));border-color:var(--gold);color:var(--gold)}
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
.incomingbadge{position:absolute;z-index:6;right:-9px;bottom:-7px;height:15px;min-width:18px;padding:0 3px;
  display:flex;align-items:center;justify-content:center;gap:1px;border-radius:8px;background:var(--gold);color:#fff;
  font:800 8px/1 inherit;box-shadow:0 1px 3px rgba(30,18,70,.18);pointer-events:none}
.incomingbadge svg{width:9px;height:9px;stroke-width:2.2}.incomingbadge[hidden]{display:none}
.ordertray{position:absolute;z-index:8;top:-1px;left:58px;transform:translateX(-2px);
  opacity:0;pointer-events:none;transition:.15s ease}
.qtyctrl:hover .ordertray,.qtyctrl:focus-within .ordertray{opacity:1;pointer-events:auto;transform:translateX(0)}
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
.monitor-modal{max-width:520px;max-height:calc(100vh - 36px);overflow:auto}
.monitor-form{display:grid;gap:14px;margin-top:16px}
.monitor-field{display:grid;gap:6px}
.monitor-field>label,.monitor-title{font-size:11px;font-weight:750;color:var(--muted);letter-spacing:.2px}
.monitor-field input[type="number"],.monitor-field input[type="time"],.monitor-field select{
  width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--line);border-radius:9px;
  background:var(--bg);color:var(--ink);font:inherit;font-size:13px}
.monitor-line{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.monitor-line label{font-size:13px;line-height:1.35;cursor:pointer}
.monitor-line small,.monitor-field small{display:block;color:var(--muted);font-size:10.5px;line-height:1.4;margin-top:2px}
.monitor-line input[type="checkbox"],.monitor-sources input{accent-color:var(--lpurple);width:17px;height:17px;flex:none}
.monitor-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.monitor-sources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px}
.monitor-sources label{display:flex;align-items:center;gap:7px;font-size:12px}
.monitor-status{border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:10px 11px}
.monitor-status b{display:block;font-size:12px;margin-bottom:3px}.monitor-status span{font-size:11px;color:var(--muted);line-height:1.45}
.identify-modal{max-width:620px;max-height:calc(100vh - 36px);overflow:auto}
.identify-layout{display:grid;grid-template-columns:170px minmax(0,1fr);gap:14px;margin-top:14px;align-items:start}
.identify-preview{width:170px;aspect-ratio:3/4;object-fit:contain;border:1px solid var(--line);border-radius:11px;background:#fff}
.identify-copy{min-width:0}.identify-state{font-size:12px;color:var(--muted);line-height:1.45;margin:0}
.identify-results{display:grid;gap:8px;margin-top:10px}
.identify-result{display:grid;grid-template-columns:62px minmax(0,1fr) auto;gap:9px;align-items:center;
  border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--bg)}
.identify-result.best{border-color:var(--lpurple);background:color-mix(in srgb,var(--lpurple) 7%,var(--card))}
.identify-result img,.identify-result-fallback{width:62px;height:78px;display:grid;place-items:center;object-fit:contain;
  border-radius:7px;border:1px solid var(--line);background:#fff;font-size:9px;text-align:center;color:var(--muted);padding:3px}
.identify-result-copy{min-width:0;display:grid;gap:3px}.identify-result-copy b{font-size:12px;overflow-wrap:anywhere}
.identify-result-copy span{font-size:9.5px;color:var(--muted);line-height:1.3;overflow-wrap:anywhere}
.identify-confidence{color:var(--good)!important;font-weight:750}.identify-result .variantqty{align-self:center}
.identify-privacy{font-size:9.5px!important;margin-top:10px!important}
@media(max-width:520px){.identify-modal{padding:17px}.identify-layout{grid-template-columns:1fr}.identify-preview{width:100%;max-height:210px;aspect-ratio:auto}.identify-result{grid-template-columns:52px minmax(0,1fr)}.identify-result img,.identify-result-fallback{width:52px;height:66px}.identify-result .variantqty{grid-column:2;justify-self:start}}

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
  /* Keep the phone tray contiguous with the owned + button so pointer hover
     cannot fall through the row before reaching the ordered actions. The
     amber badge already supplies the package cue, so omit the duplicate icon. */
  .ordertray{left:58px}
  .ordertray .ordericon{display:none}
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
  .controls{gap:6px;padding-left:9px;padding-right:9px}
  .cbtns{gap:6px}
  .vlabel{display:none}
  .vbtn{width:33px;justify-content:center;padding:0}
  .search{min-width:120px}
  .monitor-modal{padding:18px}
  .monitor-grid{grid-template-columns:1fr}
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
         <div class="mrow" id="monitorItem"><span>Deal monitoring…</span></div>
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
      <button class="iconbtn" id="identifyBtn" title="Identify a product from a photo" aria-label="Identify a product from a photo">
        <svg viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.2-2h4.6l1.2 2h2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/></svg>
      </button>
      <div class="menuwrap">
        <button class="iconbtn" id="priceRefreshBtn" title="Refresh prices" aria-label="Refresh prices"
                aria-haspopup="true" aria-expanded="false">
          <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><polyline points="20 4 20 11 13 11"/></svg>
        </button>
        <div class="menu pricemenu" id="priceRefreshMenu">
          <button type="button" class="mrow" id="refreshUnfinishedPrices"><span>Refresh unfinished items</span><span class="mkey" id="refreshUnfinishedCount"></span></button>
          <button type="button" class="mrow" id="refreshAllPrices"><span>Refresh all items</span><span class="mkey" id="refreshAllCount"></span></button>
          <div class="pricingmenustatus" id="pricingMenuStatus">Open in the tracker extension to use live pricing.</div>
        </div>
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
<input type="file" id="identifyFile" accept="image/jpeg,image/png,image/webp" capture="environment" style="display:none">

<div class="modal-bg" id="identifyModal">
 <div class="modal identify-modal" role="dialog" aria-modal="true" aria-labelledby="identifyHeading">
   <h2 id="identifyHeading"><span class="gicon">&#128247;</span> Identify sealed product</h2>
   <p>Take or choose a photo of one sealed product. The result is only a suggestion; your collection changes only when you press + or −.</p>
   <div class="identify-layout">
     <img class="identify-preview" id="identifyPreview" alt="Product photo preview">
     <div class="identify-copy">
       <p class="identify-state" id="identifyState">Choose a clear, front-facing photo with the packaging text and artwork visible.</p>
       <div class="identify-results" id="identifyResults"></div>
     </div>
   </div>
   <p class="identify-privacy">The resized photo is sent through the installed Tracker extension to the configured vision provider. Photos and identification results are not added to collection state, Gists, or exports.</p>
   <div class="actions"><button class="pbtn g" id="identifyAnother">Choose another photo</button><button class="pbtn ghost" id="identifyClose">Close</button></div>
 </div>
</div>

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

<div class="modal-bg" id="monitorModal">
 <div class="modal monitor-modal" role="dialog" aria-modal="true" aria-labelledby="monitorHeading">
   <h2 id="monitorHeading"><span class="gicon">&#128276;</span> Deal monitoring</h2>
   <p>Choose which missing sealed products the paired monitor should watch. The dashboard shares product identities and collection counts only; it never buys, bids, fetches marketplaces, or stores provider credentials.</p>
   <div class="monitor-form">
     <div class="monitor-line"><label for="monitorEnabled"><b>Enable monitoring</b><small>Required products that are still missing become active targets.</small></label><input id="monitorEnabled" type="checkbox"></div>
     <div class="monitor-grid">
       <div class="monitor-field"><label for="monitorDiscount">Minimum discount from Market</label><input id="monitorDiscount" type="number" min="0" max="99" step="1" inputmode="decimal"><small>20% means landed price must be at most 80% of verified Market.</small></div>
       <div class="monitor-field"><label for="monitorConfidence">Minimum match confidence</label><select id="monitorConfidence"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
     </div>
     <div class="monitor-field"><div class="monitor-title">Sources</div><div class="monitor-sources">
       <label><input type="checkbox" data-monitor-source="ebay">eBay</label>
       <label><input type="checkbox" data-monitor-source="tcgplayer">TCGplayer</label>
       <label><input type="checkbox" data-monitor-source="heritage">Heritage</label>
       <label><input type="checkbox" data-monitor-source="store">Supported stores</label>
     </div></div>
     <div class="monitor-line"><label for="monitorOptional"><b>Include optional products</b><small>Watch bonus inventory with target 0 as well as required missing products.</small></label><input id="monitorOptional" type="checkbox"></div>
     <div class="monitor-line"><label for="monitorInstant"><b>Instant fixed-price email</b><small>Auctions remain digest-only; nothing bids or buys automatically.</small></label><input id="monitorInstant" type="checkbox"></div>
     <div class="monitor-line"><label for="monitorDigest"><b>Daily digest</b><small>One summary per local date.</small></label><input id="monitorDigest" type="checkbox"></div>
     <div class="monitor-grid">
       <div class="monitor-field"><label for="monitorDigestTime">Digest time</label><input id="monitorDigestTime" type="time"></div>
       <div class="monitor-field"><label for="monitorTimezone">Timezone</label><select id="monitorTimezone"><option value="America/Chicago">America/Chicago</option></select></div>
     </div>
     <div class="monitor-status"><b id="monitorStatusTitle">Monitor status</b><span id="monitorStatusText">Open in the paired Tracker extension to synchronize monitoring.</span></div>
   </div>
   <div class="actions"><button class="pbtn g" id="monitorSave">Save preferences</button><button class="pbtn ghost" id="monitorClose">Close</button></div>
 </div>
</div>

<script>
const DATA = /*__DATA__*/;
const WRAPPER_ART_CATALOG = /*__WRAPPER_ART__*/;
const KEY = "mtgBinder_v1";

const WRAPPER_ART_BY_CODE=new Map((WRAPPER_ART_CATALOG.sets||[]).map(wrapperSet=>
  [String(wrapperSet.setCode||'').toUpperCase(),wrapperSet]));
function wrapperArtKey(artId){return 'packs|wrapper-art|'+String(artId||'').toUpperCase();}
function wrapperArtSetFor(checklistId,item){
  if(checklistId!=='packs'||!item)return null;
  const regularLane=!!item.wrapperArtOnly||(item.slots||[]).some(slot=>
    ['booster','draft','play'].includes(String(slot.g||slot.k||slot.l||'').trim().toLowerCase()));
  return regularLane?WRAPPER_ART_BY_CODE.get(String(item.code||'').toUpperCase())||null:null;
}
function wrapperArtStatusLabel(art){
  if(art.imageStatus==='exact_individual')return {text:'Exact individual image',kind:'exact'};
  if(art.imageStatus==='group_reference')return {text:'Group reference'+(art.positionHint?' · '+art.positionHint:''),kind:'group'};
  if(art.imageStatus==='review_only')return {text:'Review-only image candidate',kind:'review'};
  return {text:'Image source pending',kind:'pending'};
}
function ensureWrapperArtRows(){
  const packs=DATA.checklists.find(checklist=>checklist.id==='packs');
  if(!packs)return;
  const existing=new Set(packs.eras.flatMap(era=>era.items).map(item=>String(item.code||'').toUpperCase()));
  const missing=(WRAPPER_ART_CATALOG.sets||[]).filter(wrapperSet=>!existing.has(String(wrapperSet.setCode||'').toUpperCase()));
  if(!missing.length)return;
  packs.eras.push({name:'Wrapper-Art Inventory Only',items:missing.map(wrapperSet=>({
    name:wrapperSet.setName,code:wrapperSet.setCode,
    note:'Optional wrapper-art inventory row; no pack-type ownership target is added.',
    tags:[{t:'Wrapper art',c:'#6a4fb0'}],slots:[],pricingProducts:[],wrapperArtOnly:true
  }))});
}
ensureWrapperArtRows();

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
function slotExtraKeyFor(cl,it,si){
  return cl+'|slot-extra|'+keyFor(cl,it,si).split('|').pop();
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
function checklistFor(id){return DATA.checklists.find(cl=>cl.id===id);}
function usesDistinctVariants(id){const cl=checklistFor(id);return !!(cl&&cl.progressMode==='distinct_variants');}
function usesGroupVariants(id){const cl=checklistFor(id);return !!(cl&&cl.progressMode==='group_variants');}
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
const MONITOR_SOURCE_ORDER=['ebay','tcgplayer','heritage','store'];
const MONITOR_GIST_CHECKLIST='collector';
const WRAPPER_ART_GIST_CHECKLIST='packs';
function normalizeWrapperArts(input){
  const out={};
  if(!input||typeof input!=='object'||Array.isArray(input))return out;
  for(const[key,value]of Object.entries(input)){
    const match=/^packs\|wrapper-art\|([A-Z0-9][A-Z0-9-]{1,31})$/i.exec(String(key));
    const quantity=value===true?1:Math.max(0,Math.min(100000,Math.floor(Number(value)||0)));
    if(quantity>0&&match)out['packs|wrapper-art|'+match[1].toUpperCase()]=quantity;
  }
  return out;
}
function normalizeOrdered(input){
  const out={};
  if(!input||typeof input!=='object'||Array.isArray(input))return out;
  for(const[key,value]of Object.entries(input)){
    if(!/^[a-z0-9_-]{1,64}\|(?:extra|slot-extra)\|[0-9a-f]{16}$/i.test(String(key)))continue;
    const quantity=value===true?1:Math.max(0,Math.min(100000,Math.floor(Number(value)||0)));
    if(quantity>0)out[String(key)]=quantity;
  }
  return out;
}
const MONITOR_DEFAULT_PREFERENCES={enabled:true,maxMarketRatio:.8,minimumConfidence:'medium',
  sources:MONITOR_SOURCE_ORDER.slice(),includeOptional:false,instantFixedPriceEmail:true,
  dailyDigest:{enabled:true,time:'07:00',timezone:'America/Chicago'}};
function normalizeMonitorPreferences(input){
  const value=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const digest=value.dailyDigest&&typeof value.dailyDigest==='object'&&!Array.isArray(value.dailyDigest)?value.dailyDigest:{};
  const ratio=Number(value.maxMarketRatio),confidence=['low','medium','high'].includes(value.minimumConfidence)
    ?value.minimumConfidence:MONITOR_DEFAULT_PREFERENCES.minimumConfidence;
  const requestedSources=Array.isArray(value.sources)?value.sources:MONITOR_DEFAULT_PREFERENCES.sources;
  const sources=MONITOR_SOURCE_ORDER.filter(source=>requestedSources.includes(source));
  const time=typeof digest.time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(digest.time)
    ?digest.time:MONITOR_DEFAULT_PREFERENCES.dailyDigest.time;
  const timezone=typeof digest.timezone==='string'&&/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(digest.timezone)
    ?digest.timezone:MONITOR_DEFAULT_PREFERENCES.dailyDigest.timezone;
  return {enabled:typeof value.enabled==='boolean'?value.enabled:MONITOR_DEFAULT_PREFERENCES.enabled,
    maxMarketRatio:Number.isFinite(ratio)&&ratio>0&&ratio<=1?Math.round(ratio*10000)/10000:MONITOR_DEFAULT_PREFERENCES.maxMarketRatio,
    minimumConfidence:confidence,sources:sources.length?sources:MONITOR_DEFAULT_PREFERENCES.sources.slice(),
    includeOptional:typeof value.includeOptional==='boolean'?value.includeOptional:MONITOR_DEFAULT_PREFERENCES.includeOptional,
    instantFixedPriceEmail:typeof value.instantFixedPriceEmail==='boolean'?value.instantFixedPriceEmail:MONITOR_DEFAULT_PREFERENCES.instantFixedPriceEmail,
    dailyDigest:{enabled:typeof digest.enabled==='boolean'?digest.enabled:MONITOR_DEFAULT_PREFERENCES.dailyDigest.enabled,
      time,timezone}};
}
function monitorPreferenceEnvelope(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!payload.monitorPreferences)return null;
  const stamp=typeof payload.monitorPreferencesUpdatedAt==='string'&&!Number.isNaN(Date.parse(payload.monitorPreferencesUpdatedAt))
    ?new Date(payload.monitorPreferencesUpdatedAt).toISOString():null;
  return {preferences:normalizeMonitorPreferences(payload.monitorPreferences),updatedAt:stamp};
}
function monitorGistFields(){return {monitorPreferences:normalizeMonitorPreferences(state.monitorPreferences),
  monitorPreferencesUpdatedAt:state.monitorPreferencesUpdatedAt||null};}
function monitorGistSnapshot(cl,checks,extras,fields,wrapperArts,ordered,orderedWrapperArts){
  const snapshot={checks:checks||{},extras:extras||{},ordered:normalizeOrdered(ordered)};
  if(cl===MONITOR_GIST_CHECKLIST&&fields)Object.assign(snapshot,fields);
  if(cl===WRAPPER_ART_GIST_CHECKLIST&&wrapperArts!==undefined){
    snapshot.wrapperArts=normalizeWrapperArts(wrapperArts);
    snapshot.orderedWrapperArts=normalizeWrapperArts(orderedWrapperArts);
  }
  return JSON.stringify(snapshot);
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
  const normalizedOrdered=normalizeOrdered(s.ordered);
  if(!s.ordered||JSON.stringify(s.ordered)!==JSON.stringify(normalizedOrdered))s._needsMigrationSave=true;
  s.ordered=normalizedOrdered;
  const normalizedWrapperArts=normalizeWrapperArts(s.wrapperArts);
  if(!s.wrapperArts||JSON.stringify(s.wrapperArts)!==JSON.stringify(normalizedWrapperArts))s._needsMigrationSave=true;
  s.wrapperArts=normalizedWrapperArts;
  const normalizedOrderedWrapperArts=normalizeWrapperArts(s.orderedWrapperArts);
  if(!s.orderedWrapperArts||JSON.stringify(s.orderedWrapperArts)!==JSON.stringify(normalizedOrderedWrapperArts))s._needsMigrationSave=true;
  s.orderedWrapperArts=normalizedOrderedWrapperArts;
  const normalizedMonitor=normalizeMonitorPreferences(s.monitorPreferences);
  if(!s.monitorPreferences||JSON.stringify(s.monitorPreferences)!==JSON.stringify(normalizedMonitor))s._needsMigrationSave=true;
  s.monitorPreferences=normalizedMonitor;
  s.monitorPreferencesUpdatedAt=typeof s.monitorPreferencesUpdatedAt==='string'&&!Number.isNaN(Date.parse(s.monitorPreferencesUpdatedAt))
    ?new Date(s.monitorPreferencesUpdatedAt).toISOString():null;
  s.keyVersion=2;return s;
}
let state=load();
if(state._needsMigrationSave){delete state._needsMigrationSave;save();}
let active=state.ui.active||DATA.checklists[0].id;
let search="";
const openDetails=new Set();
const openWrapperDetails=new Set();
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
function noteMonitorCollectionChange(){
  if(typeof scheduleMonitorStateChanged==='function')scheduleMonitorStateChanged();
}

function isChecked(k){ return !!state.checks[k]; }
function wrapperArtQuantity(artId){return Math.max(0,Number(state.wrapperArts[wrapperArtKey(artId)]||0));}
function orderedWrapperArtQuantity(artId){return Math.max(0,Number(state.orderedWrapperArts[wrapperArtKey(artId)]||0));}
function orderedQuantity(key){return Math.max(0,Number(state.ordered[key]||0));}
function slotQuantity(cl,it,si){return (isChecked(keyFor(cl,it,si))?1:0)+
  Math.max(0,Number(state.extras[slotExtraKeyFor(cl,it,si)]||0));}
function orderedForSlot(cl,it,si){return orderedQuantity(slotExtraKeyFor(cl,it,si));}
function checkedInGroup(cl,it,g){return g.items.filter(({si})=>isChecked(keyFor(cl,it,si))).length;}
function ownedForGroup(cl,it,g){const checked=checkedInGroup(cl,it,g);
  return usesDistinctVariants(cl)?g.items.reduce((n,{si})=>n+slotQuantity(cl,it,si),0):
    checked+Math.max(0,Number(state.extras[groupKeyFor(cl,it,g.k||g.n)]||0));}
function orderedForGroup(cl,it,g){return usesDistinctVariants(cl)?
  g.items.reduce((n,{si})=>n+orderedForSlot(cl,it,si),0):orderedQuantity(groupKeyFor(cl,it,g.k||g.n));}
function itemComplete(cl,it){const required=groupedSlots(it).filter(g=>groupTarget(g)>0);
  if(usesDistinctVariants(cl))return it.slots.some(slotRequired)&&it.slots.every((sl,si)=>
    !slotRequired(sl)||slotQuantity(cl,it,si)>=1);
  return required.length>0&&required.every(g=>ownedForGroup(cl,it,g)>=groupTarget(g));}
function itemCovered(cl,it){const required=groupedSlots(it).filter(g=>groupTarget(g)>0);
  if(usesDistinctVariants(cl))return it.slots.some(slotRequired)&&it.slots.every((sl,si)=>
    !slotRequired(sl)||slotQuantity(cl,it,si)+orderedForSlot(cl,it,si)>=1);
  return required.length>0&&required.every(g=>ownedForGroup(cl,it,g)+orderedForGroup(cl,it,g)>=groupTarget(g));}
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
function restoreQuantityFocus(cl,it,g,side){
  if(!side||typeof document==='undefined')return;
  const key=groupKeyFor(cl,it,g.k||g.n);
  const ctrl=document.querySelector('[data-qty-key="'+key+'"]');
  if(!ctrl)return;
  const sameSide=(side==='plus'||side==='minus')?ctrl.querySelector('.qtybtn.'+side):
    ctrl.querySelector('[data-qty-action="'+side+'"]');
  const target=sameSide&&!sameSide.disabled?sameSide:ctrl.querySelector('.qtynum');
  if(!target)return;
  try{target.focus({preventScroll:true});}catch(e){target.focus();}
}
function restoreVariantFocus(key,side){
  if(!side||typeof document==='undefined')return;
  const ctrl=document.querySelector('[data-variant-qty-key="'+key+'"]');
  if(!ctrl)return;
  const target=ctrl.querySelector('.variantqtybtn.'+side)||ctrl.querySelector('[data-qty-action="'+side+'"]')||ctrl.querySelector('.variantqtynum');
  if(!target||target.disabled)return;
  try{target.focus({preventScroll:true});}catch(e){target.focus();}
}
function restoreWrapperFocus(key,side){
  if(!side||typeof document==='undefined')return;
  const ctrl=document.querySelector('[data-wrapper-qty-key="'+key+'"]');
  if(!ctrl)return;
  const target=ctrl.querySelector('.variantqtybtn.'+side)||ctrl.querySelector('[data-qty-action="'+side+'"]')||ctrl.querySelector('.variantqtynum');
  if(!target||target.disabled)return;
  try{target.focus({preventScroll:true});}catch(e){target.focus();}
}
function clearCompletionLinger(){
  completionLinger.clear();
  if(completionLingerTimer){clearTimeout(completionLingerTimer);completionLingerTimer=null;}
}
function mutateGroupQuantity(cl,it,g,delta){
  const extraKey=groupKeyFor(cl,it,g.k||g.n),extra=Math.max(0,Number(state.extras[extraKey]||0));
  const distinct=usesDistinctVariants(cl);
  if(delta>0){
    const next=distinct
      ? g.items.reduce((best,current)=>slotQuantity(cl,it,current.si)<slotQuantity(cl,it,best.si)?current:best,g.items[0])
      : g.items.find(({si})=>!isChecked(keyFor(cl,it,si)));
    if(next&&distinct)mutateSlotQuantity(cl,it,next.si,1);
    else if(next)state.checks[keyFor(cl,it,next.si)]=true;
    else if(!distinct)state.extras[extraKey]=extra+1;
  }else if(delta<0){
    if(distinct){
      const owned=g.items.filter(({si})=>slotQuantity(cl,it,si)>0);
      const next=owned.reduce((best,current)=>!best||slotQuantity(cl,it,current.si)>=slotQuantity(cl,it,best.si)?current:best,null);
      if(next)mutateSlotQuantity(cl,it,next.si,-1);
    }else if(extra>0){if(extra===1)delete state.extras[extraKey];else state.extras[extraKey]=extra-1;}
    else{const checked=g.items.filter(({si})=>isChecked(keyFor(cl,it,si)));const last=checked[checked.length-1];
      if(last)delete state.checks[keyFor(cl,it,last.si)];}
  }
}
function changeQuantity(cl,it,g,delta,focusSide){
  mutateGroupQuantity(cl,it,g,delta);
  noteQuantityActivity(cl,it);
  save();driveTouch();noteMonitorCollectionChange();updateAll();restoreQuantityFocus(cl,it,g,focusSide);
}
function mutateOrderedGroup(cl,it,g,delta){
  if(usesDistinctVariants(cl)){
    if(delta>0){
      const next=g.items.reduce((best,current)=>{
        const currentTotal=slotQuantity(cl,it,current.si)+orderedForSlot(cl,it,current.si);
        const bestTotal=slotQuantity(cl,it,best.si)+orderedForSlot(cl,it,best.si);
        return currentTotal<bestTotal?current:best;
      },g.items[0]);
      const key=slotExtraKeyFor(cl,it,next.si);state.ordered[key]=orderedQuantity(key)+1;
    }else{
      const incoming=g.items.filter(({si})=>orderedForSlot(cl,it,si)>0);
      const next=incoming.reduce((best,current)=>!best||orderedForSlot(cl,it,current.si)>=orderedForSlot(cl,it,best.si)?current:best,null);
      if(next){const key=slotExtraKeyFor(cl,it,next.si),quantity=orderedQuantity(key);
        if(quantity<=1)delete state.ordered[key];else state.ordered[key]=quantity-1;}
    }
    return;
  }
  const key=groupKeyFor(cl,it,g.k||g.n),quantity=orderedQuantity(key),next=Math.max(0,quantity+delta);
  if(next>0)state.ordered[key]=next;else delete state.ordered[key];
}
function changeOrderedQuantity(cl,it,g,delta,focusSide){
  mutateOrderedGroup(cl,it,g,delta);save();driveTouch();updateAll();restoreQuantityFocus(cl,it,g,focusSide);
}
function receiveQuantity(cl,it,g,focusSide){
  if(orderedForGroup(cl,it,g)<=0)return;
  if(usesDistinctVariants(cl)){
    const incoming=g.items.filter(({si})=>orderedForSlot(cl,it,si)>0);
    const next=incoming.reduce((best,current)=>!best||orderedForSlot(cl,it,current.si)>=orderedForSlot(cl,it,best.si)?current:best,null);
    if(!next)return;
    const key=slotExtraKeyFor(cl,it,next.si),quantity=orderedQuantity(key);
    if(quantity<=1)delete state.ordered[key];else state.ordered[key]=quantity-1;
    mutateSlotQuantity(cl,it,next.si,1);
  }else{
    mutateOrderedGroup(cl,it,g,-1);mutateGroupQuantity(cl,it,g,1);
  }
  noteQuantityActivity(cl,it);save();driveTouch();noteMonitorCollectionChange();updateAll();restoreQuantityFocus(cl,it,g,focusSide);
}
function detailKey(cl,it){return [cl,normKeyPart(it.name),normKeyPart(it.code)].join('|');}
function mutateSlotQuantity(cl,it,si,delta){
  const checkKey=keyFor(cl,it,si),extraKey=slotExtraKeyFor(cl,it,si),qty=slotQuantity(cl,it,si);
  if(delta>0){if(qty===0)state.checks[checkKey]=true;else state.extras[extraKey]=Math.max(0,Number(state.extras[extraKey]||0))+1;}
  else if(delta<0&&qty>0){const extra=Math.max(0,Number(state.extras[extraKey]||0));
    if(extra>0){if(extra===1)delete state.extras[extraKey];else state.extras[extraKey]=extra-1;}
    else delete state.checks[checkKey];}
}
function changeSlotQuantity(cl,it,si,delta,focusSide){
  mutateSlotQuantity(cl,it,si,delta);openDetails.add(detailKey(cl,it));
  noteQuantityActivity(cl,it);save();driveTouch();noteMonitorCollectionChange();updateAll();restoreVariantFocus(slotExtraKeyFor(cl,it,si),focusSide);
}
function changeSlotOrderedQuantity(cl,it,si,delta,focusSide){
  const key=slotExtraKeyFor(cl,it,si),next=Math.max(0,orderedQuantity(key)+delta);
  if(next>0)state.ordered[key]=next;else delete state.ordered[key];
  openDetails.add(detailKey(cl,it));save();driveTouch();updateAll();restoreVariantFocus(key,focusSide);
}
function receiveSlotQuantity(cl,it,si,focusSide){
  const key=slotExtraKeyFor(cl,it,si),quantity=orderedQuantity(key);if(quantity<=0)return;
  if(quantity===1)delete state.ordered[key];else state.ordered[key]=quantity-1;
  mutateSlotQuantity(cl,it,si,1);openDetails.add(detailKey(cl,it));noteQuantityActivity(cl,it);
  save();driveTouch();noteMonitorCollectionChange();updateAll();restoreVariantFocus(key,focusSide);
}
function setVariantChecked(cl,it,si,checked){
  const k=keyFor(cl,it,si);
  if(checked)state.checks[k]=true;else{delete state.checks[k];delete state.extras[slotExtraKeyFor(cl,it,si)];}
  openDetails.add(detailKey(cl,it));
  noteQuantityActivity(cl,it);
  save();driveTouch();noteMonitorCollectionChange();updateAll();
}
function changeWrapperArtQuantity(artId,delta,focusSide){
  const key=wrapperArtKey(artId),current=wrapperArtQuantity(artId),next=Math.max(0,current+delta);
  if(next>0)state.wrapperArts[key]=next;else delete state.wrapperArts[key];
  save();driveTouch();updateAll();restoreWrapperFocus(key,focusSide);
}
function changeOrderedWrapperArtQuantity(artId,delta,focusSide){
  const key=wrapperArtKey(artId),current=orderedWrapperArtQuantity(artId),next=Math.max(0,current+delta);
  if(next>0)state.orderedWrapperArts[key]=next;else delete state.orderedWrapperArts[key];
  save();driveTouch();updateAll();restoreWrapperFocus(key,focusSide);
}
function receiveWrapperArt(artId,focusSide){
  const key=wrapperArtKey(artId),ordered=orderedWrapperArtQuantity(artId);if(ordered<=0)return;
  if(ordered===1)delete state.orderedWrapperArts[key];else state.orderedWrapperArts[key]=ordered-1;
  state.wrapperArts[key]=wrapperArtQuantity(artId)+1;
  save();driveTouch();updateAll();restoreWrapperFocus(key,focusSide);
}

function clProgress(cl){
  let done=0,total=0;
  cl.eras.forEach((e,ei)=>e.items.forEach((it,ii)=>it.slots.forEach((sl,si)=>{
    if(!slotRequired(sl))return; total++; if(usesDistinctVariants(cl.id)?slotQuantity(cl.id,it,si)>=1:isChecked(keyFor(cl.id,it,si))) done++;
  })));
  return {done,total};
}
function eraProgress(cl,ei){
  let done=0,total=0;
  cl.eras[ei].items.forEach((it,ii)=>it.slots.forEach((sl,si)=>{
    if(!slotRequired(sl))return; total++; if(usesDistinctVariants(cl.id)?slotQuantity(cl.id,it,si)>=1:isChecked(keyFor(cl.id,it,si)))done++;}));
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

/* ---- TCG Comps pricing bridge ----
   The dashboard never sees the provider extension id or capability token. The
   tracker extension owns those credentials and accepts messages only from this
   exact iframe/origin pair; this side answers only to the exact extension origin
   supplied in the iframe URL. Pricing state is intentionally memory-only. */
const PRICING_CHANNEL='tcg-pricing/v1';
const PRICING_QUERY='pricingConsumerOrigin';
const PRICING_TIMEOUT_MS=20000;
const PRICING_STALE_MS=24*60*60*1000;
const IDENTIFY_CHANNEL='tcg-product-identify/v1';
const IDENTIFY_RESULT_SCHEMA='tcg.product-identification/v1';
const IDENTIFY_TIMEOUT_MS=90000;
const COLLECTION_CHANNEL='tcg-collection/v1';
const COLLECTION_SNAPSHOT_SCHEMA='tcg.collection-snapshot/v2';
const COLLECTION_NAMESPACE='collection-tracker';
const COLLECTION_MAX_PRODUCTS=1200;
const MONITOR_CHANNEL='tcg-collection-monitor/v1';
const MONITOR_SUBSCRIPTION_SCHEMA='tcg.collection-monitor-subscription/v1';
const MONITOR_STATUS_SCHEMA='tcg.collection-monitor-sync-status/v1';
const MONITOR_STATUS_ACK_SCHEMA='tcg.collection-monitor-sync-status-ack/v1';
const pricingConsumerOrigin=(()=>{
  try{
    const candidate=new URLSearchParams(location.search).get(PRICING_QUERY)||'';
    return /^chrome-extension:\/\/[a-p]{32}$/.test(candidate)&&window.parent!==window?candidate:'';
  }catch(e){return '';}
})();
const pricingPending=new Map();
const identifyPending=new Map();
const pricingStates=new Map();
let pricingRequestSerial=0;
let identifyRequestSerial=0;
const PRICING_BATCH_CONCURRENCY=4;
let pricingBatch={running:false,done:0,total:0,rows:0,label:'',checklistId:null};

function pricingDefaultState(){
  return pricingConsumerOrigin
    ? {status:'idle',message:'Ready for a live price check.'}
    : {status:'unavailable',code:'MISSING_EXTENSION',message:'Open this dashboard in the installed tracker extension for live pricing.'};
}
function pricingState(productId){return pricingStates.get(productId)||pricingDefaultState();}
function pricingError(code,message){const error=new Error(message||code||'Pricing request failed');error.code=code||'BRIDGE_FAILURE';return error;}
function pricingRequest(type,payload){
  if(!pricingConsumerOrigin)return Promise.reject(pricingError('MISSING_EXTENSION','Open this dashboard in the installed tracker extension for live pricing.'));
  const requestId='tracker-'+Date.now().toString(36)+'-'+(++pricingRequestSerial).toString(36);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pricingPending.delete(requestId);reject(pricingError('BRIDGE_TIMEOUT','TCG Comps did not respond. Reload both extensions and try again.'));},PRICING_TIMEOUT_MS);
    pricingPending.set(requestId,{type:type+'Result',resolve,reject,timer});
    window.parent.postMessage(Object.assign({channel:PRICING_CHANNEL,type,requestId},payload||{}),pricingConsumerOrigin);
  });
}
window.addEventListener('message',(event)=>{
  if(!pricingConsumerOrigin||event.origin!==pricingConsumerOrigin||event.source!==window.parent)return;
  const message=event.data;
  if(!message||message.channel!==PRICING_CHANNEL||typeof message.requestId!=='string')return;
  const pending=pricingPending.get(message.requestId);
  if(!pending||message.type!==pending.type)return;
  clearTimeout(pending.timer);pricingPending.delete(message.requestId);
  if(message.error)pending.reject(pricingError(message.error.code,message.error.message));
  else pending.resolve(message.result);
});
function identifyRequest(image){
  if(!pricingConsumerOrigin)return Promise.reject(pricingError('MISSING_EXTENSION','Open this dashboard in the installed Tracker extension to identify a photo.'));
  const requestId='identify-'+Date.now().toString(36)+'-'+(++identifyRequestSerial).toString(36);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{identifyPending.delete(requestId);reject(pricingError('IDENTIFY_TIMEOUT','Photo identification timed out. Try a smaller or clearer image.'));},IDENTIFY_TIMEOUT_MS);
    identifyPending.set(requestId,{resolve,reject,timer});
    window.parent.postMessage({channel:IDENTIFY_CHANNEL,type:'identifyProduct',requestId,image,
      activeChecklist:active,candidates:RECOGNITION_PUBLIC_CATALOG},pricingConsumerOrigin);
  });
}
window.addEventListener('message',(event)=>{
  if(!pricingConsumerOrigin||event.origin!==pricingConsumerOrigin||event.source!==window.parent)return;
  const message=event.data;
  if(!message||message.channel!==IDENTIFY_CHANNEL||message.type!=='identifyProductResult'||typeof message.requestId!=='string')return;
  const pending=identifyPending.get(message.requestId);if(!pending)return;
  clearTimeout(pending.timer);identifyPending.delete(message.requestId);
  if(message.error){pending.reject(pricingError(String(message.error.code||'IDENTIFY_FAILED'),String(message.error.message||'Photo identification failed.').slice(0,500)));return;}
  const result=message.result;
  if(!result||result.schema!==IDENTIFY_RESULT_SCHEMA||!Array.isArray(result.matches)||result.matches.length>3){pending.reject(pricingError('INVALID_IDENTIFY_RESPONSE','The Tracker extension returned an invalid identification result.'));return;}
  const seen=new Set();
  for(const match of result.matches){if(!match||typeof match.candidateId!=='string'||!RECOGNITION_BY_ID.has(match.candidateId)||seen.has(match.candidateId)||
      !Number.isInteger(match.confidence)||match.confidence<0||match.confidence>100){pending.reject(pricingError('INVALID_IDENTIFY_RESPONSE','The Tracker extension returned an unknown or invalid product match.'));return;}seen.add(match.candidateId);}
  pending.resolve(result);
});

/* The extension may request a current collection catalog when the user asks it
   to decorate a marketplace page. This is deliberately a separate, read-only
   bridge: the snapshot is rebuilt from in-memory ownership on every request and
   contains ProductRefs plus counts only — never progress keys, sync credentials,
   Gist metadata, pricing values, watches, or persisted bridge state. */
function validCollectionRequestId(value){return typeof value==='string'&&value.length>0&&value.length<=160;}
function collectionCount(value,label){
  const count=Number(value);
  if(!Number.isInteger(count)||count<0||count>100000)throw new Error(label+' must be an integer from 0 to 100000');
  return count;
}
function collectionProductRef(ref){
  const games=new Set(['mtg','pokemon','lorcana','yugioh','other']);
  const productTypes=new Set(['booster','collector_booster','draft_booster','play_booster','set_booster',
    'theme_booster','jumpstart_booster','epilogue_booster','beyond_booster','mystery_booster','sample_booster',
    'prerelease_kit','elite_trainer_box','bundle','other_sealed']);
  const units=new Set(['pack','kit','display','box','bundle','case']);
  if(!ref||typeof ref!=='object'||Array.isArray(ref))throw new Error('Pricing product is missing its ProductRef');
  if(ref.schema!=='tcg.product/v1')throw new Error('ProductRef schema must be tcg.product/v1');
  if(typeof ref.productId!=='string'||ref.productId!==ref.productId.toLowerCase()||
      !/^[a-z0-9][a-z0-9:._-]{5,199}$/.test(ref.productId))throw new Error('ProductRef productId is invalid');
  if(!games.has(ref.game))throw new Error(ref.productId+': ProductRef game is unsupported');
  if(typeof ref.setName!=='string'||!ref.setName.trim())throw new Error(ref.productId+': ProductRef setName is required');
  if(typeof ref.productName!=='string'||!ref.productName.trim())throw new Error(ref.productId+': ProductRef productName is required');
  if(!productTypes.has(ref.productType))throw new Error(ref.productId+': ProductRef productType is unsupported');
  if(!units.has(ref.unit))throw new Error(ref.productId+': ProductRef unit is unsupported');
  if(typeof ref.language!=='string'||!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(ref.language))
    throw new Error(ref.productId+': ProductRef language is invalid');
  if(ref.setCode!==null&&ref.setCode!==undefined&&typeof ref.setCode!=='string')throw new Error(ref.productId+': ProductRef setCode is invalid');
  if(ref.variant!==null&&ref.variant!==undefined&&typeof ref.variant!=='string')throw new Error(ref.productId+': ProductRef variant is invalid');
  return {schema:ref.schema,productId:ref.productId,game:ref.game,setCode:ref.setCode==null?null:ref.setCode,
    setName:ref.setName,productName:ref.productName,productType:ref.productType,unit:ref.unit,
    language:ref.language,variant:ref.variant==null?null:ref.variant};
}
function collectionOwnership(cl,it,record){
  if(Object.prototype.hasOwnProperty.call(record,'slotOrdinal')){
    const si=record.slotOrdinal;
    if(!Number.isInteger(si)||si<0||si>=it.slots.length)
      throw new Error(record.ref.productId+': slotOrdinal does not identify an ownership slot');
    const target=slotRequired(it.slots[si])?1:0;
    return {target,owned:collectionCount(slotQuantity(cl.id,it,si),record.ref.productId+' owned')};
  }
  if(typeof record.slotGroup!=='string'||!record.slotGroup)
    throw new Error(record.ref.productId+': pricing product has no ownership slotGroup');
  const matches=groupedSlots(it).filter(group=>group.n===record.slotGroup);
  if(matches.length!==1)
    throw new Error(record.ref.productId+': slotGroup '+record.slotGroup+' maps to '+matches.length+' ownership groups');
  return {target:collectionCount(groupTarget(matches[0]),record.ref.productId+' target'),
    owned:collectionCount(ownedForGroup(cl.id,it,matches[0]),record.ref.productId+' owned')};
}
function buildRecognitionCatalog(){
  const catalog=[];
  DATA.checklists.forEach(cl=>cl.eras.forEach(era=>era.items.forEach(it=>(it.pricingProducts||[]).forEach(record=>{
    const ref=collectionProductRef(record.ref),candidateId='product:'+ref.productId;
    catalog.push({candidateId,kind:'product',cl,it,record,imageUrl:'',imageStatus:'',public:{candidateId,kind:'product',
      game:ref.game,label:record.label||ref.productName,setCode:ref.setCode||'',setName:ref.setName,
      productType:ref.productType,unit:ref.unit,variant:ref.variant||'',imageUrl:'',imageStatus:''}});
  }))));
  (WRAPPER_ART_CATALOG.sets||[]).forEach(wrapperSet=>(wrapperSet.artworks||[]).forEach(art=>{
    const candidateId='wrapper:'+String(art.id||'').toUpperCase();
    catalog.push({candidateId,kind:'wrapper_art',art,wrapperSet,imageUrl:art.imageUrl||'',imageStatus:art.imageStatus||'',public:{
      candidateId,kind:'wrapper_art',game:'mtg',label:wrapperSet.setName+' booster wrapper '+art.label+' ('+art.id+')',
      setCode:wrapperSet.setCode,setName:wrapperSet.setName,productType:'booster',unit:'pack',variant:art.id,
      imageUrl:art.imageUrl||'',imageStatus:art.imageStatus||''}});
  }));
  const ids=new Set();catalog.forEach(candidate=>{if(ids.has(candidate.candidateId))throw new Error('Duplicate recognition candidate '+candidate.candidateId);ids.add(candidate.candidateId);});
  if(!catalog.length||catalog.length>1200)throw new Error('Recognition catalog must contain 1 to 1200 candidates');
  return catalog;
}
const RECOGNITION_CATALOG=buildRecognitionCatalog();
const RECOGNITION_BY_ID=new Map(RECOGNITION_CATALOG.map(candidate=>[candidate.candidateId,candidate]));
const RECOGNITION_PUBLIC_CATALOG=RECOGNITION_CATALOG.map(candidate=>candidate.public);
function buildCollectionSnapshot(){
  const products={};let count=0;
  DATA.checklists.forEach(cl=>cl.eras.forEach(era=>era.items.forEach(it=>(it.pricingProducts||[]).forEach(record=>{
    const product=collectionProductRef(record.ref),productId=product.productId;
    if(Object.prototype.hasOwnProperty.call(products,productId))throw new Error(productId+': duplicate pricing ProductRef');
    const ownership=collectionOwnership(cl,it,record),target=ownership.target,owned=ownership.owned;
    const missing=Math.max(target-owned,0),requirement=target>0?'required':'optional';
    const status=missing>0?'missing':(owned>0?'owned':'target');
    products[productId]={product,target,owned,missing,requirement,status};count++;
  }))));
  if(!count)throw new Error('Collection snapshot has no pricing products');
  if(count>COLLECTION_MAX_PRODUCTS)throw new Error('Collection snapshot exceeds '+COLLECTION_MAX_PRODUCTS+' products');
  return {schema:COLLECTION_SNAPSHOT_SCHEMA,namespace:COLLECTION_NAMESPACE,products};
}
function monitorStableJson(value){
  if(Array.isArray(value))return '['+value.map(monitorStableJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+monitorStableJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function buildMonitorSubscription(){
  const preferences=normalizeMonitorPreferences(state.monitorPreferences),collection=buildCollectionSnapshot();
  const revision=contentHash(monitorStableJson({preferences,collection}));
  return {schema:MONITOR_SUBSCRIPTION_SCHEMA,namespace:COLLECTION_NAMESPACE,revision,
    generatedAt:new Date().toISOString(),preferences,collection};
}
function postMonitorSubscription(requestId){
  let result=null,error=null;
  try{result=buildMonitorSubscription();}
  catch(cause){error={code:'MONITOR_SUBSCRIPTION_BUILD_FAILED',message:String(cause&&cause.message||cause||'Monitor subscription failed').slice(0,500)};}
  const response={channel:MONITOR_CHANNEL,type:'monitorSubscriptionResult',requestId};
  if(error)response.error=error;else response.result=result;
  window.parent.postMessage(response,pricingConsumerOrigin);
}
let monitorChangeTimer=null,monitorChangeSerial=0;
function emitMonitorStateChanged(){
  monitorChangeTimer=null;
  if(!pricingConsumerOrigin)return;
  const requestId='monitor-change-'+Date.now().toString(36)+'-'+(++monitorChangeSerial).toString(36);
  window.parent.postMessage({channel:MONITOR_CHANNEL,type:'monitorStateChanged',requestId},pricingConsumerOrigin);
}
function scheduleMonitorStateChanged(){
  if(!pricingConsumerOrigin)return;
  if(monitorChangeTimer)clearTimeout(monitorChangeTimer);
  monitorChangeTimer=setTimeout(emitMonitorStateChanged,350);
}
let monitorSyncStatus={schema:MONITOR_STATUS_SCHEMA,state:pricingConsumerOrigin?'idle':'unavailable',revision:null,
  productCount:null,activeTargetCount:null,monitorConfigured:null,syncedAt:null,
  message:pricingConsumerOrigin?'Waiting for the Tracker extension to synchronize.':'Open in the paired Tracker extension to synchronize monitoring.',errorCode:null};
function sanitizeMonitorSyncStatus(value){
  const states=new Set(['idle','syncing','synced','error','unavailable']);
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schema!==MONITOR_STATUS_SCHEMA||!states.has(value.state))return null;
  const nullableString=(field,max)=>field==null?null:(typeof field==='string'&&field.length<=max?field:null);
  const nullableCount=field=>field==null?null:(Number.isInteger(field)&&field>=0&&field<=100000?field:null);
  const revision=nullableString(value.revision,200),productCount=nullableCount(value.productCount),
    activeTargetCount=nullableCount(value.activeTargetCount),message=nullableString(value.message,280),
    errorCode=nullableString(value.errorCode,100);
  if(value.revision!=null&&revision===null||value.productCount!=null&&productCount===null||
      value.activeTargetCount!=null&&activeTargetCount===null||value.message!=null&&message===null||
      value.errorCode!=null&&errorCode===null||productCount!==null&&productCount>COLLECTION_MAX_PRODUCTS||
      productCount!==null&&activeTargetCount!==null&&activeTargetCount>productCount||
      value.monitorConfigured!=null&&typeof value.monitorConfigured!=='boolean')return null;
  let syncedAt=null;
  if(value.syncedAt!=null){if(typeof value.syncedAt!=='string'||Number.isNaN(Date.parse(value.syncedAt)))return null;
    syncedAt=new Date(value.syncedAt).toISOString();}
  return {schema:MONITOR_STATUS_SCHEMA,state:value.state,revision,productCount,activeTargetCount,
    monitorConfigured:value.monitorConfigured==null?null:value.monitorConfigured,syncedAt,message,errorCode};
}
function paintMonitorSyncStatus(){
  if(typeof document==='undefined')return;
  const title=document.getElementById('monitorStatusTitle'),text=document.getElementById('monitorStatusText');
  if(!title||!text)return;
  const labels={idle:'Monitor ready',syncing:'Synchronizing monitor…',synced:'Monitor synchronized',error:'Monitor sync error',unavailable:'Monitor unavailable'};
  title.textContent=labels[monitorSyncStatus.state]||'Monitor status';
  const parts=[];
  if(monitorSyncStatus.message)parts.push(monitorSyncStatus.message);
  if(monitorSyncStatus.productCount!==null)parts.push(monitorSyncStatus.productCount+' products');
  if(monitorSyncStatus.activeTargetCount!==null)parts.push(monitorSyncStatus.activeTargetCount+' active targets');
  if(monitorSyncStatus.syncedAt)parts.push('Last sync '+new Date(monitorSyncStatus.syncedAt).toLocaleString());
  text.textContent=parts.join(' · ')||'No synchronization status has been supplied yet.';
}
function postCollectionSnapshot(requestId){
  let result=null,error=null;
  try{result=buildCollectionSnapshot();}
  catch(cause){error={code:'SNAPSHOT_BUILD_FAILED',message:String(cause&&cause.message||cause||'Collection snapshot failed').slice(0,500)};}
  const response={channel:COLLECTION_CHANNEL,type:'collectionSnapshotResult',requestId};
  if(error)response.error=error;else response.result=result;
  window.parent.postMessage(response,pricingConsumerOrigin);
}
window.addEventListener('message',(event)=>{
  if(!pricingConsumerOrigin||event.origin!==pricingConsumerOrigin||event.source!==window.parent)return;
  const message=event.data;
  if(!message||message.channel!==COLLECTION_CHANNEL||message.type!=='collectionSnapshot'||
      !validCollectionRequestId(message.requestId))return;
  postCollectionSnapshot(message.requestId);
});
window.addEventListener('message',(event)=>{
  if(!pricingConsumerOrigin||event.origin!==pricingConsumerOrigin||event.source!==window.parent)return;
  const message=event.data;
  if(!message||message.channel!==MONITOR_CHANNEL||!validCollectionRequestId(message.requestId))return;
  if(message.type==='monitorSubscription'){postMonitorSubscription(message.requestId);return;}
  if(message.type!=='monitorSyncStatus')return;
  const status=sanitizeMonitorSyncStatus(message.status);
  if(!status)return;
  monitorSyncStatus=status;paintMonitorSyncStatus();
  window.parent.postMessage({channel:MONITOR_CHANNEL,type:'monitorSyncStatusResult',requestId:message.requestId,
    result:{schema:MONITOR_STATUS_ACK_SCHEMA,accepted:true}},pricingConsumerOrigin);
});

function interpretPriceResponse(product,response){
  if(!response||typeof response!=='object')return {status:'error',code:'INVALID_RESPONSE',message:'TCG Comps returned an invalid response.'};
  if(Number(response.apiVersion)!==1)return {status:'error',code:'UNSUPPORTED_VERSION',message:'TCG Comps API version 1 is required.'};
  if(response.error){
    const code=String(response.error.code||'SOURCE_FAILURE');
    const unavailable=code==='NO_PRODUCT_MATCH'||code==='NO_VERIFIED_PRICE';
    return {status:unavailable?'unavailable':'error',code,message:String(response.error.message||code),engineVersion:response.engineVersion||null};
  }
  if(response.schema!=='tcg.valuation/v1'||!response.product||response.product.schema!=='tcg.product/v1'||response.product.productId!==product.productId){
    return {status:'error',code:'PRODUCT_MISMATCH',message:'TCG Comps did not return this exact product. No value or watch was accepted.',engineVersion:response.engineVersion||null};
  }
  if(!(response.market&&Number.isFinite(Number(response.market.value)))&&!(response.lowestAsk&&Number.isFinite(Number(response.lowestAsk.landedPrice)))){
    return {status:'unavailable',code:'NO_VERIFIED_PRICE',message:'No verified market value or ask is available for this exact product.',engineVersion:response.engineVersion||null};
  }
  return {status:'success',valuation:response,engineVersion:response.engineVersion||null};
}
function pricingCanWatch(priceState,product){
  return !!(priceState&&priceState.status==='success'&&priceState.valuation&&
    priceState.valuation.product&&priceState.valuation.product.productId===product.productId);
}
function pricingWatchId(product){return 'tracker:'+contentHash(product.productId);}
function pricingMoney(value){const n=Number(value);return Number.isFinite(n)?n.toLocaleString('en-US',{style:'currency',currency:'USD'}):'Unavailable';}
function pricingTime(value){
  const n=Date.parse(value||'');
  return Number.isFinite(n)?new Date(n).toLocaleString():'Unavailable';
}
function safePriceUrl(value){
  try{const u=new URL(value);return /^https:$/.test(u.protocol)?u.toString():'';}catch(e){return '';}
}
function refreshPrice(product,options){
  options=options||{};
  const prior=options.prior||pricingState(product.productId),repaint=options.repaint!==false;
  pricingStates.set(product.productId,Object.assign({},prior,{status:'loading',message:'Refreshing live pricing…'}));if(repaint)renderContent();
  return pricingRequest('priceProduct',{target:product,options:{includeActive:true,includeRecentSales:true}})
    .then(response=>{pricingStates.set(product.productId,Object.assign({},prior,interpretPriceResponse(product,response)));if(repaint)renderContent();})
    .catch(error=>{pricingStates.set(product.productId,Object.assign({},prior,{status:'error',code:error.code||'BRIDGE_FAILURE',message:String(error.message||error)}));if(repaint)renderContent();});
}
function pricingItems(cl,mode,item){
  const rows=item?[item]:cl.eras.flatMap(era=>era.items);
  if(mode!=='unfinished')return rows.filter(it=>(it.pricingProducts||[]).length);
  return rows.filter(it=>(it.pricingProducts||[]).length&&it.slots.some(slotRequired)&&!itemComplete(cl.id,it));
}
function pricingQueueFor(items){
  const seen=new Set(),queue=[];
  items.forEach(it=>(it.pricingProducts||[]).forEach(record=>{
    const product=record.ref;
    if(product&&product.productId&&!seen.has(product.productId)){seen.add(product.productId);queue.push(product);}
  }));
  return queue;
}
function pricingItemStatus(item){
  const states=(item.pricingProducts||[]).map(record=>pricingState(record.ref.productId));
  if(states.some(ps=>ps.status==='loading'))return 'loading';
  if(states.some(ps=>ps.status==='error'))return 'error';
  if(states.length&&states.every(ps=>ps.status==='success'))return 'live';
  return 'idle';
}
function paintPricingBatch(){
  const btn=document.getElementById('priceRefreshBtn');if(!btn)return;
  const cl=DATA.checklists.find(candidate=>candidate.id===active);
  const all=cl?pricingItems(cl,'all'):[],unfinished=cl?pricingItems(cl,'unfinished'):[];
  const allCount=document.getElementById('refreshAllCount'),unfinishedCount=document.getElementById('refreshUnfinishedCount');
  if(allCount)allCount.textContent=String(all.length);if(unfinishedCount)unfinishedCount.textContent=String(unfinished.length);
  const disabled=!pricingConsumerOrigin||pricingBatch.running;
  ['refreshAllPrices','refreshUnfinishedPrices'].forEach(id=>{const row=document.getElementById(id);if(row){row.disabled=disabled;row.classList.toggle('disabled',disabled);}});
  btn.classList.toggle('pricing-active',pricingBatch.running);
  const label=pricingBatch.running?('Refreshing '+pricingBatch.done+' of '+pricingBatch.total+' prices'):'Refresh prices';
  btn.title=label;btn.setAttribute('aria-label',label);
  const status=document.getElementById('pricingMenuStatus');if(!status)return;
  if(pricingBatch.running)status.textContent=pricingBatch.label+' · '+pricingBatch.done+'/'+pricingBatch.total+' prices';
  else if(!pricingConsumerOrigin)status.textContent='Open in the paired tracker extension to use live pricing.';
  else status.textContent='Refreshes every pricing product for the selected rows on this checklist.';
}
function startPricingRefresh(mode,item){
  if(!pricingConsumerOrigin){toast('Open this dashboard in the paired tracker extension');return Promise.resolve(false);}
  if(pricingBatch.running){toast('A price refresh is already running');return Promise.resolve(false);}
  const cl=DATA.checklists.find(candidate=>candidate.id===active),items=pricingItems(cl,mode,item),products=pricingQueueFor(items)
    .filter(product=>pricingState(product.productId).status!=='loading');
  if(!products.length){toast(mode==='unfinished'?'No unfinished items to refresh':'No pricing products to refresh');return Promise.resolve(false);}
  const queued=products.map(product=>({product,prior:pricingState(product.productId)}));
  queued.forEach(({product,prior})=>pricingStates.set(product.productId,Object.assign({},prior,{status:'loading',message:'Queued for live pricing…'})));
  pricingBatch={running:true,done:0,total:queued.length,rows:items.length,
    label:item?('Refreshing '+item.name):(mode==='unfinished'?'Refreshing unfinished items':'Refreshing all items'),checklistId:cl.id};
  closeMenus();renderContent();paintPricingBatch();
  let cursor=0;
  async function worker(){
    while(cursor<queued.length){const entry=queued[cursor++];
      await refreshPrice(entry.product,{prior:entry.prior,repaint:false});
      pricingBatch.done++;paintPricingBatch();
    }
  }
  return Promise.all(Array.from({length:Math.min(PRICING_BATCH_CONCURRENCY,queued.length)},worker)).then(()=>{
    const failures=queued.filter(({product})=>pricingState(product.productId).status==='error').length;
    const unavailable=queued.filter(({product})=>pricingState(product.productId).status==='unavailable').length;
    pricingBatch.running=false;renderContent();paintPricingBatch();
    toast('Refreshed '+queued.length+' price'+(queued.length===1?'':'s')+
      (failures||unavailable?' · '+(failures+unavailable)+' unavailable/error':''));
    return true;
  });
}
function watchRule(product,threshold){
  return {schema:'tcg.watch-rule/v1',watchId:pricingWatchId(product),product,enabled:true,
    threshold:{maxLandedPrice:threshold,maxUnitPrice:null,maxMarketRatio:null},
    sources:['ebay','tcgplayer'],minimumConfidence:'medium',cooldownMinutes:1440,
    delivery:{chrome:true,monitorWebhook:false}};
}
function runWatchAction(product,action,threshold){
  const current=pricingState(product.productId);
  if(!pricingCanWatch(current,product))return;
  pricingStates.set(product.productId,Object.assign({},current,{watchBusy:true,watchMessage:'Working…'}));renderContent();
  let call;
  if(action==='upsert')call=pricingRequest('watchUpsert',{rule:watchRule(product,threshold)});
  else if(action==='remove')call=pricingRequest('watchRemove',{watchId:pricingWatchId(product)});
  else call=pricingRequest('watchRun',{watchId:pricingWatchId(product)});
  call.then(response=>{
    if(response&&response.error)throw pricingError(response.error.code,response.error.message);
    const latest=pricingState(product.productId);
    pricingStates.set(product.productId,Object.assign({},latest,{watchBusy:false,watchSaved:action==='remove'?false:true,
      watchThreshold:action==='upsert'?threshold:latest.watchThreshold,
      watchMessage:action==='upsert'?'Watch saved in TCG Comps.':action==='remove'?'Watch removed from TCG Comps.':'Watch check finished.'}));
    renderContent();
  }).catch(error=>{
    const latest=pricingState(product.productId);
    pricingStates.set(product.productId,Object.assign({},latest,{watchBusy:false,watchMessage:String(error.message||error)}));renderContent();
  });
}
function appendFact(host,label,value){
  const span=document.createElement('span'),b=document.createElement('b');b.textContent=label+': ';
  span.appendChild(b);span.appendChild(document.createTextNode(value));host.appendChild(span);
}
function renderPricingList(products){
  const list=document.createElement('div');list.className='pricinglist';
  const title=document.createElement('div');title.className='pricingtitle';title.textContent='TCG Comps live pricing';list.appendChild(title);
  products.forEach(record=>{
    const product=record.ref,ps=pricingState(product.productId),card=document.createElement('div');card.className='pricecard';
    const head=document.createElement('div');head.className='pricehead';
    const label=document.createElement('b');label.textContent=record.label;
    const badge=document.createElement('span');badge.className='pricebadge';
    if(ps.status==='loading'){badge.classList.add('loading');badge.textContent='Refreshing';}
    else if(ps.status==='success'){
      const observed=Date.parse(ps.valuation.observedAt||''),stale=Number.isFinite(observed)&&Date.now()-observed>PRICING_STALE_MS;
      badge.classList.add(stale?'stale':'live');badge.textContent=stale?'Stale':'Live';
    }else if(ps.status==='error'){badge.classList.add('error');badge.textContent='Error';}
    else if(ps.status==='unavailable'){badge.textContent=ps.code==='MISSING_EXTENSION'?'Extension needed':'Unavailable';}
    else badge.textContent='Not checked';
    head.appendChild(label);head.appendChild(badge);card.appendChild(head);
    if(ps.status==='success'){
      const valuation=ps.valuation,facts=document.createElement('div');facts.className='pricefacts';
      appendFact(facts,'Live value',pricingMoney(valuation.market&&valuation.market.value));
      appendFact(facts,'Lowest verified ask',pricingMoney(valuation.lowestAsk&&valuation.lowestAsk.landedPrice));
      appendFact(facts,'Confidence',String(valuation.market&&valuation.market.confidence||'unavailable'));
      appendFact(facts,'Checked',pricingTime(valuation.observedAt));card.appendChild(facts);
      const askUrl=safePriceUrl(valuation.lowestAsk&&valuation.lowestAsk.url);
      if(askUrl){const link=document.createElement('a');link.href=askUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open verified lowest ask';card.appendChild(link);}
    }else if(ps.status==='unavailable'||ps.status==='error'){
      const error=document.createElement('div');error.className=ps.status==='error'?'priceerror':'pricefallback';error.textContent=ps.message||'Live pricing is unavailable.';card.appendChild(error);
    }
    if(record.staticValue){const fallback=document.createElement('div');fallback.className='pricefallback';
      const b=document.createElement('b');b.textContent='Static fallback: ';fallback.appendChild(b);fallback.appendChild(document.createTextNode(record.staticValue));card.appendChild(fallback);}
    const actions=document.createElement('div');actions.className='priceactions';
    const refresh=document.createElement('button');refresh.type='button';refresh.className='pricebtn';refresh.textContent=ps.status==='success'?'Refresh price':'Check live price';
    refresh.disabled=ps.status==='loading'||pricingBatch.running||!pricingConsumerOrigin;refresh.onclick=()=>refreshPrice(product);actions.appendChild(refresh);card.appendChild(actions);
    if(pricingCanWatch(ps,product)){
      const box=document.createElement('div');box.className='watchbox';
      const watchLabel=document.createElement('label');watchLabel.textContent='Alert at landed price ≤ $';
      const input=document.createElement('input');input.type='number';input.min='0.01';input.step='0.01';input.inputMode='decimal';input.value=ps.watchThreshold||'';
      input.setAttribute('aria-label','Maximum landed price for '+record.label);
      input.oninput=()=>{const latest=pricingState(product.productId);latest.watchThreshold=input.value;pricingStates.set(product.productId,latest);};
      const saveWatch=document.createElement('button');saveWatch.type='button';saveWatch.className='pricebtn';saveWatch.textContent='Save watch';saveWatch.disabled=!!ps.watchBusy;
      saveWatch.onclick=()=>{const value=Number(input.value);if(!(value>0)){input.setCustomValidity('Enter a positive price.');input.reportValidity();return;}input.setCustomValidity('');runWatchAction(product,'upsert',value);};
      const runWatch=document.createElement('button');runWatch.type='button';runWatch.className='pricebtn';runWatch.textContent='Run now';runWatch.disabled=!!ps.watchBusy;runWatch.onclick=()=>runWatchAction(product,'run');
      const removeWatch=document.createElement('button');removeWatch.type='button';removeWatch.className='pricebtn';removeWatch.textContent='Remove';removeWatch.disabled=!!ps.watchBusy;removeWatch.onclick=()=>runWatchAction(product,'remove');
      box.appendChild(watchLabel);box.appendChild(input);box.appendChild(saveWatch);box.appendChild(runWatch);box.appendChild(removeWatch);
      if(ps.watchMessage){const msg=document.createElement('span');msg.className='watchmsg';msg.textContent=ps.watchMessage;box.appendChild(msg);}
      card.appendChild(box);
    }
    list.appendChild(card);
  });
  return list;
}
/* ---- end TCG Comps pricing bridge ---- */

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

function wrapperArtOwnedCount(wrapperSet){
  return (wrapperSet.artworks||[]).filter(art=>wrapperArtQuantity(art.id)>0).length;
}
function wrapperArtCopyCount(wrapperSet){
  return (wrapperSet.artworks||[]).reduce((total,art)=>total+wrapperArtQuantity(art.id),0);
}
function wrapperArtOrderedCount(wrapperSet){
  return (wrapperSet.artworks||[]).reduce((total,art)=>total+orderedWrapperArtQuantity(art.id),0);
}
function loadWrapperArtImages(root){
  root.querySelectorAll('img[data-wrapper-src]').forEach(img=>{
    img.src=img.dataset.wrapperSrc;delete img.dataset.wrapperSrc;
  });
}
function packageIconSVG(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 4.3 9 5.1v10.2l-9-5.1z"/><path d="m7.5 4.3-4 2.3v10.2l4 2.3 9-5.1V9.4z"/><path d="m3.5 6.6 9 5.1 4-2.3M12.5 11.7v5.1"/></svg>';}
function receiveIconSVG(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l3 3v6H7z"/><path d="m7 3 5 3 5-3M12 6v6"/><path d="M3 15h5l2 2h5.5a2.5 2.5 0 0 1 2.5 2.5V21H9l-3-2H3z"/><path d="M18 16.5 21 14v5l-3 2"/></svg>';}
function makeOrderedControl(quantity,label,onMinus,onPlus,onReceive){
  const ctrl=document.createElement('div');ctrl.className='orderedqty';
  const icon=document.createElement('span');icon.className='ordericon';icon.innerHTML=packageIconSVG();icon.title=quantity+' ordered';
  const minus=document.createElement('button');minus.type='button';minus.className='orderedqtybtn';minus.textContent='−';minus.disabled=quantity===0;
  minus.dataset.qtyAction='orderminus';minus.setAttribute('aria-label','Remove one ordered '+label);minus.onclick=onMinus;
  const num=document.createElement('span');num.className='orderedqtynum';num.textContent=quantity;
  num.setAttribute('aria-label',quantity+' ordered '+label);
  const plus=document.createElement('button');plus.type='button';plus.className='orderedqtybtn';plus.textContent='+';
  plus.dataset.qtyAction='orderplus';plus.setAttribute('aria-label','Add one ordered '+label);plus.onclick=onPlus;
  const receive=document.createElement('button');receive.type='button';receive.className='receiveqty';receive.innerHTML=receiveIconSVG();
  receive.disabled=quantity===0;receive.dataset.qtyAction='receive';receive.title='Receive one ordered '+label;
  receive.setAttribute('aria-label','Receive one ordered '+label+' into your collection');receive.onclick=onReceive;
  ctrl.appendChild(icon);ctrl.appendChild(minus);ctrl.appendChild(num);ctrl.appendChild(plus);ctrl.appendChild(receive);return ctrl;
}
function makeOrderPeek(quantity,label){
  const peek=document.createElement('button');peek.type='button';peek.className='orderpeek';peek.innerHTML=packageIconSVG()+'<span>'+quantity+'</span>';
  peek.setAttribute('aria-label',quantity+' ordered '+label+'. Focus to adjust or receive.');return peek;
}
function renderWrapperArtChecklist(cl,it,wrapperSet){
  const details=document.createElement('details');details.className='wrapperarts';
  const transientKey=detailKey(cl.id,it)+'|wrapper-art';
  details.open=openWrapperDetails.has(transientKey);
  const summary=document.createElement('summary');
  const title=document.createElement('span');title.className='wrapperart-title';title.textContent='Wrapper artwork (optional)';
  const progress=document.createElement('span');progress.className='wrapperart-summary';
  const paintProgress=()=>{const owned=wrapperArtOwnedCount(wrapperSet),total=wrapperSet.artworks.length,copies=wrapperArtCopyCount(wrapperSet),
    ordered=wrapperArtOrderedCount(wrapperSet);
    progress.textContent=owned+' / '+total+' fronts · '+copies+' '+(copies===1?'copy':'copies')+(ordered?' · '+ordered+' ordered':'');};
  paintProgress();summary.appendChild(title);summary.appendChild(progress);details.appendChild(summary);
  const note=document.createElement('div');note.className='wrapperart-note';
  note.textContent='Optional loose-wrapper inventory only — it does not affect pack targets or collection completion.';
  details.appendChild(note);
  const grid=document.createElement('div');grid.className='wrapperart-grid';
  (wrapperSet.artworks||[]).forEach(art=>{
    const owned=wrapperArtQuantity(art.id),ordered=orderedWrapperArtQuantity(art.id);
    const card=document.createElement('div');card.className='wrapperart-card'+(owned>0?' owned':'')+(ordered>0?' ordered':'');
    const media=document.createElement('span');media.className='wrapperart-media';
    const fallback=document.createElement('span');fallback.className='wrapperart-fallback';fallback.textContent='Image unavailable';
    if(art.imageUrl){
      const img=document.createElement('img');img.alt=wrapperSet.setName+' '+art.label+' booster wrapper';
      img.loading='lazy';img.decoding='async';img.dataset.wrapperSrc=art.imageUrl;
      img.onerror=()=>{img.remove();fallback.hidden=false;};fallback.hidden=true;
      media.appendChild(img);
    }
    media.appendChild(fallback);
    const head=document.createElement('span');head.className='wrapperart-head';
    const label=document.createElement('span');label.className='wrapperart-check';label.textContent=art.label+' · '+art.id;
    const manage=document.createElement('div');manage.className='wrappermanage';manage.dataset.wrapperQtyKey=wrapperArtKey(art.id);
    const ctrl=document.createElement('div');ctrl.className='variantqty';
    const minus=document.createElement('button');minus.type='button';minus.className='variantqtybtn minus';minus.textContent='−';minus.disabled=owned===0;
    minus.dataset.qtyAction='minus';
    minus.setAttribute('aria-label','Remove one '+wrapperSet.setName+' '+art.label+' wrapper');
    minus.onclick=()=>changeWrapperArtQuantity(art.id,-1,'minus');
    const num=document.createElement('span');num.className='variantqtynum'+(owned>0?' met':'');num.textContent=owned;
    num.setAttribute('aria-label',owned+' copies owned of '+wrapperSet.setName+' '+art.label+' wrapper');
    const plus=document.createElement('button');plus.type='button';plus.className='variantqtybtn plus';plus.textContent='+';
    plus.dataset.qtyAction='plus';
    plus.setAttribute('aria-label','Add one '+wrapperSet.setName+' '+art.label+' wrapper');
    plus.onclick=()=>changeWrapperArtQuantity(art.id,1,'plus');
    ctrl.appendChild(minus);ctrl.appendChild(num);ctrl.appendChild(plus);
    const orderedCtrl=makeOrderedControl(ordered,wrapperSet.setName+' '+art.label+' wrapper',
      ()=>changeOrderedWrapperArtQuantity(art.id,-1,'orderminus'),
      ()=>changeOrderedWrapperArtQuantity(art.id,1,'orderplus'),
      ()=>receiveWrapperArt(art.id,'receive'));
    orderedCtrl.classList.add('detailordertray');
    manage.appendChild(ctrl);manage.appendChild(makeOrderPeek(ordered,wrapperSet.setName+' '+art.label+' wrapper'));
    manage.appendChild(orderedCtrl);head.appendChild(label);head.appendChild(manage);
    const status=wrapperArtStatusLabel(art),statusEl=document.createElement('span');
    statusEl.className='wrapperart-status '+status.kind;statusEl.textContent=status.text;
    card.appendChild(media);card.appendChild(head);card.appendChild(statusEl);grid.appendChild(card);
  });
  details.appendChild(grid);
  details.addEventListener('toggle',()=>{
    if(details.open){openWrapperDetails.add(transientKey);loadWrapperArtImages(details);}
    else openWrapperDetails.delete(transientKey);
  });
  if(details.open)loadWrapperArtImages(details);
  return details;
}

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
      body.style.setProperty('--onew',usesDistinctVariants(cl.id)?'40px':'30px');
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
      const detailIsOpen=openDetails.has(detailKey(cl.id,it));
      const item=document.createElement('div'); item.className='item'+(allDone?' done':'')+(detailIsOpen?' open':'');
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
        const target=groupTarget(g),goal=target>0,owned=ownedForGroup(cl.id,it,g),ordered=orderedForGroup(cl.id,it,g),
          color=g.items[0].sl.c||'var(--lpurple)';
        const distinct=usesDistinctVariants(cl.id),completeVariants=distinct?
          g.items.filter(({sl,si})=>!slotRequired(sl)||slotQuantity(cl.id,it,si)>=1).length:0;
        const ctrl=document.createElement('div');ctrl.className='qtyctrl '+(goal?'goal':'bonus');
        ctrl.dataset.qtyKey=groupKeyFor(cl.id,it,g.k||g.n);ctrl.style.setProperty('--qtyc',color);
        const minus=document.createElement('button');minus.type='button';minus.className='qtybtn minus';minus.textContent='−';
        minus.dataset.qtyAction='minus';
        minus.disabled=owned===0;minus.setAttribute('aria-label','Remove one '+(goal?'':'bonus ')+quantityNoun(g.n,1)+' from '+it.name);
        minus.onclick=()=>changeQuantity(cl.id,it,g,-1,'minus');
        const physicallyComplete=distinct?itemComplete(cl.id,it):(goal&&owned>=target),covered=goal&&!physicallyComplete&&
          (distinct?itemCovered(cl.id,it):owned+ordered>=target);
        const num=document.createElement('button');num.type='button';num.className='qtynum'+
          (physicallyComplete?' met':(covered?' covered':(!goal&&owned>0?' owned':'')));
        num.textContent=owned;num.title=(distinct?(owned+' total copies · '+completeVariants+'/'+target+' variants complete'):
          (goal?(owned+' owned · goal '+target):(owned+' owned · bonus inventory · not part of completion')))+
          (ordered?' · '+ordered+' ordered':'');
        num.setAttribute('aria-label',owned+' '+quantityNoun(g.n,owned)+' owned and '+ordered+' ordered for '+it.name+'; '+
          (distinct?(completeVariants+' of '+target+' distinct variants complete.'):
          (goal?('goal '+target+'.'):('bonus inventory, not part of completion.')))+' Focus to adjust.');
        const plus=document.createElement('button');plus.type='button';plus.className='qtybtn plus';plus.textContent='+';
        plus.dataset.qtyAction='plus';
        plus.setAttribute('aria-label','Add one '+(goal?'':'bonus ')+quantityNoun(g.n,1)+' to '+it.name);plus.onclick=()=>changeQuantity(cl.id,it,g,1,'plus');
        const incoming=document.createElement('span');incoming.className='incomingbadge';incoming.hidden=ordered===0;
        incoming.innerHTML=packageIconSVG()+'<span>+'+ordered+'</span>';
        const orderedCtrl=makeOrderedControl(ordered,quantityNoun(g.n,1)+' for '+it.name,
          ()=>changeOrderedQuantity(cl.id,it,g,-1,'orderminus'),
          ()=>changeOrderedQuantity(cl.id,it,g,1,'orderplus'),
          ()=>receiveQuantity(cl.id,it,g,'receive'));
        orderedCtrl.classList.add('ordertray');
        ctrl.appendChild(minus);ctrl.appendChild(num);ctrl.appendChild(plus);ctrl.appendChild(incoming);ctrl.appendChild(orderedCtrl);bx.appendChild(ctrl);
        wrap.appendChild(bx); checks.appendChild(wrap);
      });
      const meta=document.createElement('div'); meta.className='meta';
      /* Drop any tag that just repeats a column heading — on the Packs tab the
         Draft/Set/Collector pills said exactly what the columns already say.
         Tags that carry real information (box type, set type, release date)
         don't match a column name and survive. */
      let tags=it.tags.filter(t=>eraCols.indexOf(t.t)<0)
        .map(t=>`<span class="tag" style="background:${t.c}">${t.t}</span>`).join('');
      if(usesDistinctVariants(cl.id)&&(it.variants||[]).length>1){
        const completed=it.slots.filter((sl,si)=>slotRequired(sl)&&slotQuantity(cl.id,it,si)>=1).length;
        tags+=`<span class="tag" style="background:var(--gold)">${completed}/${it.slots.filter(slotRequired).length} variants</span>`;
      }else if(usesGroupVariants(cl.id)&&(it.variants||[]).length>1){
        const total=groupedSlots(it).reduce((n,g)=>n+ownedForGroup(cl.id,it,g),0);
        tags+=`<span class="tag" style="background:var(--muted)">${total} total</span>`;
      }
      /* Name, code and type share one line — the old two-line stack made every
         row ~20px taller for information that fits comfortably beside it. */
      meta.innerHTML=`<div class="mline"><span class="mname">${it.name}</span>`
        + (it.code?`<span class="code">${it.code}</span>`:'') + tags + `</div>`;
      row.appendChild(checks); row.appendChild(meta);
      if(it.value){ const v=document.createElement('div'); v.className='val'+(it.est?' est':'');
        v.innerHTML=valueHTML(it.value,it.est); v.title=it.value.includes(' / ')?'MSRP / current market':''; row.appendChild(v); }
      const pricingProducts=it.pricingProducts||[];
      if(pricingProducts.length){
        const priceStatus=pricingItemStatus(it),priceRefresh=document.createElement('button');
        priceRefresh.type='button';priceRefresh.className='rowpricebtn '+priceStatus;
        priceRefresh.innerHTML='<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><polyline points="20 4 20 11 13 11"/></svg>';
        priceRefresh.disabled=!pricingConsumerOrigin||pricingBatch.running||priceStatus==='loading';
        const priceLabel=(priceStatus==='loading'?'Refreshing prices for ':'Refresh prices for ')+it.name;
        priceRefresh.title=!pricingConsumerOrigin?'Open in the tracker extension for live pricing':priceLabel;
        priceRefresh.setAttribute('aria-label',priceRefresh.title);
        priceRefresh.onclick=(event)=>{event.stopPropagation();startPricingRefresh('all',it);};
        row.appendChild(priceRefresh);
      }
      /* Detail drawer: only built when there is something to say. */
      const extra=[];
      if(it.note) extra.push(it.note);
      if(it.est)  extra.push('Value is a best-effort estimate — verify before buying.');
      const productImages=it.images||[];
      const wrapperArtSet=wrapperArtSetFor(cl.id,it);
      const namedVariants=usesDistinctVariants(cl.id)&&(it.variants||[]).length>1?
        (it.variants||[]).map((name,si)=>({name,si,target:1})):
        (usesGroupVariants(cl.id)&&(it.variants||[]).length>1?(it.variants||[]).map(variant=>{
          const group=groupedSlots(it).find(g=>g.n===variant.group);
          return {name:variant.name,group,target:variant.target||groupTarget(group)};
        }):[]);
      if(extra.length||productImages.length||namedVariants.length||pricingProducts.length||wrapperArtSet){
        const tog=document.createElement('button');
        tog.className='rowtog'; tog.setAttribute('aria-expanded',detailIsOpen?'true':'false');
        tog.setAttribute('aria-label',(detailIsOpen?'Hide':'Show')+' details for '+it.name);
        tog.innerHTML='<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';
        tog.onclick=(e)=>{ e.stopPropagation();
          const open=item.classList.toggle('open');
          if(open)openDetails.add(detailKey(cl.id,it));else openDetails.delete(detailKey(cl.id,it));
          if(open)item.querySelectorAll('.productpic img[data-src]').forEach(img=>{
            img.src=img.dataset.src;delete img.dataset.src;});
          tog.setAttribute('aria-expanded', open?'true':'false');
          tog.setAttribute('aria-label',(open?'Hide':'Show')+' details for '+it.name); };
        row.appendChild(tog);
        const det=document.createElement('div'); det.className='rowdet';
        if(productImages.length){
          const pics=document.createElement('div');pics.className='rowpics';
          productImages.forEach(image=>{
            const fig=document.createElement('figure');fig.className='productpic';
            const img=document.createElement('img');
            if(detailIsOpen)img.src=image.url;else img.dataset.src=image.url;
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
        if(wrapperArtSet)det.appendChild(renderWrapperArtChecklist(cl,it,wrapperArtSet));
        if(namedVariants.length){
          const variants=document.createElement('div');variants.className='variantlist';
          const title=document.createElement('div');title.className='varianttitle';
          const titleText=document.createElement('span');
          titleText.textContent=usesDistinctVariants(cl.id)?'Distinct sealed variants':'Booster pack types';
          const totalOwned=namedVariants.reduce((n,variant)=>n+(variant.group?
            ownedForGroup(cl.id,it,variant.group):slotQuantity(cl.id,it,variant.si)),0);
          const totalOrdered=namedVariants.reduce((n,variant)=>n+(variant.group?
            orderedForGroup(cl.id,it,variant.group):orderedForSlot(cl.id,it,variant.si)),0);
          const metCount=namedVariants.filter(variant=>(variant.group?
            ownedForGroup(cl.id,it,variant.group):slotQuantity(cl.id,it,variant.si))>=variant.target).length;
          const summary=document.createElement('span');summary.className='variantsummary';
          summary.textContent=totalOwned+' owned'+(totalOrdered?' · '+totalOrdered+' ordered':'')+' · '+metCount+'/'+namedVariants.length+' complete';
          title.appendChild(titleText);title.appendChild(summary);variants.appendChild(title);
          const grid=document.createElement('div');grid.className='variantgrid';
          namedVariants.forEach(variant=>{
            const variantRow=document.createElement('div');variantRow.className='variantrow';
            const text=document.createElement('span');text.className='variantname';text.textContent=variant.name;
            const goal=document.createElement('span');goal.className='variantgoal';goal.textContent='goal '+variant.target;
            const owned=variant.group?ownedForGroup(cl.id,it,variant.group):slotQuantity(cl.id,it,variant.si);
            const ordered=variant.group?orderedForGroup(cl.id,it,variant.group):orderedForSlot(cl.id,it,variant.si);
            const key=variant.group?groupKeyFor(cl.id,it,variant.group.k||variant.group.n):slotExtraKeyFor(cl.id,it,variant.si);
            const manage=document.createElement('div');manage.className='variantmanage';manage.dataset.variantQtyKey=key;
            const ctrl=document.createElement('div');ctrl.className='variantqty';
            const minus=document.createElement('button');minus.type='button';minus.className='variantqtybtn minus';minus.textContent='−';minus.disabled=owned===0;
            minus.dataset.qtyAction='minus';
            minus.setAttribute('aria-label','Remove one '+variant.name+' from '+it.name);
            minus.onclick=()=>{if(variant.group){changeQuantity(cl.id,it,variant.group,-1);restoreVariantFocus(key,'minus');}
              else changeSlotQuantity(cl.id,it,variant.si,-1,'minus');};
            const num=document.createElement('span');num.className='variantqtynum'+(owned>=variant.target?' met':'');num.textContent=owned;
            num.setAttribute('aria-label',owned+' owned; goal '+variant.target+' for '+variant.name);
            const plus=document.createElement('button');plus.type='button';plus.className='variantqtybtn plus';plus.textContent='+';
            plus.dataset.qtyAction='plus';
            plus.setAttribute('aria-label','Add one '+variant.name+' to '+it.name);
            plus.onclick=()=>{if(variant.group){changeQuantity(cl.id,it,variant.group,1);restoreVariantFocus(key,'plus');}
              else changeSlotQuantity(cl.id,it,variant.si,1,'plus');};
            ctrl.appendChild(minus);ctrl.appendChild(num);ctrl.appendChild(plus);
            const orderedCtrl=makeOrderedControl(ordered,variant.name+' from '+it.name,
              ()=>{if(variant.group)changeOrderedQuantity(cl.id,it,variant.group,-1,'orderminus');
                else changeSlotOrderedQuantity(cl.id,it,variant.si,-1,'orderminus');},
              ()=>{if(variant.group)changeOrderedQuantity(cl.id,it,variant.group,1,'orderplus');
                else changeSlotOrderedQuantity(cl.id,it,variant.si,1,'orderplus');},
              ()=>{if(variant.group)receiveQuantity(cl.id,it,variant.group,'receive');
                else receiveSlotQuantity(cl.id,it,variant.si,'receive');});
            manage.appendChild(ctrl);manage.appendChild(orderedCtrl);
            variantRow.appendChild(text);variantRow.appendChild(goal);variantRow.appendChild(manage);grid.appendChild(variantRow);
          });
          variants.appendChild(grid);det.appendChild(variants);
        }
        if(pricingProducts.length)det.appendChild(renderPricingList(pricingProducts));
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

function updateAll(){ renderTabs(); renderContent(); updateOverall(); syncStickyTop(); paintPricingBatch(); }
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
  gh.ids=await ghDiscover();const merged={},mergedExtras={},legacy={},remoteWrapperArts={},remoteOrdered={},remoteOrderedWrapperArts={};
  let remoteMonitor=null,sawWrapperArts=false,sawOrderedWrapperArts=false;const sawOrdered=new Set();
  await Promise.all(Object.entries(gh.ids).map(async([cl,id])=>{
    try{const r=await fetch(GH_API+"/gists/"+id,{headers:ghH()});if(!r.ok)return;
      const j=await r.json(),f=(j.files||{})[fileFor(cl)];if(!f)return;
      let c=f.content; if(f.truncated&&f.raw_url)c=await (await fetch(f.raw_url)).text();
      const b=JSON.parse(c),m=migrateChecks(b.checks||{});Object.assign(merged,m.checks);
      Object.assign(mergedExtras,b.extras||{});
      const hasOrdered=Object.prototype.hasOwnProperty.call(b,'ordered'),pulledOrdered=normalizeOrdered(b.ordered);
      if(hasOrdered){sawOrdered.add(cl);Object.assign(remoteOrdered,pulledOrdered);}
      Object.assign(legacy,b.legacyChecksV1||{},m.legacy,m.unknown);
      const hasWrapperArts=cl===WRAPPER_ART_GIST_CHECKLIST&&Object.prototype.hasOwnProperty.call(b,'wrapperArts');
      const pulledWrapperArts=hasWrapperArts?normalizeWrapperArts(b.wrapperArts):undefined;
      if(hasWrapperArts){sawWrapperArts=true;Object.assign(remoteWrapperArts,pulledWrapperArts);}
      const hasOrderedWrapperArts=cl===WRAPPER_ART_GIST_CHECKLIST&&Object.prototype.hasOwnProperty.call(b,'orderedWrapperArts');
      const pulledOrderedWrapperArts=hasOrderedWrapperArts?normalizeWrapperArts(b.orderedWrapperArts):undefined;
      if(hasOrderedWrapperArts){sawOrderedWrapperArts=true;Object.assign(remoteOrderedWrapperArts,pulledOrderedWrapperArts);}
      const candidate=monitorPreferenceEnvelope(b);
      if(candidate&&(!remoteMonitor||String(candidate.updatedAt||'')>String(remoteMonitor.updatedAt||'')||
          String(candidate.updatedAt||'')===String(remoteMonitor.updatedAt||'')&&
          JSON.stringify(candidate.preferences)>JSON.stringify(remoteMonitor.preferences)))remoteMonitor=candidate;
      gh.snap[cl]=monitorGistSnapshot(cl,b.checks||{},b.extras||{},candidate?{
        monitorPreferences:candidate.preferences,monitorPreferencesUpdatedAt:candidate.updatedAt}:null,pulledWrapperArts,
        pulledOrdered,pulledOrderedWrapperArts);
      if(m.migrated||Object.keys(m.unknown).length)ghDirty=true;}catch(e){}}));
  let changed=false;
  if(Object.keys(merged).length||Object.keys(mergedExtras).length){
    // First connect on a device: keep BOTH sides (local wins ties) so an existing
    // local checklist can never be wiped by whatever is already in the gists.
    state.checks = firstConnect ? Object.assign({}, merged, state.checks) : merged;
    state.extras = firstConnect ? Object.assign({},mergedExtras,state.extras||{}) : mergedExtras;
    state.legacyChecksV1=Object.assign({},legacy,state.legacyChecksV1||{});
    state=migrateState(state);delete state._needsMigrationSave;changed=true;}
  const beforeOrdered=JSON.stringify(state.ordered||{});
  if(firstConnect)state.ordered=Object.assign({},remoteOrdered,state.ordered||{});
  else{
    const nextOrdered=Object.assign({},remoteOrdered);
    for(const[key,value]of Object.entries(state.ordered||{})){
      const cl=key.split('|')[0];if(!sawOrdered.has(cl)){nextOrdered[key]=value;if(gh.ids[cl])ghDirty=true;}
    }
    state.ordered=nextOrdered;
  }
  if(beforeOrdered!==JSON.stringify(state.ordered||{}))changed=true;
  if(sawWrapperArts){
    const nextWrapperArts=firstConnect?Object.assign({},remoteWrapperArts,state.wrapperArts||{}):remoteWrapperArts;
    if(JSON.stringify(state.wrapperArts||{})!==JSON.stringify(nextWrapperArts))changed=true;
    state.wrapperArts=nextWrapperArts;
  }else if(Object.keys(state.wrapperArts||{}).length){
    // An older packs Gist has no wrapper-art field. Preserve local artwork state
    // and queue a compatible payload instead of interpreting omission as empty.
    ghDirty=true;
  }
  if(sawOrderedWrapperArts){
    const nextOrderedWrapperArts=firstConnect?Object.assign({},remoteOrderedWrapperArts,state.orderedWrapperArts||{}):remoteOrderedWrapperArts;
    if(JSON.stringify(state.orderedWrapperArts||{})!==JSON.stringify(nextOrderedWrapperArts))changed=true;
    state.orderedWrapperArts=nextOrderedWrapperArts;
  }else if(Object.keys(state.orderedWrapperArts||{}).length){
    ghDirty=true;
  }
  if(remoteMonitor){
    const localStamp=state.monitorPreferencesUpdatedAt;
    const useRemote=!firstConnect||!localStamp||!!remoteMonitor.updatedAt&&remoteMonitor.updatedAt>=localStamp;
    if(useRemote){
      const before=JSON.stringify(state.monitorPreferences),beforeStamp=state.monitorPreferencesUpdatedAt;
      state.monitorPreferences=remoteMonitor.preferences;
      state.monitorPreferencesUpdatedAt=remoteMonitor.updatedAt;
      if(before!==JSON.stringify(state.monitorPreferences)||beforeStamp!==state.monitorPreferencesUpdatedAt)changed=true;
    }else ghDirty=true;
  }
  if(changed){save();noteMonitorCollectionChange();}
  gh.last=Date.now(); ghRemember();}

async function ghPush(unloading){if(!gh.token||gh.busy)return;gh.busy=true;
  if(!unloading){const t=document.getElementById('driveTxt'); if(t)t.textContent='Syncing…';}
  try{const groups={};
    for(const[k,v] of Object.entries(state.checks)){if(!v)continue;
      const cl=k.split("|")[0];(groups[cl]=groups[cl]||{})[k]=v;}
    const extraGroups={};
    for(const[k,v]of Object.entries(state.extras||{})){if(Number(v)<=0)continue;
      const cl=k.split("|")[0];(extraGroups[cl]=extraGroups[cl]||{})[k]=Number(v);}
    const orderedGroups={};
    for(const[k,v]of Object.entries(state.ordered||{})){if(Number(v)<=0)continue;
      const cl=k.split("|")[0];(orderedGroups[cl]=orderedGroups[cl]||{})[k]=Number(v);}
    const legacyGroups={};
    for(const[k,v]of Object.entries(state.legacyChecksV1||{})){if(!v)continue;
      const cl=k.split("|")[0];(legacyGroups[cl]=legacyGroups[cl]||{})[k]=v;}
    const localWrapperArts=normalizeWrapperArts(state.wrapperArts),localOrderedWrapperArts=normalizeWrapperArts(state.orderedWrapperArts);
    const clIds=new Set([...Object.keys(gh.ids),...Object.keys(groups),...Object.keys(extraGroups),...Object.keys(orderedGroups),...Object.keys(legacyGroups)]);
    if(Object.keys(localWrapperArts).length)clIds.add(WRAPPER_ART_GIST_CHECKLIST);
    if(Object.keys(localOrderedWrapperArts).length)clIds.add(WRAPPER_ART_GIST_CHECKLIST);
    if(state.monitorPreferencesUpdatedAt)clIds.add(MONITOR_GIST_CHECKLIST);
    for(const cl of clIds){const checks=groups[cl]||{},extras=extraGroups[cl]||{},ordered=orderedGroups[cl]||{},legacy=legacyGroups[cl]||{};
      const monitorFields=cl===MONITOR_GIST_CHECKLIST?monitorGistFields():null;
      const wrapperArts=cl===WRAPPER_ART_GIST_CHECKLIST?localWrapperArts:undefined;
      const orderedWrapperArts=cl===WRAPPER_ART_GIST_CHECKLIST?localOrderedWrapperArts:undefined;
      const snap=monitorGistSnapshot(cl,checks,extras,monitorFields,wrapperArts,ordered,orderedWrapperArts);
      if(gh.snap[cl]===snap&&gh.ids[cl])continue;            // unchanged → skip
      const title=titleFor(cl);
      const payload={checklist:cl,title,keyVersion:2,checks,extras,ordered,legacyChecksV1:legacy,
        updatedAt:new Date().toISOString()};
      if(monitorFields)Object.assign(payload,monitorFields);
      if(wrapperArts!==undefined)payload.wrapperArts=wrapperArts;
      if(orderedWrapperArts!==undefined)payload.orderedWrapperArts=orderedWrapperArts;
      const body={description:"MTG Binder · "+title,
        files:{[fileFor(cl)]:{content:JSON.stringify(payload,null,2)}}};
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

function openMonitoring(){
  const prefs=normalizeMonitorPreferences(state.monitorPreferences);
  document.getElementById('monitorEnabled').checked=prefs.enabled;
  document.getElementById('monitorDiscount').value=String(Math.round((1-prefs.maxMarketRatio)*1000)/10);
  document.getElementById('monitorConfidence').value=prefs.minimumConfidence;
  document.querySelectorAll('[data-monitor-source]').forEach(input=>{input.checked=prefs.sources.includes(input.dataset.monitorSource);});
  document.getElementById('monitorOptional').checked=prefs.includeOptional;
  document.getElementById('monitorInstant').checked=prefs.instantFixedPriceEmail;
  document.getElementById('monitorDigest').checked=prefs.dailyDigest.enabled;
  document.getElementById('monitorDigestTime').value=prefs.dailyDigest.time;
  document.getElementById('monitorTimezone').value=prefs.dailyDigest.timezone;
  paintMonitorSyncStatus();
  document.getElementById('monitorModal').classList.add('show');
}
function saveMonitoringPreferences(){
  const discount=Number(document.getElementById('monitorDiscount').value);
  const sources=Array.from(document.querySelectorAll('[data-monitor-source]:checked')).map(input=>input.dataset.monitorSource);
  if(!Number.isFinite(discount)||discount<0||discount>99){toast('Choose a discount from 0% to 99%');return;}
  if(!sources.length){toast('Choose at least one monitoring source');return;}
  const next=normalizeMonitorPreferences({enabled:document.getElementById('monitorEnabled').checked,
    maxMarketRatio:Math.round((1-discount/100)*10000)/10000,
    minimumConfidence:document.getElementById('monitorConfidence').value,sources,
    includeOptional:document.getElementById('monitorOptional').checked,
    instantFixedPriceEmail:document.getElementById('monitorInstant').checked,
    dailyDigest:{enabled:document.getElementById('monitorDigest').checked,
      time:document.getElementById('monitorDigestTime').value,
      timezone:document.getElementById('monitorTimezone').value}});
  const changed=JSON.stringify(next)!==JSON.stringify(state.monitorPreferences);
  if(changed){state.monitorPreferences=next;state.monitorPreferencesUpdatedAt=new Date().toISOString();
    save();driveTouch();scheduleMonitorStateChanged();}
  document.getElementById('monitorModal').classList.remove('show');
  toast(changed?'Monitoring preferences saved':'Monitoring preferences unchanged');
}

/* ---- photo identification ----
   The dashboard owns capture, catalog mapping, and explicit quantity controls.
   The extension owns the remembered API key and provider call. The model never
   receives collection state and cannot mutate it; returned candidate IDs are
   accepted only when they already exist in RECOGNITION_BY_ID. */
let identifyPreviewUrl='',identifyLastResult=null,identifyBusy=false;
function identifyOwned(candidate){
  if(candidate.kind==='wrapper_art')return wrapperArtQuantity(candidate.art.id);
  return collectionOwnership(candidate.cl,candidate.it,candidate.record).owned;
}
function adjustIdentifiedCandidate(candidate,delta,focusSide){
  if(candidate.kind==='wrapper_art')changeWrapperArtQuantity(candidate.art.id,delta);
  else if(Object.prototype.hasOwnProperty.call(candidate.record,'slotOrdinal'))
    changeSlotQuantity(candidate.cl.id,candidate.it,candidate.record.slotOrdinal,delta);
  else{
    const group=groupedSlots(candidate.it).find(value=>value.n===candidate.record.slotGroup);
    if(!group){toast('This product is not mapped to a quantity control');return;}
    changeQuantity(candidate.cl.id,candidate.it,group,delta);
  }
  renderIdentifyResults(identifyLastResult,candidate.candidateId,focusSide);
}
function identifyReference(candidate){
  if(candidate.imageUrl){
    const img=document.createElement('img');img.src=candidate.imageUrl;img.alt='Reference for '+candidate.public.label;
    img.loading='lazy';img.decoding='async';img.onerror=()=>{const fallback=document.createElement('span');fallback.className='identify-result-fallback';fallback.textContent='Reference unavailable';img.replaceWith(fallback);};
    return img;
  }
  const fallback=document.createElement('span');fallback.className='identify-result-fallback';fallback.textContent='No reference image';return fallback;
}
function renderIdentifyResults(result,focusId,focusSide){
  identifyLastResult=result;
  const host=document.getElementById('identifyResults'),stateEl=document.getElementById('identifyState');host.innerHTML='';
  if(!result||!result.matches||!result.matches.length){
    const observation=result&&result.observation;
    stateEl.textContent=observation&&observation.status==='not_tcg'
      ?'This does not appear to be a sealed TCG product.'
      :'No exact catalog match was confident enough. Try a straight-on photo with the set name, booster type, and full wrapper artwork visible.';
    return;
  }
  const observation=result.observation||{};
  const observed=[observation.setName,observation.boosterType,observation.variantName].filter(Boolean).join(' · ');
  stateEl.textContent=(result.status==='matched'?'Identified':'Possible matches')+(observed?' · '+observed:'')+'. Verify the reference, then use − or + to change your quantity.';
  result.matches.forEach((match,index)=>{
    const candidate=RECOGNITION_BY_ID.get(match.candidateId);if(!candidate)return;
    const owned=identifyOwned(candidate),card=document.createElement('div');card.className='identify-result'+(index===0?' best':'');
    card.appendChild(identifyReference(candidate));
    const copy=document.createElement('div');copy.className='identify-result-copy';
    const label=document.createElement('b');label.textContent=candidate.public.label;
    const confidence=document.createElement('span');confidence.className='identify-confidence';confidence.textContent=match.confidence+'% confidence'+(index===0?' · best match':'');
    const reason=document.createElement('span');reason.textContent=String(match.reason||'Catalog-constrained visual match').slice(0,240);
    copy.appendChild(label);copy.appendChild(confidence);copy.appendChild(reason);
    if(candidate.kind==='wrapper_art'){
      const evidence=document.createElement('span'),status=wrapperArtStatusLabel(candidate.art);
      evidence.textContent=candidate.art.id+' · '+status.text;evidence.className='wrapperart-status '+status.kind;copy.appendChild(evidence);
    }
    const ctrl=document.createElement('div');ctrl.className='variantqty';ctrl.dataset.identifyCandidate=candidate.candidateId;
    const minus=document.createElement('button');minus.type='button';minus.className='variantqtybtn minus';minus.textContent='−';minus.disabled=owned===0;
    minus.setAttribute('aria-label','Remove one '+candidate.public.label);minus.onclick=()=>adjustIdentifiedCandidate(candidate,-1,'minus');
    const num=document.createElement('span');num.className='variantqtynum'+(owned>0?' met':'');num.textContent=owned;num.setAttribute('aria-label',owned+' owned of '+candidate.public.label);
    const plus=document.createElement('button');plus.type='button';plus.className='variantqtybtn plus';plus.textContent='+';
    plus.setAttribute('aria-label','Add one '+candidate.public.label);plus.onclick=()=>adjustIdentifiedCandidate(candidate,1,'plus');
    ctrl.appendChild(minus);ctrl.appendChild(num);ctrl.appendChild(plus);
    card.appendChild(copy);card.appendChild(ctrl);host.appendChild(card);
  });
  if(focusId&&focusSide){
    const ctrl=host.querySelector('[data-identify-candidate="'+CSS.escape(focusId)+'"]');
    const target=ctrl&&(ctrl.querySelector('.'+focusSide+':not(:disabled)')||ctrl.querySelector('.variantqtynum'));
    if(target)try{target.focus({preventScroll:true});}catch(e){target.focus();}
  }
}
function imageBlobData(blob){
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(new Error('Could not read the resized photo.'));reader.readAsDataURL(blob);});
}
async function prepareIdentifyImage(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG, or WebP photo.');
  if(file.size>20*1024*1024)throw new Error('Choose a photo smaller than 20 MB.');
  let bitmap;
  try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch(e){bitmap=await createImageBitmap(file);}
  const maxDimension=1600,scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height));
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{alpha:false});context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);bitmap.close&&bitmap.close();
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not resize the photo.')),'image/jpeg',.86));
  if(identifyPreviewUrl)URL.revokeObjectURL(identifyPreviewUrl);identifyPreviewUrl=URL.createObjectURL(blob);
  document.getElementById('identifyPreview').src=identifyPreviewUrl;
  return {mimeType:'image/jpeg',dataBase64:await imageBlobData(blob),width,height};
}
async function identifyFile(file){
  const modal=document.getElementById('identifyModal'),another=document.getElementById('identifyAnother');
  modal.classList.add('show');identifyBusy=true;another.disabled=true;identifyLastResult=null;
  document.getElementById('identifyResults').innerHTML='';document.getElementById('identifyState').textContent='Preparing and analyzing the photo…';
  try{const image=await prepareIdentifyImage(file),result=await identifyRequest(image);renderIdentifyResults(result);}
  catch(error){document.getElementById('identifyState').textContent=String(error&&error.message||error||'Photo identification failed.');}
  finally{identifyBusy=false;another.disabled=false;}
}
function closeIdentify(){document.getElementById('identifyModal').classList.remove('show');}

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
wireMenu('priceRefreshBtn','priceRefreshMenu',true);
document.addEventListener('click',closeMenus);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeMenus(); });

on('syncItem','click',openSync);
on('monitorItem','click',openMonitoring);
on('refreshUnfinishedPrices','click',()=>startPricingRefresh('unfinished'));
on('refreshAllPrices','click',()=>startPricingRefresh('all'));
/* #closeModal is created by openSync(), which binds it there. Nothing to do here. */
on('driveModal','click',(e)=>{ if(e.target.id==='driveModal')e.target.classList.remove('show'); });
on('monitorModal','click',(e)=>{ if(e.target.id==='monitorModal')e.target.classList.remove('show'); });
on('monitorClose','click',()=>document.getElementById('monitorModal').classList.remove('show'));
on('monitorSave','click',saveMonitoringPreferences);
on('identifyBtn','click',()=>{if(!pricingConsumerOrigin){toast('Open the dashboard inside the Tracker extension to identify photos');return;}document.getElementById('identifyFile').click();});
on('identifyAnother','click',()=>{if(!identifyBusy)document.getElementById('identifyFile').click();});
on('identifyClose','click',closeIdentify);
on('identifyModal','click',(e)=>{if(e.target.id==='identifyModal'&&!identifyBusy)closeIdentify();});
on('identifyFile','change',(e)=>{const file=e.target.files&&e.target.files[0];e.target.value='';if(file)identifyFile(file);});
on('drivePill','click',openSync);
document.getElementById('exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='mtg-binder-progress.json'; a.click(); toast('Exported progress file');
};
document.getElementById('importBtn').onclick=()=>document.getElementById('fileIn').click();
document.getElementById('fileIn').onchange=(e)=>{
  const f=e.target.files[0]; if(!f)return; const r=new FileReader();
  r.onload=()=>{ try{ const s=JSON.parse(r.result); if(s.checks){state=migrateState(s);delete state._needsMigrationSave;save();noteMonitorCollectionChange(); active=state.ui.active||active; /* Startup is deliberately fault-isolated: a failure in rendering must not stop
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
paintMonitorSyncStatus();
ghBoot();
</script>
</body>
</html>"""

import datetime
BUILD = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
out = (HTML.replace("/*__DATA__*/", DATA)
       .replace("/*__WRAPPER_ART__*/", WRAPPER_ART)
       .replace("__BUILD__", BUILD))
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
