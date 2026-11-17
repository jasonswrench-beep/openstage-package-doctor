// What the two stand-in SCORM LMSs share: the record of one call, and the learner's record kept between launches.

/** One call the course made to the LMS's API, with what the LMS answered. */
export interface ApiCall {
  /** The function, as the course called it: LMSSetValue, SetValue, Initialize... */
  call: string;
  args: string[];
  /** What the function returned to the course. */
  result: string;
  /** The error code GetLastError gives after the call ("0" for none). */
  error: string;
  /** Why the LMS refused the call, in words, when it did. */
  reason?: string;
  /** Something the LMS did on its own after the call, in words: set passed from the score, ended the attempt... */
  note?: string;
}

export type Mode = "normal" | "browse" | "review";

/** The learner's record of one launch point, as an LMS keeps it between launches. */
export interface LearnerRecord {
  data: Record<string, string>;
  /** Total time in hundredths of a second, summed from each session's session_time. */
  totalTime: number;
  launches: number;
}

export function newRecord(): LearnerRecord {
  return { data: {}, totalTime: 0, launches: 0 };
}

/** How the stand-in LMS describes its learner. Made up, and the same every time. */
export const LEARNER = { id: "learner-1", name: "Learner, Test" };

/** Hundredths of a second as SCORM 1.2's CMITimespan, HHHH:MM:SS.SS. */
export function timespan12(hundredths: number): string {
  const h = Math.floor(hundredths / 360000);
  const m = Math.floor((hundredths % 360000) / 6000);
  const s = (hundredths % 6000) / 100;
  return `${String(h).padStart(4, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Hundredths of a second as an ISO 8601 duration, the way SCORM 2004 writes time. */
export function duration2004(hundredths: number): string {
  const h = Math.floor(hundredths / 360000);
  const m = Math.floor((hundredths % 360000) / 6000);
  const s = (hundredths % 6000) / 100;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s.toFixed(2).replace(/\.00$/, "")}S`;
}

/** SCORM 1.2's HHHH:MM:SS.SS in hundredths of a second, or null when it is not one. */
export function parseTimespan12(v: string): number | null {
  const m = /^(\d{2,4}):(\d{2}):(\d{2})(\.\d{1,2})?$/.exec(v);
  if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) return null;
  return Number(m[1]) * 360000 + Number(m[2]) * 6000 + Math.round((Number(m[3]) + Number(m[4] ?? 0)) * 100);
}

const DURATION = /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,2})?)S)?)?$/;

/** An ISO 8601 duration in hundredths of a second, or null when it is not one. Years and months count as 365 and 30 days. */
export function parseDuration(v: string): number | null {
  const m = DURATION.exec(v);
  if (!m) return null;
  const n = (i: number) => Number(m[i] ?? 0);
  return Math.round((((n(1) * 365 + n(2) * 30 + n(3)) * 24 + n(4)) * 3600 + n(5) * 60 + n(6)) * 100);
}

/** Shortens a long value for a log line. */
export function short(v: string, max = 80): string {
  return v.length > max ? `${v.slice(0, max - 3)}... (${v.length} characters)` : v;
}
