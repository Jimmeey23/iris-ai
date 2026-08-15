import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, staff, studios, tickets } from "@/db/schema";
import { createTicketFromDraft, addEvent } from "./tickets";
import { localEnrich } from "./enrich";
import { CATEGORY_DEPARTMENT, DEPARTMENTS, EMPLOYEES, categoriesForEmployee, colorFor, studioCodeForLocation } from "./org";
import { ensureMomenceDefaults } from "./settings";
import type { TicketDraft } from "./types";
import type { Priority } from "./taxonomy";

export const STUDIO_SEED = [
  { name: "Kwality House, Kemps Corner", code: "KC", city: "Mumbai", momenceLocationId: 9030, isHq: false },
  { name: "Supreme HQ, Bandra", code: "BAN", city: "Mumbai", momenceLocationId: null, isHq: false },
  { name: "Kenkere House, Indiranagar", code: "IND", city: "Bengaluru", momenceLocationId: null, isHq: false },
  { name: "Support Centre", code: "HQ", city: "India", momenceLocationId: null, isHq: true },
];

type SampleTicket = {
  category: string;
  subcategory: string;
  description: string;
  priority: Priority;
  studioCode: string;
  reportedBy: string;
  reportedByRole: string;
  raisedFor: string;
  memberName?: string;
  trainerName?: string;
  classInfo?: string;
  location?: string;
  systemAffected?: string;
  status: string;
  ageHours: number;
  resolvedAfterHours?: number;
  comment?: string;
};

const SAMPLES: SampleTicket[] = [
  { category: "Repair and Maintenance", subcategory: "AC and HVAC Issues", description: "The AC in the main studio stopped cooling before the 7:00 AM Barre 57 class. The room got very warm and three members stepped out mid-class.", priority: "High", studioCode: "KC", reportedBy: "Zahur Shaikh", reportedByRole: "Studio Coordinator", raisedFor: "Noticed by staff", location: "Main studio floor", classInfo: "7:00 AM Barre 57", status: "In Progress", ageHours: 26, comment: "Vendor technician scheduled today 4 PM. Portable coolers placed as interim." },
  { category: "Trainer Feedback", subcategory: "Trainer Punctuality Issues", description: "Member reported the 6:00 PM class began 8 minutes late and finished on time, so the cooldown was rushed.", priority: "Medium", studioCode: "BAN", reportedBy: "Shipra Pinge", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "On behalf of a member", memberName: "Ishita Rao", trainerName: "Reshma Sharma", classInfo: "6:00 PM Cardio Barre", status: "Open", ageHours: 9 },
  { category: "Theft and Lost Items", subcategory: "Locker Theft", description: "Member left gold earrings in locker 14 during the 9 AM class and found them missing after. Locker showed no damage. She is very upset and wants an investigation.", priority: "Critical", studioCode: "IND", reportedBy: "Sashi Singh", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "On behalf of a member", memberName: "Kavya Suresh", location: "Locker room", status: "In Progress", ageHours: 40, comment: "CCTV between 08:45 and 10:15 pulled and shared with compliance." },
  { category: "Operating Systems", subcategory: "Moments Notice", description: "Momence is not syncing today's class roster on the front desk iPad. Roster shows yesterday's bookings, had to check members in manually for two classes.", priority: "High", studioCode: "KC", reportedBy: "Zahur Shaikh", reportedByRole: "Studio Coordinator", raisedFor: "Noticed by staff", systemAffected: "Momence", status: "Open", ageHours: 5 },
  { category: "Pricing and Memberships", subcategory: "Auto-Renewal Concerns", description: "Member emailed on the 2nd to pause her membership, but the unlimited pack auto-renewed on the 5th. She wants a reversal and is threatening to cancel.", priority: "High", studioCode: "KC", reportedBy: "Vahishta Fitter", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "On behalf of a member", memberName: "Anjali Kothari", status: "Awaiting Info", ageHours: 62, comment: "Awaiting confirmation from finance on the reversal timeline." },
  { category: "Class Experience", subcategory: "Overcrowding in Class", description: "Saturday 10 AM Cardio Barre had 26 bookings for 22 spots after two walk-ins were added. Members had very little space between mats.", priority: "Medium", studioCode: "BAN", reportedBy: "Imran Shaikh", reportedByRole: "Sr. Sales & Client Servicing Associate", raisedFor: "Multiple members", classInfo: "Sat 10:00 AM Cardio Barre", status: "Resolved", ageHours: 120, resolvedAfterHours: 30, comment: "Weekend capacity cap reduced back to 22 in Momence." },
  { category: "Tech Issues", subcategory: "Mic Not Working", description: "Instructor headset mic keeps cutting out mid-class in Studio 2. Backup mic battery is also low.", priority: "High", studioCode: "IND", reportedBy: "Yashas K", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "Staff or trainer concern", location: "Studio 2", systemAffected: "Audio / mic system", status: "Open", ageHours: 3 },
  { category: "Studio Amenities and Facilities", subcategory: "Shower Water Pressure", description: "Two members mentioned shower 3 in the ladies change room has very low pressure since the weekend.", priority: "Medium", studioCode: "KC", reportedBy: "Nadiya Shaikh", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "Multiple members", location: "Showers / washroom", status: "In Progress", ageHours: 50 },
  { category: "Scheduling", subcategory: "Additional Classes", description: "Four working professionals asked for a later weekday slot at 8:30 PM since the 7:30 PM class is always full.", priority: "Low", studioCode: "BAN", reportedBy: "Deesha Changwani", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "Multiple members", status: "Open", ageHours: 80 },
  { category: "Customer Service and Communication", subcategory: "Delay in Response", description: "Member asked about transferring credits to her sister and hasn't received a reply for three days.", priority: "Medium", studioCode: "IND", reportedBy: "Api Serou", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "On behalf of a member", memberName: "Pooja Menon", status: "Resolved", ageHours: 96, resolvedAfterHours: 20, comment: "Called the member, credits transferred and apology sent." },
  { category: "Safety and Security", subcategory: "Emergency Exits Blocked", description: "New merchandise cartons were stacked in front of the rear fire exit corridor overnight. This is unsafe and must be cleared immediately.", priority: "Critical", studioCode: "BAN", reportedBy: "Saachi Shetty", reportedByRole: "Ops Manager", raisedFor: "Noticed by staff", location: "Other area", status: "Resolved", ageHours: 30, resolvedAfterHours: 3, comment: "Cartons relocated within the hour; daily checklist updated." },
  { category: "Brand Feedback", subcategory: "Merchandise Quality", description: "Three members mentioned the new branded leggings pill after a few washes. Boutique has 40 units in stock.", priority: "Low", studioCode: "KC", reportedBy: "Sheetal Kataria", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "Multiple members", location: "Boutique", status: "Open", ageHours: 150 },
  { category: "Miscellaneous", subcategory: "Music Volume Issues", description: "Lobby music is too loud during the 6-7 PM check-in rush; the front desk team struggles to hear members.", priority: "Low", studioCode: "IND", reportedBy: "Prathap K P", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "Noticed by staff", location: "Reception / lobby", status: "Closed", ageHours: 200, resolvedAfterHours: 48 },
  { category: "Class Experience", subcategory: "Studio Temperature Too Hot/Cold", description: "Early morning members find Studio 1 too cold; two asked for the AC to be raised by 2 degrees for the 6:30 AM class.", priority: "Medium", studioCode: "KC", reportedBy: "Taahira Sayyed", reportedByRole: "Sales & Client Servicing Associate", raisedFor: "Multiple members", location: "Main studio floor", classInfo: "6:30 AM Barre 57", status: "Open", ageHours: 14 },
  { category: "Trainer Feedback", subcategory: "Trainer Encouragement", description: "Member specifically praised the instructor for great encouragement and thoughtful modification options during the 5 PM class. Wonderful session.", priority: "Low", studioCode: "BAN", reportedBy: "Akshay Rane", reportedByRole: "Sr. Sales & Client Servicing Associate", raisedFor: "On behalf of a member", memberName: "Sneha Bhat", trainerName: "Janhavi Jain", classInfo: "5:00 PM Studio FIT", status: "Closed", ageHours: 168, resolvedAfterHours: 24, comment: "Shared with the training academy and noted for monthly recognition." },
  { category: "Repair and Maintenance", subcategory: "Broken Equipment Not Repaired", description: "Barre bars 4 and 5 on the left wall wobble when weight is applied. Cordoned off for now, needs a contractor visit.", priority: "High", studioCode: "IND", reportedBy: "Shifa Ali", reportedByRole: "Regional Head of Ops - South", raisedFor: "Noticed by staff", location: "Main studio floor", status: "In Progress", ageHours: 20 },
];

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

async function runSeed(): Promise<void> {
  await ensureMomenceDefaults().catch(() => {});
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(studios);
  if (count > 0) return;

  const insertedStudios = await db.insert(studios).values(STUDIO_SEED).returning();
  const byCode = new Map(insertedStudios.map((s) => [s.code, s]));

  await db.insert(departments).values(
    DEPARTMENTS.map((d) => ({ id: d.id, name: d.name, description: d.description, active: true })),
  );

  await db.insert(staff).values(
    EMPLOYEES.map((e) => {
      const code = studioCodeForLocation(e.location);
      return {
        externalId: e.id,
        name: e.name,
        email: e.email,
        role: e.role,
        department: e.department,
        location: e.location,
        manager: e.manager,
        studioId: code ? (byCode.get(code)?.id ?? null) : null,
        categories: categoriesForEmployee(e),
        avatarColor: colorFor(e.id),
        isActive: true,
      };
    }),
  );

  const now = Date.now();
  for (const sample of SAMPLES) {
    const studio = byCode.get(sample.studioCode);
    const createdAt = new Date(now - sample.ageHours * 3600 * 1000);
    const studioName = studio ? `${studio.name}, ${studio.city}` : "Not studio specific";
    const ai = localEnrich({
      text: sample.description,
      category: sample.category,
      subcategory: sample.subcategory,
      studioName,
      memberName: sample.memberName,
      trainerName: sample.trainerName,
    });

    const draft: TicketDraft = {
      category: sample.category,
      subcategory: sample.subcategory,
      title: ai.title,
      summary: ai.summary,
      description: sample.description,
      priority: sample.priority,
      studioId: studio?.id ?? null,
      studioName,
      reportedBy: sample.reportedBy,
      reportedByRole: sample.reportedByRole,
      raisedFor: sample.raisedFor,
      memberName: sample.memberName,
      trainerName: sample.trainerName,
      classInfo: sample.classInfo,
      location: sample.location,
      systemAffected: sample.systemAffected,
      occurredAt: sample.ageHours < 24 ? "Earlier today" : "Earlier this week",
      sentiment: ai.sentiment,
      emotion: ai.emotion,
      urgencyScore: ai.urgencyScore,
      churnRisk: ai.churnRisk,
      effort: ai.effort,
      rootCause: ai.rootCause,
      suggestedAction: ai.suggestedAction,
      aiConfidence: ai.confidence,
      aiEngine: ai.engine,
      severity: ai.severity,
      slaRespondHours: ai.slaRespondHours,
      slaResolveHours: ai.slaResolveHours,
      slaPolicy: ai.slaPolicy,
      slaReason: ai.slaReason,
      department: CATEGORY_DEPARTMENT[sample.category] ?? "Operations",
      tags: ai.tags,
      details: {},
      source: "AI Assistant",
      priorityReason: ai.priorityReason,
    };

    const ticket = await createTicketFromDraft(draft, { createdAt });
    if (sample.comment) await addEvent(ticket.id, "comment", ticket.assigneeName ?? "Owner", sample.comment);

    if (sample.status !== "Open") {
      const resolvedAt =
        sample.resolvedAfterHours != null
          ? new Date(createdAt.getTime() + sample.resolvedAfterHours * 3600 * 1000)
          : null;
      await db
        .update(tickets)
        .set({
          status: sample.status,
          resolvedAt: sample.status === "Resolved" || sample.status === "Closed" ? resolvedAt : null,
          updatedAt: resolvedAt ?? new Date(createdAt.getTime() + 3600 * 1000),
        })
        .where(eq(tickets.id, ticket.id));
      await addEvent(ticket.id, "status", ticket.assigneeName ?? "Owner", `Status changed from Open to ${sample.status}.`);
    }
  }
}
