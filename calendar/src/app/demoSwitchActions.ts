"use server";

import { redirect } from "next/navigation";
import { endDemoSession, startDemoSession } from "@/lib/auth";

export async function enterDemoAction() {
  await startDemoSession();
  redirect("/home");
}

export async function leaveDemoAction() {
  await endDemoSession();
  redirect("/home");
}
