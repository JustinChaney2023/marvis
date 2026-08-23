"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  extractDocxTextAction,
  extractSyllabusDatesAction,
  importSyllabusCourseAction,
  SCHOOL_COURSE_TEMPLATE,
  type SyllabusCourseFieldInput,
  type SyllabusExamInput,
  type SyllabusTaskInput,
} from "../syllabusActions";
import { WEEKDAY_CODES, type WeekdayCode } from "@/lib/recurrence";
import Button from "../../ui/Button";

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };

type ReviewRow = {
  title: string;
  dueDateYMD: string | null;
  notes: string | null;
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

  // Plain FileReader for .txt/.md — no server round-trip needed. .docx is
  // a zip of XML, unreadable via readAsText, so that one goes through
  // extractDocxTextAction instead. Legacy .doc/PDF still aren't handled
  // (proprietary/binary formats without a lightweight pure-JS reader) —
  // rejected with a clear message rather than silently feeding garbage
  // into the AI extraction.
  const TEXT_FILE_EXTENSIONS = [".txt", ".md", ".markdown"];
  const [isReadingFile, setIsReadingFile] = useState(false);
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file name later
    if (!file) return;
    setFileError(null);
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".docx")) {
      setIsReadingFile(true);
      try {
        const formData = new FormData();
        formData.set("file", file);
        const result = await extractDocxTextAction(formData);
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
      return;
    }
    const isTextFile = TEXT_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!isTextFile) {
      setFileError("Only .txt/.md/.docx files can be read directly — for a legacy .doc or PDF, open it and paste the text instead.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setText(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setFileError("Couldn't read that file. Try pasting the text instead.");
    reader.readAsText(file);
    setFileName(file.name);
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
          include: true,
        })),
      );
      setCourseName(result.courseInfo.courseName ?? "");
      setFields(
        SCHOOL_COURSE_TEMPLATE.map((f) => {
          const raw = result.courseInfo[f.key];
          const value = Array.isArray(raw) ? raw.join("\n") : (raw ?? "");
          return { key: f.key, label: f.label, fieldType: f.fieldType, value };
        }),
      );
      setExams(result.examDates.map((e) => ({ type: e.type, dateYMD: e.date, notes: e.notes, include: true })));
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

  const canCreateClassSchedule = meetingDays.length > 0 && meetingStartTime && meetingEndTime && termStart;

  const handleImport = async () => {
    if (!rows) return;
    setIsImporting(true);
    setError(null);
    try {
      const tasks: SyllabusTaskInput[] = rows
        .filter((r) => r.include)
        .map((r) => ({ title: r.title, dueDateYMD: r.dueDateYMD }));
      const result = await importSyllabusCourseAction({
        courseName,
        useExistingProjectId: useExistingProjectId || null,
        fields: useExistingProjectId ? [] : fields,
        assigneeId: assigneeId || null,
        tasks,
        exams: exams.filter((e) => e.include).map((e) => ({ type: e.type, dateYMD: e.dateYMD, notes: e.notes })),
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
              Upload a file <span className="text-zinc-400">(.txt/.md/.docx — fills in the text below)</span>
            </span>
            <input
              type="file"
              accept=".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
                    ? "flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-xs font-semibold text-white dark:bg-indigo-500"
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
                  <span className="w-20 flex-shrink-0 capitalize text-zinc-500">{exam.type}</span>
                  <input type="date" value={exam.dateYMD ?? ""} onChange={(e) => updateExam(i, { dateYMD: e.target.value || null })} className={`${inputClass} flex-1`} />
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

          <div className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Assignments</span>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
                No deliverables found in that text.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((row, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
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
                    {row.notes && !row.dueDateYMD && (
                      <p className="w-full text-xs text-amber-600 dark:text-amber-400">
                        {row.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

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
