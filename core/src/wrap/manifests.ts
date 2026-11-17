// The manifests for a wrapped package: imsmanifest.xml (SCORM 1.2 or SCORM 2004 4th edition), cmi5.xml or tincan.xml,
// for one unit that is the whole package. Adapted from OpenStage Author's manifest writers (player/src/scorm-manifest.ts,
// cmi5-manifest.ts and xapi-manifest.ts), with three changes for wrapping: no schemaLocation (the schema files are not
// in the package, and LMSs do not need them), the start page given, and no pass mark (a wrapped file has no score).

export type WrapStandard = "scorm12" | "scorm2004" | "cmi5" | "xapi";

export interface ManifestInput {
  title: string;
  description: string;
  language: string;
  /** The page that opens, from the top of the package. */
  start: string;
  /** Every file in the package, from its top, with forward slashes. */
  files: string[];
  /** An address (IRI) that identifies the course, for cmi5 and xAPI. */
  courseId: string;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An identifier that is a valid XML name, from the title. */
export function manifestId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `openstage-${slug || "package"}`;
}

const fileList = (files: string[]) => [...files].sort().map((f) => `      <file href="${xml(f)}"/>`).join("\n");

export function scorm12Manifest(m: ManifestInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifestId(m.title)}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org-1">
    <organization identifier="org-1">
      <title>${xml(m.title)}</title>
      <item identifier="item-1" identifierref="res-1" isvisible="true">
        <title>${xml(m.title)}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res-1" type="webcontent" adlcp:scormtype="sco" href="${xml(m.start)}">
${fileList(m.files)}
    </resource>
  </resources>
</manifest>
`;
}

/** SCORM 2004 4th edition. deliveryControls say the page itself reports completion, so an LMS does not mark the
 *  package complete the moment the learner leaves, whatever the page said. */
export function scorm2004Manifest(m: ManifestInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifestId(m.title)}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="org-1">
    <organization identifier="org-1" structure="hierarchical">
      <title>${xml(m.title)}</title>
      <item identifier="item-1" identifierref="res-1" isvisible="true">
        <title>${xml(m.title)}</title>
        <imsss:sequencing>
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>
        </imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res-1" type="webcontent" adlcp:scormType="sco" href="${xml(m.start)}">
${fileList(m.files)}
    </resource>
  </resources>
</manifest>
`;
}

/** The one unit's id. */
export const unitId = (courseId: string): string => `${courseId.replace(/\/$/, "")}/au/1`;

/** cmi5 (Quartz) CourseStructure, elements in the order its schema requires. One AU, to be completed. */
export function cmi5Manifest(m: ManifestInput): string {
  const lang = xml(m.language);
  return `<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="${xml(m.courseId)}">
    <title><langstring lang="${lang}">${xml(m.title)}</langstring></title>
    <description><langstring lang="${lang}">${xml(m.description)}</langstring></description>
  </course>
  <au id="${xml(unitId(m.courseId))}" moveOn="Completed" launchMethod="AnyWindow">
    <title><langstring lang="${lang}">${xml(m.title)}</langstring></title>
    <description><langstring lang="${lang}">${xml(m.description)}</langstring></description>
    <url>${xml(m.start)}</url>
  </au>
</courseStructure>
`;
}

export function tincanManifest(m: ManifestInput): string {
  const lang = xml(m.language);
  return `<?xml version="1.0" encoding="utf-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="${xml(m.courseId)}" type="http://adlnet.gov/expapi/activities/course">
      <name lang="${lang}">${xml(m.title)}</name>
      <description lang="${lang}">${xml(m.description)}</description>
      <launch lang="${lang}">${xml(m.start)}</launch>
    </activity>
  </activities>
</tincan>
`;
}

export const MANIFEST_NAME: Record<WrapStandard, string> = { scorm12: "imsmanifest.xml", scorm2004: "imsmanifest.xml", cmi5: "cmi5.xml", xapi: "tincan.xml" };

export function manifestFor(standard: WrapStandard, m: ManifestInput): string {
  return { scorm12: scorm12Manifest, scorm2004: scorm2004Manifest, cmi5: cmi5Manifest, xapi: tincanManifest }[standard](m);
}
