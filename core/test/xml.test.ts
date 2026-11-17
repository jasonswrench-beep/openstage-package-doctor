import { test } from "node:test";
import assert from "node:assert/strict";
import { attr, decodeXmlBytes, kid, parseXml, XmlError, XML_NS } from "../src/xml.ts";

test("elements, attributes, text, entities and CDATA", () => {
  const root = parseXml(`<?xml version="1.0"?>\n<!-- c -->\n<a x="1 &amp; 2"><b>Tom &lt;&#65;&#x42;&gt;</b><c><![CDATA[<raw & text>]]></c></a>`);
  assert.equal(root.name, "a");
  assert.equal(attr(root, "x"), "1 & 2");
  assert.equal(kid(root, "b")!.text, "Tom <AB>");
  assert.equal(kid(root, "c")!.text, "<raw & text>");
  assert.equal(kid(root, "b")!.line, 3);
});

test("namespaces are resolved whatever prefix is used", () => {
  const root = parseXml(`<m xmlns="urn:default" xmlns:q="urn:adl" xml:base="content/"><q:item q:type="sco" plain="p"/></m>`);
  assert.equal(root.ns, "urn:default");
  const item = root.children[0]!;
  assert.equal(item.local, "item");
  assert.equal(item.ns, "urn:adl");
  assert.equal(attr(item, "type", "urn:adl"), "sco");
  assert.equal(attr(item, "plain", ""), "p");
  assert.equal(attr(root, "base", XML_NS), "content/");
});

test("what a strict XML reader refuses, with the line", () => {
  const cases: [string, RegExp, number][] = [
    [`<a>\n<b>\n</a>`, /<\/a> is here, but the open tag is <b> from line 2/, 3],
    [`<a>\n<p:b/></a>`, /prefix "p:"/, 2],
    [`<a>&nbsp;</a>`, /&nbsp; is not an entity/, 1],
    [`<a x="1" x="2"/>`, /attribute x twice/, 1],
    [`<a>\n<b>`, /<b> is never closed/, 2],
    [`<a/><b/>`, /second top-level element/, 1],
    [`<a x=1/>`, /must be in quotes/, 1],
    [`<a>fish & chips</a>`, /An & must start an entity/, 1],
  ];
  for (const [source, message, line] of cases) {
    assert.throws(() => parseXml(source), (e: XmlError) => e instanceof XmlError && message.test(e.message) && e.line === line, source);
  }
});

test("encodings: a byte-order mark, a declared encoding, and UTF-8 that is not", () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<a>é</a>")]);
  assert.equal(decodeXmlBytes(bom).text, "<a>é</a>");
  const latin = new Uint8Array([...new TextEncoder().encode(`<?xml version="1.0" encoding="ISO-8859-1"?><a>`), 0xe9, ...new TextEncoder().encode("</a>")]);
  const l = decodeXmlBytes(latin);
  assert.equal(l.encodingProblem, undefined);
  assert.ok(l.text.includes("<a>é</a>"));
  const wrong = new Uint8Array([...new TextEncoder().encode(`<a>`), 0xe9, ...new TextEncoder().encode("</a>")]);
  const w = decodeXmlBytes(wrong);
  assert.ok(w.encodingProblem);
  assert.equal(w.text, "<a>é</a>");
});
