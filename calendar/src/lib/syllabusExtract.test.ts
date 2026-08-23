import { SCHOOL_COURSE_TEMPLATE } from "./syllabusExtract";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Keys must be unique (importSyllabusCourseAction writes one ProjectField
// per template entry — a duplicate key would silently produce two rows
// for the same piece of info) and every fieldType must be one of the
// review UI's known render modes (TEXT/EMAIL as a plain input,
// LONG_TEXT/LIST as a textarea — see SyllabusImportClient.tsx).
const keys = SCHOOL_COURSE_TEMPLATE.map((f) => f.key);
assert(new Set(keys).size === keys.length, "SCHOOL_COURSE_TEMPLATE has duplicate keys");
assert(SCHOOL_COURSE_TEMPLATE.length > 0, "SCHOOL_COURSE_TEMPLATE is empty");
for (const f of SCHOOL_COURSE_TEMPLATE) {
  assert(
    ["TEXT", "LONG_TEXT", "EMAIL", "LIST"].includes(f.fieldType),
    `Unknown fieldType "${f.fieldType}" for ${f.key}`,
  );
  assert(f.label.trim().length > 0, `Empty label for ${f.key}`);
}

console.log("syllabusExtract.test.ts: all checks passed");
