#!/usr/bin/env node
// ESM-701: writes the hand-made test files for checking Miro, Lucidchart and
// LibreOffice imports before the real export is built. See
// docs/plans/export-to-external-tools.md#1-check-that-miro-and-lucidchart-import-a-test-file
//
//   node scripts/make-export-test-files.mjs [output folder]
//
// Writes story-map-test.vsdx and story-map-test.csv. Defaults to
// test/fixtures/export-spike. This is a throwaway spike: the real export (ESM-702)
// is built from the internal view in src/.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "test/fixtures/export-spike";

// ---------------------------------------------------------------------------
// Test content. Covers everything item 1 asks for: two activities, two lanes
// (one collapsed), four cards, release notes with a drafted impact item, shape
// data, an overflowing title, and text with &, < and an emoji.

const activities = [
  { id: "plan", title: "Plan the map" },
  { id: "explore", title: "Explore & share the board" },
];

const releases = [
  {
    id: "export",
    title: "Export to external tools",
    counts: "4 stories · 1 shipped, 2 in progress, 1 planned",
    notes: "A one-way snapshot of the board for workshops held in other tools. The YAML file stays the source of truth.",
    impact: [{ metric: "Time to get the map into Miro", expected: "One download and an import", draft: true }],
    collapsed: false,
  },
  {
    id: "v0-5",
    title: "0.5.0: Collapsible releases",
    counts: "3 stories",
    collapsed: true,
  },
];

const stories = [
  { id: "ESM-701", title: "Check that Miro and Lucidchart import a test file", activity: "plan", release: "export", status: "in-progress" },
  {
    id: "ESM-702",
    title: "Export the internal map as a Visio file, with collapsed lanes, release notes, expected impact and at most two hundred of the most recently changed stories",
    activity: "plan",
    release: "export",
    status: "planned",
  },
  { id: "ESM-703", title: "Escape <tags> & “quotes” in titles 🚀", activity: "explore", release: "export", status: "in-progress" },
  { id: "ESM-704", title: "Download the export from the board", activity: "explore", release: "export", status: "shipped" },
];

const mapTitle = "Story map export test (ESM-701)";

// ---------------------------------------------------------------------------
// Layout, in inches from the top left. Flipped to Visio's bottom-left origin
// when the shapes are written.

const margin = 0.5;
const laneHeaderWidth = 3.2;
const columnWidth = 2.6;
const cardWidth = 2.3;
const cardHeight = 0.9;
const cardGap = 0.2;
const titleHeight = 0.6;
const activityHeight = 0.6;
const collapsedLaneHeight = 0.6;
const lanePadding = 0.2;

const shapes = [];
let nextId = 1;

function addShape(shape) {
  shapes.push({ id: nextId++, ...shape });
}

let y = margin;
addShape({ name: "Map title", x: margin, y, w: laneHeaderWidth + columnWidth * activities.length, h: titleHeight, text: [{ text: mapTitle, size: 16, bold: true }], fill: null, line: null });
y += titleHeight + 0.1;

// Activity headers across the top.
activities.forEach((activity, i) => {
  addShape({
    name: `Activity ${activity.id}`,
    x: margin + laneHeaderWidth + i * columnWidth,
    y,
    w: columnWidth - 0.1,
    h: activityHeight,
    text: [{ text: activity.title, size: 11, bold: true }],
    fill: "#1F3A5F",
    line: null,
    color: "#FFFFFF",
    align: "center",
    valign: "middle",
    data: { Activity: activity.id },
  });
});
y += activityHeight + 0.1;

for (const release of releases) {
  const laneStories = stories.filter(story => story.release === release.id);
  const tallestCell = Math.max(0, ...activities.map(a => laneStories.filter(s => s.activity === a.id).length));
  const cardsHeight = tallestCell * cardHeight + Math.max(0, tallestCell - 1) * cardGap;
  const laneHeight = release.collapsed ? collapsedLaneHeight : Math.max(2.6, cardsHeight + lanePadding * 2);
  const laneWidth = laneHeaderWidth + columnWidth * activities.length;

  // Lane background first, so it sits beneath its cards.
  addShape({
    name: `Release ${release.id}`,
    x: margin,
    y,
    w: laneWidth,
    h: laneHeight,
    text: [],
    fill: release.collapsed ? "#EEF0F3" : "#F6F7F9",
    line: "#C9CED6",
    data: { Release: release.id, Collapsed: release.collapsed ? "Yes" : "No" },
  });

  const header = release.collapsed
    ? [{ text: release.title, size: 11, bold: true }, { text: `Collapsed · ${release.counts}`, size: 9, color: "#5B6573" }]
    : [
      { text: release.title, size: 11, bold: true },
      { text: release.counts, size: 9, color: "#5B6573" },
      { text: release.notes, size: 9 },
      ...release.impact.map(item => ({ text: `${item.draft ? "Draft · " : ""}${item.metric}: ${item.expected}`, size: 9, italic: true })),
    ];
  addShape({
    name: `Release header ${release.id}`,
    x: margin + 0.1,
    y: y + 0.05,
    w: laneHeaderWidth - 0.2,
    h: laneHeight - 0.1,
    text: header,
    fill: null,
    line: null,
    valign: release.collapsed ? "middle" : "top",
  });

  if (!release.collapsed) {
    activities.forEach((activity, i) => {
      laneStories.filter(s => s.activity === activity.id).forEach((story, row) => {
        addShape({
          name: `Story ${story.id}`,
          x: margin + laneHeaderWidth + i * columnWidth + (columnWidth - 0.1 - cardWidth) / 2,
          y: y + lanePadding + row * (cardHeight + cardGap),
          w: cardWidth,
          h: cardHeight,
          text: [{ text: story.id, size: 8, color: "#5B6573" }, { text: story.title, size: 10 }],
          fill: "#FFFFFF",
          line: "#9AA3AF",
          valign: "top",
          data: { ID: story.id, Title: story.title, Status: story.status, Activity: story.activity, Release: story.release },
        });
      });
    });
  }
  y += laneHeight + 0.1;
}

const pageWidth = margin * 2 + laneHeaderWidth + columnWidth * activities.length;
const pageHeight = y + margin - 0.1;

// ---------------------------------------------------------------------------
// Visio XML.

const ns = "http://schemas.microsoft.com/office/visio/2012/main";
const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function esc(value) {
  return String(value)
    // Drop characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = n => String(Math.round(n * 10000) / 10000);
const cell = (name, value, formula, unit) =>
  `<Cell N="${name}" V="${esc(value)}"${unit ? ` U="${unit}"` : ""}${formula ? ` F="${esc(formula)}"` : ""}/>`;
const pt = size => num(size / 72); // Character size is stored in inches.

function shapeXml(s) {
  const pinX = s.x + s.w / 2;
  const pinY = pageHeight - (s.y + s.h / 2); // Flip y: Visio's origin is bottom left.
  const parts = [
    `<Shape ID="${s.id}" NameU="${esc(s.name)}" Name="${esc(s.name)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">`,
    cell("PinX", num(pinX)),
    cell("PinY", num(pinY)),
    cell("Width", num(s.w)),
    cell("Height", num(s.h)),
    cell("LocPinX", num(s.w / 2), "Width*0.5"),
    cell("LocPinY", num(s.h / 2), "Height*0.5"),
    cell("Angle", "0"),
    cell("FlipX", "0"),
    cell("FlipY", "0"),
    cell("ResizeMode", "0"),
    // Fill and line. Pattern 0 means none.
    cell("FillForegnd", s.fill ?? "#FFFFFF"),
    cell("FillBkgnd", s.fill ?? "#FFFFFF"),
    cell("FillPattern", s.fill ? "1" : "0"),
    cell("LineColor", s.line ?? "#000000"),
    cell("LineWeight", num(1 / 72)),
    cell("LinePattern", s.line ? "1" : "0"),
    cell("Rounding", "0"),
    // Text block covers the whole shape.
    cell("TxtPinX", num(s.w / 2), "Width*0.5"),
    cell("TxtPinY", num(s.h / 2), "Height*0.5"),
    cell("TxtWidth", num(s.w), "Width*1"),
    cell("TxtHeight", num(s.h), "Height*1"),
    cell("TxtLocPinX", num(s.w / 2), "TxtWidth*0.5"),
    cell("TxtLocPinY", num(s.h / 2), "TxtHeight*0.5"),
    cell("TxtAngle", "0"),
    cell("LeftMargin", num(0.08)),
    cell("RightMargin", num(0.08)),
    cell("TopMargin", num(0.06)),
    cell("BottomMargin", num(0.06)),
    // 0 top, 1 middle, 2 bottom.
    cell("VerticalAlign", { top: "0", middle: "1", bottom: "2" }[s.valign ?? "top"]),
  ];

  if (s.text.length) {
    parts.push('<Section N="Character">');
    s.text.forEach((run, i) => {
      // Style bits: 1 bold, 2 italic.
      const style = (run.bold ? 1 : 0) | (run.italic ? 2 : 0);
      parts.push(`<Row IX="${i}">${cell("Font", "Calibri")}${cell("Color", run.color ?? s.color ?? "#1B1F24")}${cell("Size", pt(run.size), null, "PT")}${cell("Style", style)}</Row>`);
    });
    parts.push("</Section>");
    // 0 left, 1 centre.
    parts.push(`<Section N="Paragraph"><Row IX="0">${cell("HorzAlign", s.align === "center" ? "1" : "0")}${cell("SpAfter", num(2 / 72), null, "PT")}</Row></Section>`);
  }

  if (s.data) {
    parts.push('<Section N="Property">');
    for (const [key, value] of Object.entries(s.data)) {
      parts.push(`<Row N="${esc(key)}">${cell("Value", value, null, "STR")}${cell("Label", key)}${cell("Type", "0")}</Row>`);
    }
    parts.push("</Section>");
  }

  // A rectangle in absolute coordinates, with formulas so it resizes in Visio.
  parts.push(
    '<Section N="Geometry" IX="0">',
    cell("NoFill", s.fill ? "0" : "1"),
    cell("NoLine", s.line ? "0" : "1"),
    cell("NoShow", "0"),
    cell("NoSnap", "0"),
    `<Row T="MoveTo" IX="1">${cell("X", "0", "Width*0")}${cell("Y", "0", "Height*0")}</Row>`,
    `<Row T="LineTo" IX="2">${cell("X", num(s.w), "Width*1")}${cell("Y", "0", "Height*0")}</Row>`,
    `<Row T="LineTo" IX="3">${cell("X", num(s.w), "Width*1")}${cell("Y", num(s.h), "Height*1")}</Row>`,
    `<Row T="LineTo" IX="4">${cell("X", "0", "Width*0")}${cell("Y", num(s.h), "Height*1")}</Row>`,
    `<Row T="LineTo" IX="5">${cell("X", "0", "Geometry1.X1")}${cell("Y", "0", "Geometry1.Y1")}</Row>`,
    "</Section>",
  );

  if (s.text.length) {
    // <cp IX="n"/> switches to character row n. A line feed ends a paragraph.
    const text = s.text.map((run, i) => `<cp IX="${i}"/>${esc(run.text)}`).join("\n");
    parts.push(`<Text>${text}</Text>`);
  }
  parts.push("</Shape>");
  return parts.join("");
}

const now = "2026-11-20T00:00:00Z";

const parts = {
  "[Content_Types].xml": `${xmlHead}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>'
    + '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>'
    + '<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>'
    + '<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + "</Types>",

  "_rels/.rels": `${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    + "</Relationships>",

  "docProps/app.xml": `${xmlHead}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
    + "<Application>Embedded Story Map</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>"
    + "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>"
    + "<AppVersion>16.0000</AppVersion></Properties>",

  "docProps/core.xml": `${xmlHead}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(mapTitle)}</dc:title><dc:creator>Embedded Story Map</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
    + "</cp:coreProperties>",

  "visio/document.xml": `${xmlHead}<VisioDocument xmlns="${ns}" xmlns:r="${relNs}" xml:space="preserve">`
    + '<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">'
    + cell("GlueSettings", "9") + cell("SnapSettings", "295") + cell("SnapExtensions", "34") + cell("DynamicGridEnabled", "0")
    + cell("ProtectStyles", "0") + cell("ProtectShapes", "0") + cell("ProtectMasters", "0") + cell("ProtectBkgnds", "0")
    + "</DocumentSettings>"
    + '<Colors><ColorEntry IX="0" RGB="#000000"/><ColorEntry IX="1" RGB="#FFFFFF"/></Colors>'
    + '<FaceNames><FaceName NameU="Calibri" UnicodeRanges="-536859905 -1073732485 9 0" CharSets="536871423 0" Panose="2 15 5 2 2 2 4 3 2 4" Flags="325"/></FaceNames>'
    + '<StyleSheets><StyleSheet ID="0" NameU="No Style" IsCustomNameU="1" Name="No Style" IsCustomName="1">'
    + cell("EnableLineProps", "1") + cell("EnableFillProps", "1") + cell("EnableTextProps", "1") + cell("HideForApply", "0")
    + cell("LineWeight", num(1 / 72)) + cell("LineColor", "#000000") + cell("LinePattern", "1") + cell("Rounding", "0")
    + cell("EndArrowSize", "2") + cell("BeginArrow", "0") + cell("EndArrow", "0") + cell("LineCap", "0") + cell("BeginArrowSize", "2")
    + cell("LineColorTrans", "0") + cell("CompoundType", "0")
    + cell("FillForegnd", "#FFFFFF") + cell("FillBkgnd", "#FFFFFF") + cell("FillPattern", "1")
    + cell("ShdwForegnd", "#000000") + cell("ShdwPattern", "0") + cell("FillForegndTrans", "0") + cell("FillBkgndTrans", "0")
    + cell("ShdwForegndTrans", "0") + cell("ShapeShdwType", "0") + cell("ShapeShdwOffsetX", "0") + cell("ShapeShdwOffsetY", "0")
    + cell("ShapeShdwObliqueAngle", "0") + cell("ShapeShdwScaleFactor", "1") + cell("ShapeShdwBlur", "0") + cell("ShapeShdwShow", "0")
    + cell("LeftMargin", "0") + cell("RightMargin", "0") + cell("TopMargin", "0") + cell("BottomMargin", "0")
    + cell("VerticalAlign", "1") + cell("TextBkgnd", "0") + cell("DefaultTabStop", "0.5") + cell("TextDirection", "0")
    + cell("TextBkgndTrans", "0")
    + `<Section N="Character"><Row IX="0">${cell("Font", "Calibri")}${cell("Color", "#000000")}${cell("Style", "0")}${cell("Case", "0")}${cell("Pos", "0")}${cell("FontScale", "1")}${cell("Size", pt(10), null, "PT")}${cell("DblUnderline", "0")}${cell("Overline", "0")}${cell("Strikethru", "0")}${cell("DoubleStrikethrough", "0")}${cell("Letterspace", "0")}${cell("ColorTrans", "0")}</Row></Section>`
    + `<Section N="Paragraph"><Row IX="0">${cell("IndFirst", "0")}${cell("IndLeft", "0")}${cell("IndRight", "0")}${cell("SpLine", "-1.2")}${cell("SpBefore", "0")}${cell("SpAfter", "0")}${cell("HorzAlign", "1")}${cell("Bullet", "0")}${cell("BulletStr", "")}${cell("TextPosAfterBullet", "0")}</Row></Section>`
    + "</StyleSheet></StyleSheets>"
    + "</VisioDocument>",

  "visio/_rels/document.xml.rels": `${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>'
    + "</Relationships>",

  "visio/windows.xml": `${xmlHead}<Windows ClientWidth="1600" ClientHeight="900" xmlns="${ns}" xmlns:r="${relNs}" xml:space="preserve">`
    + `<Window ID="0" WindowType="Drawing" WindowState="1073741824" ClientWidth="1600" ClientHeight="900" Page="0" ViewScale="-1" ViewCenterX="${num(pageWidth / 2)}" ViewCenterY="${num(pageHeight / 2)}">`
    + '<ShowRulers>1</ShowRulers><ShowGrid>0</ShowGrid><ShowPageBreaks>0</ShowPageBreaks><ShowGuides>1</ShowGuides><ShowConnectionPoints>0</ShowConnectionPoints>'
    + "</Window></Windows>",

  "visio/pages/pages.xml": `${xmlHead}<Pages xmlns="${ns}" xmlns:r="${relNs}" xml:space="preserve">`
    + '<Page ID="0" NameU="Story map" Name="Story map" ViewScale="-1">'
    + '<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">'
    + cell("PageWidth", num(pageWidth), null, "IN") + cell("PageHeight", num(pageHeight), null, "IN")
    + cell("ShdwOffsetX", "0.125") + cell("ShdwOffsetY", "-0.125")
    + cell("PageScale", "1", null, "IN") + cell("DrawingScale", "1", null, "IN")
    + cell("DrawingSizeType", "0") + cell("DrawingScaleType", "0") + cell("InhibitSnap", "0")
    + cell("PageLockReplace", "0", null, "BOOL") + cell("PageLockDuplicate", "0", null, "BOOL")
    + cell("UIVisibility", "0") + cell("ShdwType", "0") + cell("ShdwObliqueAngle", "0") + cell("ShdwScaleFactor", "1")
    + cell("DrawingResizeType", "1") + cell("PageShapeSplit", "1")
    + "</PageSheet>"
    + '<Rel r:id="rId1"/></Page></Pages>',

  "visio/pages/_rels/pages.xml.rels": `${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>'
    + "</Relationships>",

  "visio/pages/page1.xml": `${xmlHead}<PageContents xmlns="${ns}" xmlns:r="${relNs}" xml:space="preserve"><Shapes>`
    + shapes.map(shapeXml).join("")
    + "</Shapes></PageContents>",
};

// ---------------------------------------------------------------------------
// Stored (uncompressed) zip writer. The same approach planned for src/zip.ts.

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStored(files) {
  const encoder = new TextEncoder();
  // Fixed DOS date and time (2026-11-20 00:00), so output is the same every run.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (11 << 5) | 20;
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true); // Local file header signature.
    local.setUint16(4, 20, true); // Version needed: 2.0.
    local.setUint16(6, 0x0800, true); // Flag bit 11: names are UTF-8.
    local.setUint16(8, 0, true); // Method 0: stored.
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // Compressed size.
    local.setUint32(22, data.length, true); // Uncompressed size.
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // Extra field length.
    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014B50, true); // Central directory signature.
    central.setUint16(4, 20, true); // Version made by.
    central.setUint16(6, 20, true); // Version needed.
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    // Extra, comment, disk start, internal and external attributes: all 0.
    central.setUint32(42, offset, true); // Offset of the local header.
    centrals.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true); // End of central directory signature.
  end.setUint16(8, Object.keys(files).length, true); // Entries on this disk.
  end.setUint16(10, Object.keys(files).length, true); // Entries in total.
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // Offset of the central directory.

  const chunks = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matching CSV. RFC 4180 quoting, CRLF, a BOM for Excel, and a ' before
// anything that a spreadsheet would run as a formula.

function csvField(value) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const activityTitle = id => activities.find(a => a.id === id).title;
const csvRows = [["Activity", "Release", "ID", "Title"]];
for (const release of releases) {
  if (release.collapsed) {
    csvRows.push(["", release.title, "", `Collapsed · ${release.counts}`]);
    continue;
  }
  for (const activity of activities) {
    for (const story of stories.filter(s => s.release === release.id && s.activity === activity.id)) {
      csvRows.push([activityTitle(story.activity), release.title, story.id, story.title]);
    }
  }
}
// One formula-looking title, to check it is not run in a spreadsheet.
csvRows.push([activities[0].title, releases[0].title, "TEST-1", "=1+1 should show as text"]);
const csv = "﻿" + csvRows.map(row => row.map(csvField).join(",")).join("\r\n") + "\r\n";

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "story-map-test.vsdx"), zipStored(parts));
writeFileSync(join(outDir, "story-map-test.csv"), csv);
console.log(`Wrote ${join(outDir, "story-map-test.vsdx")} (${shapes.length} shapes, ${num(pageWidth)} × ${num(pageHeight)} in) and ${join(outDir, "story-map-test.csv")}`);
