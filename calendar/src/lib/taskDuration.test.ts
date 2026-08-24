import assert from "node:assert/strict";
import { DEFAULT_TASK_MINUTES, estimateTaskMinutes } from "./taskDuration";

// Real titles from the CNT A290 import that motivated this — a flat 30m
// booked every one of these identically.
assert.equal(estimateTaskMinutes("Assignment 9 - Lab 2 Build a VPC and Launch a Web Server"), 90);
assert.equal(estimateTaskMinutes("Assignment 13 - Lab 3 Introduction to Amazon EC2"), 90);
assert.equal(estimateTaskMinutes("Module 5 Knowledge Check"), 20);
assert.equal(estimateTaskMinutes("Discussion Board - Networking"), 30);
assert.equal(estimateTaskMinutes("Assignment 8 - Label Network Diagram"), 45);
assert.equal(estimateTaskMinutes("Course Final Exam"), 120);
assert.equal(estimateTaskMinutes("AWS Academy Registration"), 15);

// Specificity order matters: a lab that is also titled "Assignment" must
// score as a lab (90), not as a generic assignment (45). This is the
// rule the ordering exists to protect.
assert.equal(estimateTaskMinutes("Assignment 15 - Lab 4 Working with EBS AWS"), 90);

// An exam that is neither final nor midterm still reserves real time.
assert.equal(estimateTaskMinutes("Practical Exam"), 90);
assert.equal(estimateTaskMinutes("Midterm Exam 2"), 120);

// Written work.
assert.equal(estimateTaskMinutes("Term Paper Draft"), 120);
assert.equal(estimateTaskMinutes("Read Chapter 4"), 45);

// Administrative markers are reminders, not study blocks — booking two
// hours to "withdraw" would be actively wrong.
assert.equal(estimateTaskMinutes("Withdrawal Deadline"), 15);
assert.equal(estimateTaskMinutes("Add/Drop Deadline"), 15);

// Unknown titles fall back rather than guessing high.
assert.equal(estimateTaskMinutes("Something entirely unrecognized"), DEFAULT_TASK_MINUTES);
assert.equal(estimateTaskMinutes(""), DEFAULT_TASK_MINUTES);

// Word-boundary discipline: "collaborate" contains "lab" but is not a lab.
assert.equal(estimateTaskMinutes("Collaborate with your group"), DEFAULT_TASK_MINUTES);

console.log("taskDuration.test.ts: all checks passed");
