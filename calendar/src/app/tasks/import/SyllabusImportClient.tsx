"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  extractFileTextAction,
  extractSyllabusDatesAction,
  importSyllabusCourseAction,
  type SyllabusCourseFieldInput,
  type SyllabusExamInput,
  type SyllabusTaskInput,
} from "../syllabusActions";
import { SCHOOL_COURSE_TEMPLATE } from "@/lib/courseTemplate";
import { WEEKDAY_CODES, type WeekdayCode } from "@/lib/recurrence";
import {
  IMPORT_FILE_ACCEPT,
  MAX_CONVERT_BYTES,
  isWithinSizeLimit,
  pickConverter,
} from "@/lib/documentConvert";
import Button from "../../ui/Button";

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };

type ReviewRow = {
  title: string;
  dueDateYMD: string | null;
  notes: string | null;
  recurringDays: WeekdayCode[] | null;
  include: boolean;
};

type ExamRow = SyllabusExamInput & { include: boolean };
type LectureRow = { dateYMD: string | null; topic: string; include: boolean };

const WEEKDAY_SHORT_LABELS: Record<WeekdayCode, string> = {
  SU: "Su",
  MO: "Mo",
  TU: "Tu",
  WE: "We",
  TH: "Th",
  FR: "Fr",
  SA: "Sa",
};

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

export default function SyllabusImportClient({
  projects,
  assignees,
}: {
  projects: Project[];
  assignees: Assignee[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ taskCount: number; examEventCount: number; classScheduleCreated: boolean; lectureNotesCount: number } | null>(null);

  // Review state — null until extraction succeeds.
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [courseName, setCourseName] = useState("");
  const [courseSummary, setCourseSummary] = useState("");
  const [fields, setFields] = useState<SyllabusCourseFieldInput[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [lectures, setLectures] = useState<LectureRow[]>([]);
  const [meetingDays, setMeetingDays] = useState<WeekdayCode[]>([]);
  const [meetingStartTime, setMeetingStartTime] = useState("");
  const [meetingEndTime, setMeetingEndTime] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [createClassSchedule, setCreateClassSchedule] = useState(false);
  const [useExistingProjectId, setUseExistingProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  // Plain text reads client-side with no round-trip. Everything else goes
  // to the server: .docx via mammoth in-process, PDF and friends via the
  // markitdown service. pickConverter is shared with the server action so
  // the two can't disagree about what's supported.
  const [isReadingFile, setIsReadingFile] = useState(false);
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file name later
    if (!file) return;
    setFileError(null);

    const converter = pickConverter(file.name);
    if (converter === null) {
      setFileError("That file type isn't supported — paste the text instead.");
      return;
    }
    if (!isWithinSizeLimit(file.size)) {
      setFileError(`File must be non-empty and under ${MAX_CONVERT_BYTES / (1024 * 1024)}MB.`);
      return;
    }

    if (converter === "text") {
      const reader = new FileReader();
      reader.onload = () => setText(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => setFileError("Couldn't read that file. Try pasting the text instead.");
      reader.readAsText(file);
      setFileName(file.name);
      return;
    }

    setIsReadingFile(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await extractFileTextAction(formData);
      if (!result.ok) {
        setFileError(result.error);
        return;
      }
      setText(result.text);
      setFileName(file.name);
    } catch {
      setFileError("Couldn't read that file. Try pasting the text instead.");
    } finally {
      setIsReadingFile(false);
    }
  };

  const handleExtract = async () => {
    setIsExtracting(true);
    setError(null);
    setImportResult(null);
    try {
      const result = await extractSyllabusDatesAction(text, termStart || null);
      if (!result.ok) {
        setError(result.error);
        setRows(null);
        return;
      }
      setRows(
        result.items.map((item) => ({
          title: item.title,
          dueDateYMD: item.dueDate,
          notes: item.notes,
          recurringDays: item.recurringDays,
          // Genuinely dated or recurring items are real, detected
          // commitments — include by default. An item with neither is a
          // placeholder ("Assignment 3", no date the syllabus ever gives)
          // and shouldn't quietly become a real task; the review UI puts
          // these in their own section, unchecked, for the user to date
          // and opt in individually.
          include: Boolean(item.dueDate || (item.recurringDays && item.recurringDays.length > 0)),
        })),
      );
      setCourseName(result.courseInfo.courseName ?? "");
      setCourseSummary(result.courseInfo.courseSummary ?? "");
      setFields(
        SCHOOL_COURSE_TEMPLATE.map((f) => {
          const raw = result.courseInfo[f.key];
          const value = Array.isArray(raw) ? raw.join("\n") : (raw ?? "");
          return { key: f.key, label: f.label, fieldType: f.fieldType, value };
        }),
      );
      setExams(result.examDates.map((e) => ({ title: e.title, type: e.type, dateYMD: e.date, notes: e.notes, include: true })));
      setLectures(
        result.lectureSchedule.map((l) => ({ dateYMD: l.date, topic: l.topic, include: true })),
      );
      setMeetingDays(result.courseInfo.meetingDays ?? []);
      setMeetingStartTime(result.courseInfo.meetingStartTime ?? "");
      setMeetingEndTime(result.courseInfo.meetingEndTime ?? "");
      setMeetingLocation(result.courseInfo.meetingLocation ?? "");
      setCreateClassSchedule(
        Boolean(result.courseInfo.meetingDays?.length && result.courseInfo.meetingStartTime && result.courseInfo.meetingEndTime),
      );
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsExtracting(false);
    }
  };

  const updateRow = (index: number, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? null);
  };
  const updateField = (index: number, value: string) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, value } : f)));
  };
  const updateExam = (index: number, patch: Partial<ExamRow>) => {
    setExams((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };
  const updateLecture = (index: number, patch: Partial<LectureRow>) => {
    setLectures((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  const toggleMeetingDay = (day: WeekdayCode) => {
    setMeetingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };
  const toggleRowDay = (index: number, day: WeekdayCode) => {
    setRows(
      (prev) =>
        prev?.map((r, i) => {
          if (i !== index) return r;
          const current = r.recurringDays ?? [];
          return {
            ...r,
            recurringDays: current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
          };
        }) ?? null,
    );
  };

  const canCreateClassSchedule = meetingDays.length > 0 && meetingStartTime && meetingEndTime && termStart;

  // Index lists (not copies) so updateRow/toggleRowDay keep working against
  // the flat `rows` array regardless of which section a row renders in.
  const recurringRows = (rows ?? [])
    .map((r, i) => (r.recurringDays && r.recurringDays.length > 0 ? i : -1))
    .filter((i) => i >= 0);
  const datedRows = (rows ?? [])
    .map((r, i) => (!(r.recurringDays && r.recurringDays.length > 0) && r.dueDateYMD ? i : -1))
    .filter((i) => i >= 0);
  const futureRows = (rows ?? [])
    .map((r, i) => (!(r.recurringDays && r.recurringDays.length > 0) && !r.dueDateYMD ? i : -1))
    .filter((i) => i >= 0);

  const handleImport = async () => {
    if (!rows) return;
    setIsImporting(true);
    setError(null);
    try {
      const tasks: SyllabusTaskInput[] = rows
        .filter((r) => r.include)
        .map((r) => ({ title: r.title, dueDateYMD: r.dueDateYMD, recurringDays: r.recurringDays }));
      const result = await importSyllabusCourseAction({
        courseName,
        useExistingProjectId: useExistingProjectId || null,
        courseSummary: courseSummary.trim() || null,
        fields: useExistingProjectId ? [] : fields,
        assigneeId: assigneeId || null,
        tasks,
        exams: exams.filter((e) => e.include).map((e) => ({ title: e.title, type: e.type, dateYMD: e.dateYMD, notes: e.notes })),
        createClassSchedule: createClassSchedule && Boolean(canCreateClassSchedule),
        meetingDays: meetingDays.length > 0 ? meetingDays : null,
        meetingStartTime: meetingStartTime || null,
        meetingEndTime: meetingEndTime || null,
        meetingLocation: meetingLocation || null,
        termStartYMD: termStart || null,
        termEndYMD: termEnd || null,
        lectureSchedule: lectures.filter((l) => l.include).map((l) => ({ dateYMD: l.dateYMD, topic: l.topic })),
      });
      setImportResult(result);
      setRows(null);
      router.push(`/projects/${result.projectId}`);
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating the course. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      {!rows && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">
              Upload a file{" "}
              <span className="text-zinc-400">
                (.txt/.md/.docx, or PDF and other formats with the converter set up — fills in the text below)
              </span>
            </span>
            <input
              type="file"
              accept={IMPORT_FILE_ACCEPT}
              onChange={handleFileChange}
              disabled={isReadingFile}
              className="text-sm text-zinc-500 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-700 dark:file:text-zinc-200 dark:hover:file:bg-zinc-600"
            />
            {isReadingFile && <span className="text-xs text-zinc-400">Reading file…</span>}
            {fileName && !fileError && !isReadingFile && (
              <span className="text-xs text-zinc-400">Loaded {fileName}.</span>
            )}
            {fileError && (
              <span className="text-xs text-amber-600 dark:text-amber-400">{fileError}</span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Syllabus text</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder="Paste the syllabus here, or upload a file above…"
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">
                Term start <span className="text-zinc-400">(resolves "Week 3" style dates)</span>
              </span>
              <input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">
                Term end <span className="text-zinc-400">(bounds the class schedule below)</span>
              </span>
              <input type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} className={inputClass} />
            </label>
          </div>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <div>
            <Button type="button" onClick={handleExtract} disabled={!text.trim()} pending={isExtracting}>
              {isExtracting ? "Extracting…" : "Extract course info"}
            </Button>
          </div>
        </>
      )}

      {importResult && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
          Created {importResult.taskCount} task{importResult.taskCount === 1 ? "" : "s"}
          {importResult.examEventCount > 0 ? `, ${importResult.examEventCount} exam event${importResult.examEventCount === 1 ? "" : "s"}` : ""}
          {importResult.classScheduleCreated ? ", and the class schedule" : ""}
          {importResult.lectureNotesCount > 0 ? ` (${importResult.lectureNotesCount} lecture day${importResult.lectureNotesCount === 1 ? "" : "s"} noted)` : ""}.
        </p>
      )}

      {rows && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Course name</span>
              <input
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="e.g. Intro to Psychology"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Project</span>
              <select
                value={useExistingProjectId}
                onChange={(e) => setUseExistingProjectId(e.target.value)}
                className={inputClass}
              >
                <option value="">Create a new project for this course</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>Add to: {p.name}</option>
                ))}
              </select>
            </label>
          </div>

          {!useExistingProjectId && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">
                Course summary{" "}
                <span className="text-zinc-400">(saved as the project&apos;s notes)</span>
              </span>
              <textarea
                value={courseSummary}
                onChange={(e) => setCourseSummary(e.target.value)}
                rows={4}
                placeholder="What the course covers and how it's delivered."
                className={inputClass}
              />
            </label>
          )}

          {!useExistingProjectId && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              {fields.map((f, i) => (
                <label key={f.key} className="flex flex-col gap-1 text-sm">
                  <span className="text-zinc-500">{f.label}</span>
                  {f.fieldType === "LONG_TEXT" || f.fieldType === "LIST" ? (
                    <textarea
                      value={f.value}
                      onChange={(e) => updateField(i, e.target.value)}
                      rows={2}
                      className={inputClass}
                    />
                  ) : (
                    <input value={f.value} onChange={(e) => updateField(i, e.target.value)} className={inputClass} />
                  )}
                </label>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Class meeting time</span>
              <div className="flex gap-2">
                <input type="time" value={meetingStartTime} onChange={(e) => setMeetingStartTime(e.target.value)} className={inputClass} />
                <input type="time" value={meetingEndTime} onChange={(e) => setMeetingEndTime(e.target.value)} className={inputClass} />
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Class location</span>
              <input value={meetingLocation} onChange={(e) => setMeetingLocation(e.target.value)} className={inputClass} />
            </label>
          </div>
          <div className="flex gap-1.5">
            {WEEKDAY_CODES.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={meetingDays.includes(day)}
                onClick={() => toggleMeetingDay(day)}
                className={
                  meetingDays.includes(day)
                    ? "flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
                    : "flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
                }
              >
                {WEEKDAY_SHORT_LABELS[day]}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createClassSchedule}
              onChange={(e) => setCreateClassSchedule(e.target.checked)}
              disabled={!canCreateClassSchedule}
              className="h-4 w-4"
            />
            <span className={canCreateClassSchedule ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400"}>
              Create the recurring class-schedule event
              {!canCreateClassSchedule && " (needs meeting days/time above and a term start date)"}
            </span>
          </label>

          {exams.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-zinc-500">Exam dates</span>
              {exams.map((exam, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                  <input type="checkbox" checked={exam.include} onChange={(e) => updateExam(i, { include: e.target.checked })} className="h-4 w-4" aria-label="Include" />
                  <input
                    type="text"
                    value={exam.title}
                    onChange={(e) => updateExam(i, { title: e.target.value })}
                    placeholder="Exam name"
                    aria-label="Exam name"
                    className={`${inputClass} flex-1`}
                  />
                  <select
                    value={exam.type}
                    onChange={(e) => updateExam(i, { type: e.target.value as ExamRow["type"] })}
                    aria-label="Exam type"
                    className={`${inputClass} w-28 flex-shrink-0`}
                  >
                    <option value="midterm">Midterm</option>
                    <option value="final">Final</option>
                    <option value="other">Other</option>
                  </select>
                  <input type="date" value={exam.dateYMD ?? ""} onChange={(e) => updateExam(i, { dateYMD: e.target.value || null })} className={`${inputClass} flex-1`} aria-label="Exam date" />
                  {exam.type === "final" && (
                    <span className="w-full text-xs text-amber-600 dark:text-amber-400">
                      Will be marked as an estimated time — final exam slots are often confirmed later.
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {lectures.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-500">
                Lecture topics ({lectures.filter((l) => l.include).length}/{lectures.length})
              </summary>
              <div className="mt-2 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {lectures.map((l, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-600">
                    <input type="checkbox" checked={l.include} onChange={(e) => updateLecture(i, { include: e.target.checked })} className="h-3.5 w-3.5" aria-label="Include" />
                    <input type="date" value={l.dateYMD ?? ""} onChange={(e) => updateLecture(i, { dateYMD: e.target.value || null })} className={`${inputClass} w-36 flex-shrink-0`} />
                    <input value={l.topic} onChange={(e) => updateLecture(i, { topic: e.target.value })} className={`${inputClass} flex-1`} />
                    {!l.dateYMD && <span className="w-full text-amber-600 dark:text-amber-400">No date resolved — won't be added.</span>}
                  </div>
                ))}
              </div>
            </details>
          )}

          {rows.length === 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-zinc-500">Assignments</span>
              <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
                No deliverables found in that text.
              </p>
            </div>
          ) : (
            <>
              {recurringRows.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-zinc-500">Recurring (every week)</span>
                  <ul className="flex flex-col gap-2">
                    {recurringRows.map((i) => {
                      const row = rows[i];
                      return (
                        <li
                          key={i}
                          className="flex flex-wrap items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={(e) => updateRow(i, { include: e.target.checked })}
                            className="mt-2.5 h-4 w-4"
                            aria-label="Include"
                          />
                          <input
                            value={row.title}
                            onChange={(e) => updateRow(i, { title: e.target.value })}
                            className={`${inputClass} min-w-[10rem] flex-1`}
                          />
                          <div className="flex gap-1.5">
                            {WEEKDAY_CODES.map((day) => (
                              <button
                                key={day}
                                type="button"
                                aria-pressed={(row.recurringDays ?? []).includes(day)}
                                onClick={() => toggleRowDay(i, day)}
                                className={
                                  (row.recurringDays ?? []).includes(day)
                                    ? "flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
                                    : "flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
                                }
                              >
                                {WEEKDAY_SHORT_LABELS[day]}
                              </button>
                            ))}
                          </div>
                          {!termStart && (
                            <p className="w-full text-xs text-amber-600 dark:text-amber-400">
                              Needs a term start date above to create — see the field near the top.
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {datedRows.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-zinc-500">Assignments</span>
                  <ul className="flex flex-col gap-2">
                    {datedRows.map((i) => {
                      const row = rows[i];
                      return (
                        <li
                          key={i}
                          className="flex flex-wrap items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={(e) => updateRow(i, { include: e.target.checked })}
                            className="mt-2.5 h-4 w-4"
                            aria-label="Include"
                          />
                          <input
                            value={row.title}
                            onChange={(e) => updateRow(i, { title: e.target.value })}
                            className={`${inputClass} min-w-[10rem] flex-[2]`}
                          />
                          <input
                            type="date"
                            value={row.dueDateYMD ?? ""}
                            onChange={(e) => updateRow(i, { dueDateYMD: e.target.value || null })}
                            className={`${inputClass} flex-1`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {futureRows.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-zinc-500">
                    No date yet{" "}
                    <span className="text-zinc-400">
                      (the syllabus didn&apos;t give one — pick a date and check the box to create these)
                    </span>
                  </span>
                  <ul className="flex flex-col gap-2">
                    {futureRows.map((i) => {
                      const row = rows[i];
                      return (
                        <li
                          key={i}
                          className="flex flex-wrap items-start gap-2 rounded-xl border border-dashed border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={(e) => updateRow(i, { include: e.target.checked })}
                            className="mt-2.5 h-4 w-4"
                            aria-label="Include"
                          />
                          <input
                            value={row.title}
                            onChange={(e) => updateRow(i, { title: e.target.value })}
                            className={`${inputClass} min-w-[10rem] flex-[2]`}
                          />
                          <input
                            type="date"
                            value={row.dueDateYMD ?? ""}
                            onChange={(e) => updateRow(i, { dueDateYMD: e.target.value || null })}
                            className={`${inputClass} flex-1`}
                          />
                          {row.notes && (
                            <p className="w-full text-xs text-amber-600 dark:text-amber-400">{row.notes}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Assign to</span>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={`${inputClass} max-w-xs`}>
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.type === "AI" ? " (AI)" : ""}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setRows(null)} disabled={isImporting}>
              Back
            </Button>
            <Button type="button" onClick={handleImport} pending={isImporting}>
              {isImporting ? "Creating…" : "Create course"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
