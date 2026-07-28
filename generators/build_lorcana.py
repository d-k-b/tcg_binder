# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, Flowable, KeepTogether)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

PURPLE = colors.HexColor("#3a2d6b")
LPURPLE = colors.HexColor("#6a4fb0")
HEADBG = colors.HexColor("#ece8f7")
ROWALT = colors.HexColor("#faf9fd")
GRID = colors.HexColor("#e4e0ef")
GREY = colors.HexColor("#666666")
K1 = colors.HexColor("#1d9e75")   # kid 1 — teal
K2 = colors.HexColor("#9c3d54")   # kid 2 — magenta
AMBER_HEX = "#b5852a"             # estimated market
INK_HEX   = "#1f1b32"             # verified market
MSRP_HEX  = "#b0b0b0"             # MSRP, deliberately faint

styles = getSampleStyleSheet()
cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=8.4, leading=10)
cell_b = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
cell_code = ParagraphStyle("code", parent=cell, textColor=GREY, fontSize=7.4)
cell_date = ParagraphStyle("date", parent=cell, textColor=GREY, fontSize=7.6)
cell_note = ParagraphStyle("note", parent=cell, fontSize=7.4, textColor=colors.HexColor("#555555"), leading=9)
val_st  = ParagraphStyle("val", parent=cell, alignment=2, fontSize=8.4)
dash_st = ParagraphStyle("dash", parent=cell, alignment=1, textColor=colors.HexColor("#c8c8c8"))
era_st = ParagraphStyle("era", parent=styles["Normal"], fontSize=10.5, textColor=colors.white, fontName="Helvetica-Bold", leading=12)
era_cnt = ParagraphStyle("erac", parent=era_st, alignment=2, fontSize=9)
hdr_cell = ParagraphStyle("hc", parent=styles["Normal"], fontSize=6.6, fontName="Helvetica-Bold", textColor=PURPLE, alignment=1)
hdr_l = ParagraphStyle("hl", parent=hdr_cell, alignment=0)
hdr_r = ParagraphStyle("hr", parent=hdr_cell, alignment=2)
note_box_st = ParagraphStyle("nb", parent=styles["Normal"], fontSize=7.5, leading=10.2, textColor=colors.HexColor("#333333"))
foot_st = ParagraphStyle("foot", parent=styles["Normal"], fontSize=6.6, textColor=colors.HexColor("#888888"), leading=9)

class KidPair(Flowable):
    """Two checkboxes: left = Kid 1 (teal), right = Kid 2 (magenta)."""
    def __init__(self, size=10, gap=5):
        super().__init__(); self.size=size; self.gap=gap
        self.width=size*2+gap; self.height=size
    def draw(self):
        c=self.canv; c.setLineWidth(1.3)
        c.setStrokeColor(K1); c.roundRect(0,0,self.size,self.size,1.6,stroke=1,fill=0)
        c.setStrokeColor(K2); c.roundRect(self.size+self.gap,0,self.size,self.size,1.6,stroke=1,fill=0)

# (name, code, date, msrp_box, mkt_box, est_box, msrp_pre, mkt_pre, est_pre, has_coll, note)
#   mkt_* may be an int or "TBA";  pre fields are None when the set had no prerelease box.
#   has_coll = set has a Collector Booster box (Lorcana's first arrives with Into the Inkdark).
#   Booster box MSRP ~$144 (24 packs x $5.99);  Prerelease box MSRP $39.99.
ERAS = [
("2023 — Launch", [
 ("The First Chapter","S1","Aug 2023",144,398,False,None,None,False,False,"Launch premium (PriceCharting comp)"),
 ("Rise of the Floodborn","S2","Nov 2023",144,135,True,None,None,False,False,"eBay listings ~$139"),
]),
("2024", [
 ("Into the Inklands","S3","Feb 2024",144,100,True,None,None,False,False,"Older/reprinted; widely available"),
 ("Ursula's Return","S4","May 2024",144,100,True,None,None,False,False,"Older/reprinted; widely available"),
 ("Shimmering Skies","S5","Aug 2024",144,115,True,None,None,False,False,"UNVERIFIED — spot-check"),
 ("Azurite Sea","S6","Nov 2024",144,120,True,None,None,False,False,"UNVERIFIED — spot-check"),
]),
("2025", [
 ("Archazia's Island","S7","Mar 2025",144,110,True,None,None,False,False,"Seen at retail ~$110"),
 ("Reign of Jafar","S8","May 2025",144,135,True,None,None,False,False,"UNVERIFIED — spot-check"),
 ("Fabled","S9","Aug 2025",144,1200,False,None,None,False,False,"Spiked hard — live eBay floor"),
 ("Whispers in the Well","S10","Nov 2025",144,200,False,None,None,False,False,"eBay market, Jul 2026"),
]),
("2026–2027   (prerelease boxes from Wilds Unknown · collector boxes from Into the Inkdark)", [
 ("Winterspell","S11","Feb 2026",144,215,False,None,None,False,False,"eBay market, Jul 2026"),
 ("Wilds Unknown","S12","May 2026",144,270,False,40,50,True,False,"First-ever Lorcana prerelease box"),
 ("Attack of the Vine!","S13","Jul 2026",144,150,True,40,40,True,False,"Wide release Jul 24, 2026"),
 ("Hyperia City","S14","Oct 2026",144,"TBA",True,40,"TBA",True,False,"Coco set — releases Oct 23, 2026"),
 ("Into the Inkdark","S15","Q1 2027",144,"TBA",True,40,"TBA",True,True,"1st Lorcana Collector Booster box"),
]),
]

PAGE_W, PAGE_H = landscape(letter)
LM=RM=34; TM=22; BM=20; H1=96
USABLE = PAGE_W-LM-RM
# set, #, released, BOX(cb), BOX value, PRERELEASE(cb), PRE value, COLLECTOR(cb), note
cols = [USABLE*0.190, USABLE*0.036, USABLE*0.070, USABLE*0.066, USABLE*0.106,
        USABLE*0.080, USABLE*0.098, USABLE*0.082, USABLE*0.272]

def frames(top_y):
    return [Frame(LM, BM, USABLE, top_y-BM, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)]

def _mkt_num(v): return v if isinstance(v,int) else 0
NITEMS  = sum(len(rows) for _,rows in ERAS)
NPRE    = sum(1 for _,rows in ERAS for r in rows if r[6] is not None)
NCOLL   = sum(1 for _,rows in ERAS for r in rows if r[9])
NBOXES  = NITEMS*2 + NPRE*2 + NCOLL*2
TOTMKT  = 2*sum(_mkt_num(r[4]) for _,rows in ERAS for r in rows) \
        + 2*sum(_mkt_num(r[7]) for _,rows in ERAS for r in rows if r[6] is not None)

def valcell(msrp, mkt, est):
    if msrp is None: return Paragraph("—", dash_st)
    if mkt == "TBA":
        m = '<i><font color="#9a9a9a">TBA</font></i>'
    else:
        m = '<b><font color="%s">$%s</font></b>' % (AMBER_HEX if est else INK_HEX, format(mkt, ","))
    return Paragraph('<font color="%s" size="7">$%s</font>  /  %s' % (MSRP_HEX, format(msrp, ","), m), val_st)

def draw_header(canvas, doc):
    canvas.saveState(); cx=PAGE_W/2.0; y=PAGE_H-TM-13
    canvas.setFillColor(PURPLE); canvas.setFont("Helvetica-Bold",17)
    canvas.drawCentredString(cx,y,"Disney Lorcana  —  Collecting Checklist  (one of each per kid)")
    canvas.setFillColor(GREY); canvas.setFont("Helvetica",8.5)
    canvas.drawCentredString(cx,y-14,"A booster box and (where it exists) a prerelease box for each of 2 kids.  Values shown as  MSRP / market  — market is the number that matters.")
    sy=y-34
    stats=[(str(NBOXES),"BOXES TO BUY"),("~$%s"%format(TOTMKT,","),"AT MARKET (APPROX.)"),("2023–2027","SETS SPAN")]
    sx=[cx-210,cx,cx+210]
    for (n,l),x in zip(stats,sx):
        canvas.setFillColor(LPURPLE); canvas.setFont("Helvetica-Bold",14); canvas.drawCentredString(x,sy,n)
        canvas.setFillColor(GREY); canvas.setFont("Helvetica",6.6); canvas.drawCentredString(x,sy-10,l)
    ly=sy-27; canvas.setFont("Helvetica",7)
    canvas.setStrokeColor(K1); canvas.setLineWidth(1.2); canvas.roundRect(cx-268,ly-1,7,7,1.5,stroke=1,fill=0)
    canvas.setFillColor(GREY); canvas.drawString(cx-257,ly,"= Kid 1")
    canvas.setStrokeColor(K2); canvas.roundRect(cx-215,ly-1,7,7,1.5,stroke=1,fill=0)
    canvas.drawString(cx-204,ly,"= Kid 2  (left box / right box in each column)")
    canvas.setFillColor(GREY)
    canvas.drawString(cx-10,ly,"•  value =  MSRP (faint)  /  market (bold).   Bold black = real comp,  amber = estimate.")
    canvas.setStrokeColor(PURPLE); canvas.setLineWidth(1.5); canvas.line(LM,PAGE_H-TM-H1+6,PAGE_W-RM,PAGE_H-TM-H1+6)
    canvas.restoreState()

def era_block(name, rows):
    n = len(rows)*2 + sum(2 for r in rows if r[6] is not None) + sum(2 for r in rows if r[9])
    eh=Table([[Paragraph(name,era_st),Paragraph("%d boxes"%n,era_cnt)]],colWidths=[USABLE*0.8,USABLE*0.2])
    eh.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PURPLE),("TOPPADDING",(0,0),(-1,-1),4),
        ("BOTTOMPADDING",(0,0),(-1,-1),4),("LEFTPADDING",(0,0),(0,0),8),("RIGHTPADDING",(1,0),(1,0),8),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    head=[Paragraph("SET",hdr_l),Paragraph("#",hdr_cell),Paragraph("RELEASED",hdr_l),
          Paragraph("BOX",hdr_cell),Paragraph("MSRP / MARKET",hdr_r),
          Paragraph("PRERELEASE",hdr_cell),Paragraph("MSRP / MARKET",hdr_r),
          Paragraph("COLLECTOR",hdr_cell),Paragraph("NOTE",hdr_l)]
    data=[head]
    for (s,code,dt,mb,kb,eb,mp,kp,ep,hc,note) in rows:
        data.append([Paragraph(s,cell_b),Paragraph(code,cell_code),Paragraph(dt,cell_date),
                     KidPair(), valcell(mb,kb,eb),
                     KidPair() if mp is not None else Paragraph("—",dash_st),
                     valcell(mp,kp,ep),
                     KidPair() if hc else Paragraph("—",dash_st),
                     Paragraph(note,cell_note)])
    t=Table(data,colWidths=cols,repeatRows=1)
    ts=[("BACKGROUND",(0,0),(-1,0),HEADBG),("LINEBELOW",(0,0),(-1,0),1,colors.HexColor("#c9bfe8")),
        ("LINEBELOW",(0,1),(-1,-1),0.5,GRID),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("ALIGN",(3,0),(3,-1),"CENTER"),("ALIGN",(5,0),(5,-1),"CENTER"),("ALIGN",(7,0),(7,-1),"CENTER"),
        ("TOPPADDING",(0,0),(-1,-1),3.4),("BOTTOMPADDING",(0,0),(-1,-1),3.4),
        ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6)]
    for i in range(1,len(data)):
        if i%2==0: ts.append(("BACKGROUND",(0,i),(-1,i),ROWALT))
    t.setStyle(TableStyle(ts))
    return KeepTogether([eh,t,Spacer(1,5)])

doc=BaseDocTemplate("lorcana_booster_box_checklist.pdf",pagesize=landscape(letter),
                    leftMargin=LM,rightMargin=RM,topMargin=TM,bottomMargin=BM,title="Disney Lorcana Collecting Checklist")
doc.addPageTemplates([PageTemplate(id="first",frames=frames(PAGE_H-TM-H1),onPage=draw_header)])
story=[]
for name,rows in ERAS: story.append(era_block(name,rows))

notes=("<b>How to use this.</b> Each column holds two boxes &mdash; <b>left = Kid 1</b> (teal), <b>right = Kid 2</b> (magenta). "
 "Tick as you buy. Values read <b>MSRP / market</b>: the faint number is what it <i>should</i> cost, the bold one is what it "
 "<i>actually</i> costs right now &mdash; buy on the bold number. "
 "&bull; <b>Prerelease boxes only exist from Wilds Unknown (Set 12, Q2 2026) on</b> ($39.99 MSRP). Sets 1&ndash;11 had prerelease "
 "<i>events</i> but no retail box, so those cells are dashed. "
 "&bull; <b>Collector Boosters are brand new to Lorcana.</b> Ravensburger has confirmed them starting with <b>Into the Inkdark</b> "
 "(Set 15, Q1 2027) &mdash; a listing briefly appeared then was pulled, so contents and price aren't public yet. Sets 1&ndash;14 never "
 "had one, hence the dashes; the column is here so it fills in as more sets get them. "
 "&bull; <b>Market runs far above MSRP.</b> Recent sets list ~$144 but trade $200&ndash;270; <b>Fabled</b> is the extreme at ~$1,200 "
 "against a $144 MSRP. Bold black = a real comp (First Chapter, Fabled, Whispers, Winterspell, Wilds Unknown); amber = estimate. "
 "Three are flagged <b>UNVERIFIED</b> (Shimmering Skies, Azurite Sea, Reign of Jafar) &mdash; spot-check before buying. "
 "&bull; Prices move fast, so confirm the live eBay number at purchase. Boxes = 24 packs.")
nb=Table([[Paragraph(notes,note_box_st)]],colWidths=[USABLE])
nb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f5f2fc")),("BOX",(0,0),(-1,-1),0.6,colors.HexColor("#d9cff0")),
    ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),9)]))
story.append(KeepTogether([nb,Spacer(1,5),
    Paragraph("Compiled July 2026 &bull; %d sets &bull; %d boxes (2 per item) &bull; market values from eBay / PriceCharting. "
              "Disney Lorcana is &copy; Disney / Ravensburger. Unofficial fan reference."%(NITEMS,NBOXES),foot_st)]))
doc.build(story)
print("built; items=",NITEMS,"prerelease=",NPRE,"boxes=",NBOXES,"market total=",TOTMKT)
