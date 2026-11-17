// Makes zip files for the tests, including broken ones no ordinary zip tool would write: backslashes in names,
// the encryption flag, an unusual compression method, a wrong checksum.

import { deflateSync } from "fflate";
import { crc32 } from "../src/zip.ts";
import { openPackage } from "../src/open.ts";
import type { OpenedPackage } from "../src/model.ts";

export interface TestEntry {
  name: string;
  data?: string | Uint8Array;
  /** 0 stored (the default), 8 deflate, or any other number, written as is. */
  method?: number;
  encrypted?: boolean;
  utf8Flag?: boolean;
  /** The name's bytes, when they must not be UTF-8. */
  nameBytes?: Uint8Array;
  wrongCrc?: boolean;
}

const enc = new TextEncoder();

export function makeZip(entries: TestEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = typeof e.data === "string" ? enc.encode(e.data) : (e.data ?? new Uint8Array());
    const method = e.method ?? 0;
    const packed = method === 8 ? deflateSync(data) : data;
    const name = e.nameBytes ?? enc.encode(e.name);
    const flags = (e.encrypted ? 1 : 0) | (e.utf8Flag ? 0x800 : 0);
    const crc = e.wrongCrc ? (crc32(data) ^ 1) >>> 0 : crc32(data);

    const local = new Uint8Array(30 + name.length + packed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Opens a zip made from `files` (name to text), all deflated. */
export function open(files: Record<string, string>, name = "test.zip"): OpenedPackage {
  return openPackage(makeZip(Object.entries(files).map(([n, data]) => ({ name: n, data, method: 8 }))), name);
}

export function ids(r: OpenedPackage, severity?: string): string[] {
  return r.findings.filter((f) => !severity || f.severity === severity).map((f) => f.id);
}

export const PAGE = `<!doctype html><html lang="en"><head><title>Lesson</title></head><body><p>Hello</p></body></html>`;

export function scorm12(opts: { item?: string; resource?: string; extra?: string; schemaversion?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="M1" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>${opts.schemaversion ?? "1.2"}</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>Test course</title>
      ${opts.item ?? `<item identifier="I1" identifierref="R1"><title>Lesson one</title><adlcp:masteryscore>80</adlcp:masteryscore></item>`}
    </organization>
  </organizations>
  <resources>
    ${opts.resource ?? `<resource identifier="R1" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource>`}
    ${opts.extra ?? ""}
  </resources>
</manifest>`;
}

export function scorm2004(opts: { item?: string; resource?: string; org?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="M1" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1" adlseq:objectivesGlobalToSystem="false">
      <title>Test course 2004</title>
      ${opts.item ?? `<item identifier="I1" identifierref="R1">
        <title>Lesson one</title>
        <adlcp:completionThreshold completedByMeasure="true" minProgressMeasure="0.75"/>
        <imsss:sequencing>
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>
          <imsss:objectives><imsss:primaryObjective objectiveID="p" satisfiedByMeasure="true"><imsss:minNormalizedMeasure>0.8</imsss:minNormalizedMeasure></imsss:primaryObjective></imsss:objectives>
          <imsss:limitConditions attemptLimit="3"/>
        </imsss:sequencing>
        <adlnav:presentation><adlnav:navigationInterface><adlnav:hideLMSUI>continue</adlnav:hideLMSUI><adlnav:hideLMSUI>previous</adlnav:hideLMSUI></adlnav:navigationInterface></adlnav:presentation>
      </item>`}
      ${opts.org ?? `<imsss:sequencing><imsss:controlMode choice="true" flow="true"/></imsss:sequencing>`}
    </organization>
  </organizations>
  <resources>
    ${opts.resource ?? `<resource identifier="R1" type="webcontent" adlcp:scormType="sco" href="index.html"><file href="index.html"/></resource>`}
  </resources>
</manifest>`;
}

export function cmi5(au = `<au id="https://example.org/au/1" moveOn="CompletedOrPassed" masteryScore="0.8" launchMethod="OwnWindow"><title><langstring lang="en-US">Lesson one</langstring></title><description><langstring lang="en-US">d</langstring></description><url>index.html</url></au>`): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="https://example.org/course/1"><title><langstring lang="en-US">Test cmi5 course</langstring></title><description><langstring lang="en-US">d</langstring></description></course>
  ${au}
</courseStructure>`;
}

export function tincan(activity = `<activity id="https://example.org/course/1" type="http://adlnet.gov/expapi/activities/course"><name>Test xAPI course</name><description lang="en-US">d</description><launch lang="en-us">index.html</launch></activity>`): string {
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd"><activities>${activity}</activities></tincan>`;
}
