import { prepareStoryMapExport, type StoryMapExportOptions } from "./export.js";
import { layoutStoryMapExport, paragraphSpacing, textMargin, type ExportLayout, type ExportShape } from "./export-layout.js";
import type { StoryMapView } from "./view.js";
import { zipStored } from "./zip.js";

/** The `Content-Type` for a `.vsdx` file. */
export const vsdxContentType = "application/vnd.ms-visio.drawing.main+xml";

/**
 * Writes the internal map as a Visio file (`.vsdx`) for importing into
 * Lucidchart, Miro or Visio. The whole map is one page: activities across the
 * top, a lane per release with its notes and impact, and a card per story with
 * its ID and title. Lanes in `collapsedReleases` show only their header and
 * story count, and at most `maxStories` (200) of the most recently changed
 * stories are included.
 *
 * Pass the unfiltered view from `getStoryMapForViewer`, with history if you have
 * it. Throws a `TypeError` for a customer view or a filtered view. Uses no
 * Node-only APIs, and the same input always gives the same bytes.
 */
export function storyMapToVsdx(view: StoryMapView, options: StoryMapExportOptions = {}): Uint8Array {
  const model = prepareStoryMapExport(view, options);
  return zipStored(vsdxParts(layoutStoryMapExport(model), model.title, model.exportedOn));
}

const ns = "http://schemas.microsoft.com/office/visio/2012/main";
const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkgRelNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Escapes text for XML, dropping characters XML 1.0 does not allow. */
export function escapeXml(value: string | number): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = (n: number) => String(Math.round(n * 10000) / 10000);
const pt = (points: number) => num(points / 72);

function cell(name: string, value: string | number, formula?: string, unit?: string) {
  return `<Cell N="${name}" V="${escapeXml(value)}"${unit ? ` U="${unit}"` : ""}${formula ? ` F="${escapeXml(formula)}"` : ""}/>`;
}

function shapeXml(shape: ExportShape, id: number, pageHeight: number) {
  const { w, h } = shape;
  const out = [
    `<Shape ID="${id}" NameU="${escapeXml(shape.name)}" Name="${escapeXml(shape.name)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">`,
    cell("PinX", num(shape.x + w / 2)),
    // Visio's origin is the bottom left, with y going up.
    cell("PinY", num(pageHeight - (shape.y + h / 2))),
    cell("Width", num(w)),
    cell("Height", num(h)),
    cell("LocPinX", num(w / 2), "Width*0.5"),
    cell("LocPinY", num(h / 2), "Height*0.5"),
    cell("Angle", "0"),
    cell("FlipX", "0"),
    cell("FlipY", "0"),
    cell("ResizeMode", "0"),
    cell("FillForegnd", shape.fill ?? "#FFFFFF"),
    cell("FillBkgnd", shape.fill ?? "#FFFFFF"),
    cell("FillPattern", shape.fill ? "1" : "0"),
    cell("LineColor", shape.line ?? "#000000"),
    cell("LineWeight", num(1 / 72)),
    cell("LinePattern", shape.line ? "1" : "0"),
    cell("Rounding", "0"),
    cell("TxtPinX", num(w / 2), "Width*0.5"),
    cell("TxtPinY", num(h / 2), "Height*0.5"),
    cell("TxtWidth", num(w), "Width*1"),
    cell("TxtHeight", num(h), "Height*1"),
    cell("TxtLocPinX", num(w / 2), "TxtWidth*0.5"),
    cell("TxtLocPinY", num(h / 2), "TxtHeight*0.5"),
    cell("TxtAngle", "0"),
    cell("LeftMargin", num(textMargin.x)),
    cell("RightMargin", num(textMargin.x)),
    cell("TopMargin", num(textMargin.y)),
    cell("BottomMargin", num(textMargin.y)),
    cell("VerticalAlign", shape.valign === "middle" ? "1" : "0"),
  ];

  if (shape.text.length) {
    out.push('<Section N="Character">');
    shape.text.forEach((run, i) => {
      const style = (run.bold ? 1 : 0) | (run.italic ? 2 : 0);
      out.push(`<Row IX="${i}">${cell("Font", "Calibri")}${cell("Color", run.color ?? "#000000")}${cell("Size", pt(run.size), undefined, "PT")}${cell("Style", style)}</Row>`);
    });
    out.push("</Section>");
    out.push(`<Section N="Paragraph"><Row IX="0">${cell("HorzAlign", shape.align === "center" ? "1" : "0")}${cell("SpAfter", pt(paragraphSpacing), undefined, "PT")}</Row></Section>`);
  }

  if (shape.data) {
    out.push('<Section N="Property">');
    // Row names must be unique and simple, so they are numbered. The label is what people see.
    Object.entries(shape.data).forEach(([label, value], i) => {
      out.push(`<Row N="Row_${i + 1}">${cell("Value", value, undefined, "STR")}${cell("Label", label)}${cell("Type", "0")}</Row>`);
    });
    out.push("</Section>");
  }

  out.push(
    '<Section N="Geometry" IX="0">',
    cell("NoFill", shape.fill ? "0" : "1"),
    cell("NoLine", shape.line ? "0" : "1"),
    cell("NoShow", "0"),
    cell("NoSnap", "0"),
    `<Row T="MoveTo" IX="1">${cell("X", "0", "Width*0")}${cell("Y", "0", "Height*0")}</Row>`,
    `<Row T="LineTo" IX="2">${cell("X", num(w), "Width*1")}${cell("Y", "0", "Height*0")}</Row>`,
    `<Row T="LineTo" IX="3">${cell("X", num(w), "Width*1")}${cell("Y", num(h), "Height*1")}</Row>`,
    `<Row T="LineTo" IX="4">${cell("X", "0", "Width*0")}${cell("Y", num(h), "Height*1")}</Row>`,
    `<Row T="LineTo" IX="5">${cell("X", "0", "Geometry1.X1")}${cell("Y", "0", "Geometry1.Y1")}</Row>`,
    "</Section>",
  );

  if (shape.text.length) {
    // <cp IX="n"/> switches to character row n, and a line feed ends a paragraph.
    out.push(`<Text>${shape.text.map((run, i) => `<cp IX="${i}"/>${escapeXml(run.text)}`).join("\n")}</Text>`);
  }
  out.push("</Shape>");
  return out.join("");
}

function vsdxParts(layout: ExportLayout, title: string, date: string): Array<[string, string]> {
  const created = `${date}T00:00:00Z`;
  const relationships = (rels: Array<[type: string, target: string]>) =>
    `${head}<Relationships xmlns="${pkgRelNs}">${rels.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;

  return [
    ["[Content_Types].xml", `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/visio/document.xml" ContentType="${vsdxContentType}"/>`
      + '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>'
      + '<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>'
      + '<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
      + "</Types>"],

    ["_rels/.rels", relationships([
      ["http://schemas.microsoft.com/visio/2010/relationships/document", "visio/document.xml"],
      ["http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"],
      ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", "docProps/app.xml"],
    ])],

    ["docProps/app.xml", `${head}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
      + "<Application>Embedded Story Map</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>"
      + "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>"
      + "<AppVersion>16.0000</AppVersion></Properties>"],

    ["docProps/core.xml", `${head}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `<dc:title>${escapeXml(title)}</dc:title><dc:creator>Embedded Story Map</dc:creator>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>`
      + "</cp:coreProperties>"],

    ["visio/document.xml", `${head}<VisioDocument xmlns="${ns}" xmlns:r="${relNs}" xml:space="preserve">`
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
      + `<Section N="Character"><Row IX="0">${cell("Font", "Calibri")}${cell("Color", "#000000")}${cell("Style", "0")}${cell("Case", "0")}${cell("Pos", "0")}${cell("FontScale", "1")}${cell("Size", pt(10), undefined, "PT")}${cell("DblUnderline", "0")}${cell("Overline", "0")}${cell("Strikethru", "0")}${cell("DoubleStrikethrough", "0")}${cell("Letterspace", "0")}${cell("ColorTrans", "0")}</Row></Section>`
      + `<Section N="Paragraph"><Row IX="0">${cell("IndFirst", "0")}${cell("IndLeft", "0")}${cell("IndRight", "0")}${cell("SpLine", "-1.2")}${cell("SpBefore", "0")}${cell("SpAfter", "0")}${cell("HorzAlign", "1")}${cell("Bullet", "0")}${cell("BulletStr", "")}${cell("TextPosAfterBullet", "0")}</Row></Section>`
      + "</StyleSheet></StyleSheets></VisioDocument>"],

    ["visio/_rels/document.xml.rels", relationships([
      ["http://schemas.microsoft.com/visio/2010/relationships/pages", "pages/pages.xml"],
      ["http://schemas.microsoft.com/visio/2010/relationships/windows", "windows.xml"],
    ])],

    ["visio/windows.xml", `${head}<Windows ClientWidth="1600" ClientHeight="900" xmlns="${ns}" xmlns:r="${relNs}" xml:space="preserve">`
      + `<Window ID="0" WindowType="Drawing" WindowState="1073741824" ClientWidth="1600" ClientHeight="900" Page="0" ViewScale="-1" ViewCenterX="${num(layout.width / 2)}" ViewCenterY="${num(layout.height / 2)}">`
      + "<ShowRulers>1</ShowRulers><ShowGrid>0</ShowGrid><ShowPageBreaks>0</ShowPageBreaks><ShowGuides>1</ShowGuides><ShowConnectionPoints>0</ShowConnectionPoints>"
      + "</Window></Windows>"],

    ["visio/pages/pages.xml", `${head}<Pages xmlns="${ns}" xmlns:r="${relNs}" xml:space="preserve">`
      + '<Page ID="0" NameU="Story map" Name="Story map" ViewScale="-1"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0">'
      + cell("PageWidth", num(layout.width), undefined, "IN") + cell("PageHeight", num(layout.height), undefined, "IN")
      + cell("ShdwOffsetX", "0.125") + cell("ShdwOffsetY", "-0.125")
      + cell("PageScale", "1", undefined, "IN") + cell("DrawingScale", "1", undefined, "IN")
      + cell("DrawingSizeType", "0") + cell("DrawingScaleType", "0") + cell("InhibitSnap", "0")
      + cell("UIVisibility", "0") + cell("ShdwType", "0") + cell("ShdwObliqueAngle", "0") + cell("ShdwScaleFactor", "1")
      + cell("DrawingResizeType", "1") + cell("PageShapeSplit", "1")
      + '</PageSheet><Rel r:id="rId1"/></Page></Pages>'],

    ["visio/pages/_rels/pages.xml.rels", relationships([
      ["http://schemas.microsoft.com/visio/2010/relationships/page", "page1.xml"],
    ])],

    ["visio/pages/page1.xml", `${head}<PageContents xmlns="${ns}" xmlns:r="${relNs}" xml:space="preserve"><Shapes>`
      + layout.shapes.map((shape, i) => shapeXml(shape, i + 1, layout.height)).join("")
      + "</Shapes></PageContents>"],
  ];
}
