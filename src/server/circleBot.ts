import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export const CIRCLE_BOT_ID = "user_circle_assistant";

const WIB_OFFSET_MS = 7 * 3600000;

export const LOAD_STATUS_LABELS: Record<string, string> = {
  optimal: "Optimal",
  stabil: "Stabil",
  pressure: "Under Pressure"
};

function getWibDayIndex(dt: Date): number {
  return Math.floor((dt.getTime() + WIB_OFFSET_MS) / 86400000);
}

export function formatWibDateTime(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const day = wib.getUTCDate();
  const mon = months[wib.getUTCMonth()];
  const yr = wib.getUTCFullYear();
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${day} ${mon} ${yr}, ${hh}:${mm} WIB`;
}

function formatDurationLate(msLate: number): string {
  const totalMins = Math.max(1, Math.round(msLate / 60000));
  if (totalMins < 60) return `${totalMins} menit`;
  const totalHours = Math.floor(totalMins / 60);
  if (totalHours < 24) return `${totalHours} jam`;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days} hari ${remHours} jam` : `${days} hari`;
}

export function isHumanUser(u: any): boolean {
  if (!u) return false;
  return !u.is_bot && u.role !== "assistant" && u.user_id !== CIRCLE_BOT_ID;
}

export function isUserAssignedToTask(t: any, uid: string): boolean {
  if (!t || !uid) return false;
  return (Array.isArray(t.assignee_ids) && t.assignee_ids.includes(uid)) || t.assignee_id === uid;
}

export interface PersonWorkload {
  user_id: string;
  name: string;
  department: string;
  job_title: string;
  role: string;
  online: boolean;
  account_status: string;
  status: "optimal" | "stabil" | "pressure";
  status_label: string;
  status_reason: string;
  active: number;
  done: number;
  share: number;
  day_deadlines: number;
  due_by_tomorrow: number;
  today_rest: number;
  under_6h: number;
  overdue: number;
  min_hours_left: number | null;
  tasks: Array<{ id: string; number_str?: string; title: string; deadline: string | null; priority?: string; status?: string }>;
  all_active_tasks: Array<{ id: string; number_str?: string; title: string; deadline: string | null; priority?: string; status?: string }>;
  more: number;
}

export function computeWorkspaceWorkload(db: Record<string, any>, now = new Date(), anchor?: string) {
  const todayStr = now.toISOString().slice(0, 10);
  const effectiveAnchor = anchor || todayStr;
  const allTasks = Array.isArray(db.tasks) ? db.tasks : [];
  const allUsers = Array.isArray(db.users) ? db.users : [];
  const activeTasksTotal = allTasks.filter((t: any) => t.status !== "done" && !t.archived).length;
  const todayWibIdx = getWibDayIndex(now);

  const people: PersonWorkload[] = allUsers.filter(isHumanUser).map((u: any) => {
    const userTasks = allTasks.filter((t: any) => isUserAssignedToTask(t, u.user_id));
    const userActiveTasks = userTasks.filter((t: any) => t.status !== "done" && !t.archived);
    const userDoneTasks = userTasks.filter((t: any) => t.status === "done" || t.archived);
    const activeCount = userActiveTasks.length;
    const share = activeTasksTotal > 0 ? Math.round((activeCount / activeTasksTotal) * 100) : 0;
    const dayDeadlines = userActiveTasks.filter((t: any) => t.deadline && String(t.deadline).slice(0, 10) === effectiveAnchor).length;

    let overdueCount = 0;
    let under6hCount = 0;
    let todayRestCount = 0;
    let dueByTomorrowCount = 0;
    let minHoursLeft: number | null = null;

    userActiveTasks.forEach((t: any) => {
      if (!t.deadline) return;
      const dl = new Date(t.deadline);
      if (isNaN(dl.getTime())) return;
      const hoursLeft = (dl.getTime() - now.getTime()) / 3600000;
      if (minHoursLeft === null || hoursLeft < minHoursLeft) minHoursLeft = hoursLeft;

      const dayDiff = getWibDayIndex(dl) - todayWibIdx;
      if (hoursLeft <= 0) {
        overdueCount++;
        dueByTomorrowCount++;
      } else if (hoursLeft < 6) {
        under6hCount++;
        dueByTomorrowCount++;
      } else {
        if (dayDiff <= 0) todayRestCount++;
        if (dayDiff <= 1) dueByTomorrowCount++;
      }
    });

    let status: "optimal" | "stabil" | "pressure" = "optimal";
    let status_reason = "Tidak ada tugas aktif";

    if (activeCount === 0) {
      status = "optimal";
      status_reason = "Kapasitas tersedia penuh (0 tugas aktif)";
    } else if (overdueCount > 0) {
      status = "pressure";
      status_reason = `${overdueCount} tugas melewati tenggat waktu`;
    } else if (under6hCount > 0) {
      status = "pressure";
      const nearestH = minHoursLeft !== null ? Math.max(1, Math.ceil(minHoursLeft)) : 6;
      status_reason = `${under6hCount} tugas deadline < 6 jam (~${nearestH} jam lagi)`;
    } else if (dueByTomorrowCount >= 5) {
      status = "pressure";
      status_reason = `${dueByTomorrowCount} tugas harus disubmit ≤ besok`;
    } else if (activeCount >= 8) {
      status = "pressure";
      status_reason = `Beban sangat tinggi (${activeCount} tugas aktif)`;
    } else if (dueByTomorrowCount >= 3) {
      status = "stabil";
      status_reason = `${dueByTomorrowCount} tugas deadline ≤ besok (perlu fokus)`;
    } else if (todayRestCount > 0 || (minHoursLeft !== null && minHoursLeft < 18)) {
      status = "stabil";
      status_reason = `Ada deadline hari ini / < 18 jam (≥ 6 jam)`;
    } else if (activeCount >= 5) {
      status = "stabil";
      status_reason = `${activeCount} tugas aktif dengan deadline ≥ 2 hari`;
    } else if (dueByTomorrowCount > 0) {
      status = "optimal";
      status_reason = `${dueByTomorrowCount} tugas deadline 1 hari lagi (beban ringan)`;
    } else if (minHoursLeft !== null) {
      const daysLeft = Math.max(2, Math.floor(minHoursLeft / 24));
      status = "optimal";
      status_reason = `Deadline masih ${daysLeft}+ hari ke depan (${activeCount} tugas)`;
    } else {
      status = "optimal";
      status_reason = `${activeCount} tugas aktif tanpa tenggat mendesak`;
    }

    const mappedTasks = userActiveTasks.map((t: any) => ({
      id: t.id,
      number_str: t.number_str || (t.number ? `TSK-${String(t.number).padStart(3, "0")}` : undefined),
      title: t.title || "Tanpa Judul",
      deadline: t.deadline || null,
      priority: t.priority || "medium",
      status: t.status || "todo"
    }));

    return {
      user_id: u.user_id,
      name: u.name || u.email || u.user_id,
      department: u.department || "Umum",
      job_title: u.job_title || (u.role === "super_admin" ? "Super Administrator" : "Karyawan"),
      role: u.role || "member",
      online: Boolean(u.online),
      account_status: u.status || "active",
      status,
      status_label: LOAD_STATUS_LABELS[status] || status,
      status_reason,
      active: activeCount,
      done: userDoneTasks.length,
      share,
      day_deadlines: dayDeadlines,
      due_by_tomorrow: dueByTomorrowCount,
      today_rest: todayRestCount,
      under_6h: under6hCount,
      overdue: overdueCount,
      min_hours_left: minHoursLeft !== null ? Math.round(minHoursLeft * 10) / 10 : null,
      tasks: mappedTasks.slice(0, 3),
      all_active_tasks: mappedTasks,
      more: Math.max(0, userActiveTasks.length - 3)
    };
  });

  return {
    activeTasksTotal,
    people
  };
}

function normalizeText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildWorkspaceIntelligence(db: Record<string, any>, senderUser?: any, now = new Date()) {
  const allUsers = (Array.isArray(db.users) ? db.users : []).filter(isHumanUser);
  const userById = new Map<string, any>(allUsers.map((u: any) => [u.user_id, u]));
  const allBoards = Array.isArray(db.boards) ? db.boards : [];
  const boardById = new Map<string, any>(allBoards.map((b: any) => [b.id, b]));
  const allTasks = Array.isArray(db.tasks) ? db.tasks : [];
  const allProjects = Array.isArray(db.projects) ? db.projects : [];
  const allLabels = Array.isArray(db.labels) ? db.labels : [];
  const allPosts = Array.isArray(db.posts) ? db.posts : [];
  const allPolls = Array.isArray(db.polls) ? db.polls : [];
  const allConversations = Array.isArray(db.conversations) ? db.conversations : [];
  const allGroups = Array.isArray(db.groups) ? db.groups : [];
  const allMessages = Array.isArray(db.messages) ? db.messages : [];
  const allMeetings = Array.isArray(db.meetings) ? db.meetings : [];
  const allReminders = Array.isArray(db.reminders) ? db.reminders : [];
  const allDrive = Array.isArray(db.drive_shortcuts) ? db.drive_shortcuts : [];
  const allOrgUnits = Array.isArray(db.org_units) ? db.org_units : [];
  const allAccessReqs = Array.isArray(db.access_requests) ? db.access_requests : [];
  const allInvitations = Array.isArray(db.invitations) ? db.invitations : [];
  const allActivity = Array.isArray(db.activity) ? db.activity : [];

  const workload = computeWorkspaceWorkload(db, now);
  const personWorkloadById = new Map<string, PersonWorkload>(workload.people.map((p) => [p.user_id, p]));
  const todayWibIdx = getWibDayIndex(now);

  const formatTaskSummary = (t: any) => {
    const board = boardById.get(t.board_id);
    const assignees: string[] = [];
    if (Array.isArray(t.assignee_ids)) assignees.push(...t.assignee_ids);
    if (t.assignee_id && !assignees.includes(t.assignee_id)) assignees.push(t.assignee_id);
    const uniqueAssignees = Array.from(new Set(assignees));
    const assigneeNames = uniqueAssignees.map((uid) => userById.get(uid)?.name || uid);
    const dl = t.deadline ? new Date(t.deadline) : null;
    const dlValid = dl && !isNaN(dl.getTime());
    const isDone = t.status === "done" || Boolean(t.archived);
    const hoursLeft = dlValid ? (dl!.getTime() - now.getTime()) / 3600000 : null;
    const isOverdue = !isDone && hoursLeft !== null && hoursLeft <= 0;
    const isUnder6h = !isDone && hoursLeft !== null && hoursLeft > 0 && hoursLeft < 6;
    const dayDiff = dlValid ? getWibDayIndex(dl!) - todayWibIdx : null;
    const labelIds = Array.isArray(t.label_ids) ? t.label_ids : (Array.isArray(t.labels) ? t.labels : []);
    const labelNames = labelIds
      .map((lid: string) => allLabels.find((l: any) => l.id === lid || l.name === lid)?.name || lid)
      .filter(Boolean);

    return {
      id: t.id,
      number_str: t.number_str || (t.number ? `TSK-${String(t.number).padStart(3, "0")}` : t.id),
      title: t.title || "Tanpa Judul",
      status: t.status || "todo",
      priority: t.priority || "medium",
      archived: Boolean(t.archived),
      is_done: isDone,
      board_id: t.board_id || null,
      board_name: board?.name || board?.department || "Tanpa Board",
      board_department: board?.department || board?.name || null,
      project_id: t.project_id || null,
      assignee_ids: uniqueAssignees,
      assignee_names: assigneeNames,
      label_names: labelNames,
      deadline: t.deadline || null,
      deadline_wib: formatWibDateTime(t.deadline),
      hours_left: hoursLeft !== null ? Math.round(hoursLeft * 10) / 10 : null,
      day_diff: dayDiff,
      is_overdue: isOverdue,
      late_duration: isOverdue && dlValid ? formatDurationLate(now.getTime() - dl!.getTime()) : null,
      is_under_6h: isUnder6h,
      is_due_today: !isDone && dayDiff !== null && dayDiff === 0 && !isOverdue,
      is_due_tomorrow: !isDone && dayDiff !== null && dayDiff === 1
    };
  };

  const enrichedTasks = allTasks.map(formatTaskSummary);
  const activeTasks = enrichedTasks.filter((t) => !t.is_done);
  const doneTasks = enrichedTasks.filter((t) => t.is_done);
  const overdueTasks = enrichedTasks.filter((t) => t.is_overdue);
  const under6hTasks = enrichedTasks.filter((t) => t.is_under_6h);
  const dueTodayTasks = enrichedTasks.filter((t) => t.is_due_today);
  const dueTomorrowTasks = enrichedTasks.filter((t) => t.is_due_tomorrow);

  // Build division names map (case-insensitive canonical names)
  const divisionMap = new Map<string, string>();
  const registerDivision = (raw?: string) => {
    const clean = String(raw || "").trim();
    if (!clean || clean.toLowerCase() === "system") return;
    const key = clean.toLowerCase();
    if (!divisionMap.has(key)) divisionMap.set(key, clean);
  };
  allBoards.forEach((b: any) => registerDivision(b.department || b.name));
  allOrgUnits.forEach((o: any) => registerDivision(o.name));
  allUsers.forEach((u: any) => registerDivision(u.department));

  const divisions = Array.from(divisionMap.entries()).map(([key, name]) => {
    const members = allUsers.filter((u: any) => String(u.department || "").trim().toLowerCase() === key);
    const memberIds = new Set(members.map((m: any) => m.user_id));
    const memberWorkloads = members.map((m: any) => personWorkloadById.get(m.user_id)).filter(Boolean) as PersonWorkload[];
    const matchingBoards = allBoards.filter(
      (b: any) => String(b.department || b.name || "").trim().toLowerCase() === key
    );
    const boardIds = new Set(matchingBoards.map((b: any) => b.id));

    // Tasks belonging to this division (on division board OR assigned to a division member)
    const divTasks = enrichedTasks.filter(
      (t) => (t.board_id && boardIds.has(t.board_id)) || t.assignee_ids.some((uid) => memberIds.has(uid))
    );
    const divActive = divTasks.filter((t) => !t.is_done);
    const divDone = divTasks.filter((t) => t.is_done);
    const divOverdue = divTasks.filter((t) => t.is_overdue);
    const divUnder6h = divTasks.filter((t) => t.is_under_6h);
    const divDueToday = divTasks.filter((t) => t.is_due_today);
    const divDueTomorrow = divTasks.filter((t) => t.is_due_tomorrow);

    const optimalMembers = memberWorkloads.filter((m) => m.status === "optimal").length;
    const stabilMembers = memberWorkloads.filter((m) => m.status === "stabil").length;
    const pressureMembers = memberWorkloads.filter((m) => m.status === "pressure").length;

    let loadStatus: "optimal" | "stabil" | "pressure" = "optimal";
    let loadReason = "Semua anggota dalam kapasitas optimal";
    if (pressureMembers > 0 || divOverdue.length > 0 || divUnder6h.length > 0) {
      loadStatus = "pressure";
      const reasons: string[] = [];
      if (divOverdue.length > 0) reasons.push(`${divOverdue.length} tugas telat/overdue`);
      if (divUnder6h.length > 0) reasons.push(`${divUnder6h.length} tugas deadline < 6 jam`);
      if (pressureMembers > 0) reasons.push(`${pressureMembers} anggota berstatus Under Pressure`);
      loadReason = reasons.join(", ");
    } else if (stabilMembers > 0 || divDueTomorrow.length >= 3 || divActive.length >= Math.max(5, members.length * 4)) {
      loadStatus = "stabil";
      const reasons: string[] = [];
      if (stabilMembers > 0) reasons.push(`${stabilMembers} anggota berstatus Stabil`);
      if (divDueTomorrow.length >= 3) reasons.push(`${divDueTomorrow.length} tugas deadline ≤ besok`);
      if (!reasons.length) reasons.push(`${divActive.length} tugas aktif berjalan`);
      loadReason = reasons.join(", ");
    } else if (divActive.length === 0) {
      loadStatus = "optimal";
      loadReason = "Belum ada tugas aktif (kapasitas tersedia penuh)";
    } else {
      loadStatus = "optimal";
      loadReason = `${divActive.length} tugas aktif, tanpa deadline mendesak/terlambat`;
    }

    const shareOfWorkspaceActive = activeTasks.length > 0
      ? Math.round((divActive.length / activeTasks.length) * 100)
      : 0;

    return {
      key,
      name,
      member_count: members.length,
      online_count: members.filter((m: any) => m.online).length,
      members: memberWorkloads,
      boards: matchingBoards.map((b: any) => ({ id: b.id, name: b.name })),
      total_tasks: divTasks.length,
      active_tasks_count: divActive.length,
      done_tasks_count: divDone.length,
      overdue_tasks: divOverdue,
      under_6h_tasks: divUnder6h,
      due_today_tasks: divDueToday,
      due_tomorrow_tasks: divDueTomorrow,
      active_tasks: divActive,
      share_percent: shareOfWorkspaceActive,
      load_status: loadStatus,
      load_status_label: LOAD_STATUS_LABELS[loadStatus],
      load_reason: loadReason,
      member_status_counts: {
        optimal: optimalMembers,
        stabil: stabilMembers,
        pressure: pressureMembers
      }
    };
  });

  // Task breakdowns
  const statusCounts: Record<string, number> = {};
  const priorityCounts: Record<string, number> = {};
  enrichedTasks.forEach((t) => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
  });

  const labelBreakdown = allLabels.map((l: any) => {
    const matched = enrichedTasks.filter((t) => t.label_names.includes(l.name));
    return {
      id: l.id,
      name: l.name,
      total: matched.length,
      active: matched.filter((t) => !t.is_done).length,
      done: matched.filter((t) => t.is_done).length,
      overdue: matched.filter((t) => t.is_overdue).length
    };
  });

  const projectSummaries = allProjects.map((p: any) => {
    const pTasks = enrichedTasks.filter((t) => t.project_id === p.id);
    const pDone = pTasks.filter((t) => t.is_done).length;
    const pOverdue = pTasks.filter((t) => t.is_overdue).length;
    const pct = pTasks.length > 0 ? Math.round((pDone / pTasks.length) * 100) : 0;
    return {
      id: p.id,
      name: p.name,
      status: p.status || "active",
      total_tasks: pTasks.length,
      done_tasks: pDone,
      active_tasks: pTasks.length - pDone,
      overdue_tasks: pOverdue,
      progress_percent: pct
    };
  });

  const mainPosts = allPosts.filter((p: any) => !p.parent_id);
  const postComments = allPosts.filter((p: any) => Boolean(p.parent_id));
  const sortedPosts = [...mainPosts].sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const topPosts = [...mainPosts].sort((a: any, b: any) => (b.likes?.length || 0) - (a.likes?.length || 0));

  const groupConvs = allConversations.filter((c: any) => c.type === "group");
  const dmConvs = allConversations.filter((c: any) => c.type === "dm");

  const pollSummaries = allPolls.map((p: any) => {
    const options = Array.isArray(p.options) ? p.options : [];
    const totalVotes = options.reduce((sum: number, o: any) => sum + (Array.isArray(o.votes) ? o.votes.length : (o.count || 0)), 0);
    return {
      id: p.id,
      question: p.question || "Polling",
      total_votes: totalVotes,
      closed: Boolean(p.closed),
      options: options.map((o: any) => ({
        text: o.text || o.label || "",
        votes: Array.isArray(o.votes) ? o.votes.length : (o.count || 0)
      }))
    };
  });

  const upcomingMeetings = [...allMeetings]
    .filter((m: any) => {
      const start = new Date(m.start || m.start_time || m.date || 0);
      return isNaN(start.getTime()) || start.getTime() >= now.getTime() - 3600000;
    })
    .sort((a: any, b: any) => new Date(a.start || a.start_time || 0).getTime() - new Date(b.start || b.start_time || 0).getTime());

  const pendingAccessReqs = allAccessReqs.filter((r: any) => r.status === "pending");
  const pendingInvites = allInvitations.filter((inv: any) => !inv.status || inv.status === "pending");

  const myWorkload = senderUser?.user_id ? personWorkloadById.get(senderUser.user_id) || null : null;
  const myTasks = senderUser?.user_id
    ? enrichedTasks.filter((t) => t.assignee_ids.includes(senderUser.user_id))
    : [];

  return {
    generated_at_wib: formatWibDateTime(now.toISOString()),
    workspace_name: db.workspace?.name || "CIRCLE Workspace",
    employees: {
      total: allUsers.length,
      active: allUsers.filter((u: any) => (u.status || "active") === "active").length,
      inactive: allUsers.filter((u: any) => u.status && u.status !== "active").length,
      online: allUsers.filter((u: any) => Boolean(u.online)).length,
      list: workload.people.map((p) => ({
        user_id: p.user_id,
        name: p.name,
        department: p.department,
        job_title: p.job_title,
        role: p.role,
        online: p.online,
        load_status: p.status_label,
        active_tasks: p.active,
        overdue_tasks: p.overdue
      }))
    },
    workload_summary: {
      total_active_tasks: activeTasks.length,
      optimal_count: workload.people.filter((p) => p.status === "optimal").length,
      stabil_count: workload.people.filter((p) => p.status === "stabil").length,
      pressure_count: workload.people.filter((p) => p.status === "pressure").length,
      people: workload.people
    },
    divisions,
    tasks: {
      total: enrichedTasks.length,
      active: activeTasks.length,
      done: doneTasks.length,
      archived: enrichedTasks.filter((t) => t.archived).length,
      unassigned_active: activeTasks.filter((t) => t.assignee_ids.length === 0).length,
      overdue_count: overdueTasks.length,
      overdue_list: overdueTasks,
      under_6h_count: under6hTasks.length,
      under_6h_list: under6hTasks,
      due_today_count: dueTodayTasks.length,
      due_today_list: dueTodayTasks,
      due_tomorrow_count: dueTomorrowTasks.length,
      due_tomorrow_list: dueTomorrowTasks,
      by_status: statusCounts,
      by_priority: priorityCounts,
      by_label: labelBreakdown,
      all_active: activeTasks
    },
    my_summary: senderUser ? {
      user_id: senderUser.user_id,
      name: senderUser.name,
      department: senderUser.department,
      workload: myWorkload,
      tasks_total: myTasks.length,
      tasks_active: myTasks.filter((t) => !t.is_done),
      tasks_overdue: myTasks.filter((t) => t.is_overdue),
      tasks_done: myTasks.filter((t) => t.is_done)
    } : null,
    projects: projectSummaries,
    boards: allBoards.map((b: any) => ({
      id: b.id,
      name: b.name,
      department: b.department || b.name,
      tasks_total: enrichedTasks.filter((t) => t.board_id === b.id).length,
      tasks_active: activeTasks.filter((t) => t.board_id === b.id).length,
      tasks_overdue: overdueTasks.filter((t) => t.board_id === b.id).length
    })),
    feed: {
      posts_count: mainPosts.length,
      comments_count: postComments.length,
      latest_posts: sortedPosts.slice(0, 5).map((p: any) => ({
        author: userById.get(p.user_id || p.author_id)?.name || p.author_name || "Anggota",
        created_at: formatWibDateTime(p.created_at),
        content: String(p.content || p.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140),
        likes: Array.isArray(p.likes) ? p.likes.length : 0,
        comments: postComments.filter((c: any) => c.parent_id === p.id).length
      })),
      top_post: topPosts[0] ? {
        author: userById.get(topPosts[0].user_id || topPosts[0].author_id)?.name || "Anggota",
        content: String(topPosts[0].content || topPosts[0].text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120),
        likes: Array.isArray(topPosts[0].likes) ? topPosts[0].likes.length : 0
      } : null
    },
    chat: {
      groups_count: groupConvs.length || allGroups.length,
      dm_count: dmConvs.length,
      messages_count: allMessages.length,
      groups: groupConvs.map((g: any) => ({
        name: g.name || "Grup",
        members_count: (g.member_ids || g.members || []).filter((id: string) => id !== CIRCLE_BOT_ID).length
      }))
    },
    polls: pollSummaries,
    meetings: {
      total: allMeetings.length,
      upcoming: upcomingMeetings.slice(0, 5).map((m: any) => ({
        title: m.title || m.name || "Meeting",
        when: formatWibDateTime(m.start || m.start_time || m.date),
        location: m.location || m.link || "-"
      }))
    },
    reminders: {
      total: allReminders.length,
      pending: allReminders.filter((r: any) => !r.done).map((r: any) => ({ title: r.title || r.text || "Pengingat", due: r.due || r.date || null }))
    },
    drive: {
      total: allDrive.length,
      items: allDrive.map((d: any) => ({ title: d.title || d.name, division: d.division || d.department || "Umum" }))
    },
    access_requests: {
      pending_count: pendingAccessReqs.length,
      pending_list: pendingAccessReqs.map((r: any) => ({
        name: r.name,
        email: r.email,
        department: r.department || "General",
        type: r.type || "join"
      })),
      pending_invitations_count: pendingInvites.length
    },
    activity_recent: allActivity.slice(0, 6).map((a: any) => a.text || a.title || a.action || "").filter(Boolean)
  };
}

const DIVISION_ALIASES: Record<string, string[]> = {
  marketing: ["marketing", "mkt", "pemasaran", "iklan", "konten", "creative", "sosmed"],
  sales: ["sales", "penjualan", "bisnis", "komersial", "bd"],
  it: ["it", "teknologi", "engineering", "developer", "dev", "tech", "sistem", "infra"],
  finance: ["finance", "keuangan", "akunting", "accounting", "fin", "pajak"],
  legal: ["legal", "hukum", "kontrak", "compliance"],
  hrga: ["hrga", "hr", "ga", "sdm", "personalia", "rekrutmen", "hc"],
  management: ["management", "manajemen", "direksi", "eksekutif", "pimpinan", "mgmt"]
};

function findMentionedDivision(norm: string, intel: ReturnType<typeof buildWorkspaceIntelligence>) {
  // Check exact/substring match with actual division names first
  for (const div of intel.divisions) {
    const divNorm = normalizeText(div.name);
    if (divNorm && new RegExp(`\\b${divNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(norm)) {
      return div;
    }
  }
  // Check aliases
  for (const div of intel.divisions) {
    const aliases = DIVISION_ALIASES[div.key] || [];
    if (aliases.some((al) => new RegExp(`\\b${al}\\b`, "i").test(norm))) {
      return div;
    }
  }
  return null;
}

function findMentionedPerson(norm: string, intel: ReturnType<typeof buildWorkspaceIntelligence>) {
  for (const p of intel.workload_summary.people) {
    const full = normalizeText(p.name);
    if (full && norm.includes(full)) return p;
    const tokens = full.split(" ").filter((tok) => tok.length >= 3);
    if (tokens.some((tok) => !["admin", "team", "tim", "divisi"].includes(tok) && new RegExp(`\\b${tok}\\b`, "i").test(norm))) {
      return p;
    }
  }
  return null;
}

function findMentionedLabel(norm: string, intel: ReturnType<typeof buildWorkspaceIntelligence>) {
  for (const lbl of intel.tasks.by_label) {
    const ln = normalizeText(lbl.name);
    if (ln && norm.includes(ln)) return lbl;
  }
  return null;
}

function findMentionedProject(norm: string, intel: ReturnType<typeof buildWorkspaceIntelligence>) {
  for (const prj of intel.projects) {
    const pn = normalizeText(prj.name);
    if (pn && norm.includes(pn)) return prj;
  }
  return null;
}

function formatTaskListLines(tasks: any[], limit = 8): string {
  if (!tasks.length) return "- Tidak ada.";
  const slice = tasks.slice(0, limit);
  const lines = slice.map((t) => {
    const pic = t.assignee_names?.length ? t.assignee_names.join(", ") : "Belum di-assign";
    const dlInfo = t.is_overdue
      ? `telat ${t.late_duration} (${t.deadline_wib})`
      : (t.deadline ? t.deadline_wib : "tanpa deadline");
    return `• **${t.number_str}** — ${t.title} | PIC: ${pic} | Board: ${t.board_name} | ${dlInfo}`;
  });
  if (tasks.length > limit) {
    lines.push(`• ...dan ${tasks.length - limit} tugas lainnya.`);
  }
  return lines.join("\n");
}

function buildCapabilityHelpMessage(intel: ReturnType<typeof buildWorkspaceIntelligence>): string {
  const divNames = intel.divisions.map((d) => d.name).join(", ") || "Marketing, Sales, IT, Finance, Legal, HRGA, Management";
  return [
    `Halo! Saya **Circle**, asisten analitik & workspace **${intel.workspace_name}**.`,
    `Anda bisa menanyakan apa saja seputar data langsung workspace saat ini, misalnya:`,
    ``,
    `👥 **Karyawan & Organisasi**`,
    `• "Berapa jumlah karyawan saat ini?" / "Siapa saja di divisi Marketing?" / "Siapa yang sedang online?"`,
    ``,
    `📊 **Load & Beban Kerja (Optimal / Stabil / Under Pressure)**`,
    `• "Berapa load team Marketing?" / "Bagaimana beban kerja semua tim?" / "Siapa yang Under Pressure?"`,
    ``,
    `⏰ **Tugas Telat & Deadline**`,
    `• "Berapa jumlah tugas yang telat di team Marketing?" / "Tugas apa saja yang overdue?" / "Deadline hari ini / < 6 jam / besok?"`,
    ``,
    `📌 **Task, Proyek, Brand & Tugas Saya**`,
    `• "Berapa total task & breakdown statusnya?" / "Tugas saya apa saja?" / "Progress proyek saat ini?" / "Task brand ASLI RI?"`,
    ``,
    `💬 **Beranda, Chat, Polling, Meeting & Akses**`,
    `• "Feed Beranda terbaru?" / "Hasil polling?" / "Jadwal meeting terdekat?" / "Ada permintaan akses pending?" / "Ringkasan semua data"`,
    ``,
    `⚡ **Aksi Cepat:** Ketik \`/task [judul tugas]\` atau \`buat task [judul tugas]\` untuk langsung membuat task baru.`,
    `_Divisi terpantau: ${divNames}_`
  ].join("\n");
}

function formatFullOverview(intel: ReturnType<typeof buildWorkspaceIntelligence>): string {
  const topDivs = intel.divisions.map((d) => {
    const lateTag = d.overdue_tasks.length > 0 ? `, ${d.overdue_tasks.length} telat` : "";
    return `• **${d.name}** (${d.member_count} orang): **${d.load_status_label}** — ${d.active_tasks_count} aktif${lateTag}, ${d.done_tasks_count} selesai`;
  });

  const sections: string[] = [
    `📊 **Ringkasan Lengkap Workspace (${intel.generated_at_wib})**`,
    ``,
    `👥 **Karyawan:** **${intel.employees.total} orang** (${intel.employees.active} aktif, ${intel.employees.online} sedang online)`,
    `⚡ **Beban Kerja Karyawan:** ${intel.workload_summary.optimal_count} Optimal · ${intel.workload_summary.stabil_count} Stabil · ${intel.workload_summary.pressure_count} Under Pressure`,
    `📌 **Tugas (Task):** **${intel.tasks.total} total** (${intel.tasks.active} aktif, ${intel.tasks.done} selesai, **${intel.tasks.overdue_count} telat/overdue**, ${intel.tasks.under_6h_count} deadline <6 jam)`,
    `🗂️ **Proyek & Board:** ${intel.projects.length} proyek · ${intel.boards.length} board divisi`,
    `📰 **Beranda & Chat:** ${intel.feed.posts_count} postingan (${intel.feed.comments_count} komentar) · ${intel.chat.groups_count} grup chat · ${intel.polls.length} polling`,
    `📅 **Jadwal & Akses:** ${intel.meetings.upcoming.length} meeting mendatang · ${intel.access_requests.pending_count} permintaan akses pending · ${intel.drive.total} shortcut Drive`,
    ``,
    `🏢 **Status Load per Divisi:**`,
    ...topDivs
  ];

  if (intel.tasks.overdue_count > 0) {
    sections.push(``, `🚨 **Tugas Telat Teratas:**`, formatTaskListLines(intel.tasks.overdue_list, 3));
  }

  return sections.join("\n");
}

export function answerWorkspaceQuestionDeterministically(
  question: string,
  db: Record<string, any>,
  senderUser?: any,
  now = new Date()
): string {
  const intel = buildWorkspaceIntelligence(db, senderUser, now);
  const norm = normalizeText(question);

  if (!norm) {
    return buildCapabilityHelpMessage(intel);
  }

  const targetDiv = findMentionedDivision(norm, intel);
  const targetPerson = findMentionedPerson(norm, intel);
  const targetLabel = findMentionedLabel(norm, intel);
  const targetProject = findMentionedProject(norm, intel);
  const asksAboutMe = /\b(saya|aku|punyaku|milikku|taskku|tugasku|gue|gw)\b/i.test(norm);

  const hasOverdueKw = /(telat|terlambat|terlewat|overdue|molor|lewat batas|lewat deadline|lewat tenggat)/i.test(norm);
  const hasDeadlineKw = /(deadline|tenggat|jatuh tempo|6 jam|hari ini|besok|mendesak|urgent deadline)/i.test(norm);
  const hasLoadKw = /(\bload\b|beban|kapasitas|workload|optimal|stabil|pressure|under pressure|sibuk|padat|luang|santai|kosong|overload|performa tim|kondisi tim)/i.test(norm);
  const hasEmployeeKw = /(karyawan|pegawai|karyawati|staff|staf|\bmbr\b|member|anggota|orang|personil|sdm|headcount|siapa saja|siapa aja|online|hadir)/i.test(norm);
  const hasTaskKw = /(task|tugas|pekerjaan|kerjaan|todo|progress|review|done|selesai|prioritas|urgent|high|medium|low|kanban)/i.test(norm);
  const hasOverviewKw = /(ringkasan|overview|summary|laporan|briefing|semua data|rekap|statistik|dashboard|apa kabar workspace|kondisi workspace)/i.test(norm);
  const hasHelpKw = /^(halo|hai|hi|hello|pagi|siang|sore|malam|tes|test|p)\b|(\bbantuan\b|\bhelp\b|bisa apa|bisa tanya|fitur|perintah|panduan|menu)/i.test(norm);
  const hasAccessKw = /(akses|permintaan|request|approval|setuju|undangan|invite|pending)/i.test(norm);
  const hasProjectKw = /(proyek|project)/i.test(norm);
  const hasBoardKw = /(board|papan|divisi|departemen|struktur|organisasi|org)/i.test(norm);
  const hasFeedKw = /(feed|beranda|postingan|post|trending|pengumuman|berita)/i.test(norm);
  const hasPollKw = /(poll|polling|voting|vote|suara|survey|survei)/i.test(norm);
  const hasChatKw = /(grup|group|chat|percakapan|pesan|obrolan)/i.test(norm);
  const hasMeetingKw = /(meeting|rapat|jadwal|agenda|kalender|event)/i.test(norm);
  const hasReminderKw = /(reminder|pengingat)/i.test(norm);
  const hasDriveKw = /(drive|dokumen|file|folder|shortcut)/i.test(norm);
  const hasActivityKw = /(aktivitas|activity|riwayat|history|log)/i.test(norm);

  // Greeting / Help (only when it's strictly greeting or asking what bot can do, without specific data query)
  if (hasHelpKw && !hasOverdueKw && !hasLoadKw && !hasEmployeeKw && !hasTaskKw && !hasOverviewKw && !hasProjectKw && !hasFeedKw && !hasPollKw && !hasMeetingKw && !hasAccessKw && !targetDiv) {
    return buildCapabilityHelpMessage(intel);
  }

  // Full Overview
  if (hasOverviewKw && !targetDiv && !targetPerson && !hasOverdueKw && !hasLoadKw && !hasEmployeeKw) {
    return formatFullOverview(intel);
  }

  const answerBlocks: string[] = [];

  // 1. Specific Division / Team queries (e.g. "load team marketing", "tugas telat team marketing", "karyawan marketing")
  if (targetDiv) {
    const matchedMultipleSpecific = (hasEmployeeKw ? 1 : 0) + (hasLoadKw ? 1 : 0) + (hasOverdueKw ? 1 : 0);

    if (hasOverdueKw) {
      answerBlocks.push(
        `⏰ **Tugas Telat (Overdue) — Tim ${targetDiv.name}: ${targetDiv.overdue_tasks.length} tugas**` +
        (targetDiv.overdue_tasks.length > 0
          ? `\n${formatTaskListLines(targetDiv.overdue_tasks, 10)}`
          : `\nSemua tugas di tim **${targetDiv.name}** masih sesuai tenggat waktu (tidak ada yang terlambat).`)
      );
    }

    if (hasLoadKw || (!hasOverdueKw && !hasEmployeeKw && !hasDeadlineKw)) {
      const mLines = targetDiv.members.length > 0
        ? targetDiv.members.map((m) => `• **${m.name}** (${m.job_title}): **${m.status_label}** — ${m.active} tugas aktif (${m.share}% beban workspace) · _${m.status_reason}_`).join("\n")
        : "• Belum ada anggota yang terdaftar di divisi ini.";

      answerBlocks.push([
        `📊 **Load / Beban Kerja Tim ${targetDiv.name}: ${targetDiv.load_status_label}**`,
        `• Alasan status: ${targetDiv.load_reason}`,
        `• Anggota tim: **${targetDiv.member_count} orang** (${targetDiv.member_status_counts.optimal} Optimal, ${targetDiv.member_status_counts.stabil} Stabil, ${targetDiv.member_status_counts.pressure} Under Pressure)`,
        `• Beban tugas tim: **${targetDiv.active_tasks_count} aktif** (${targetDiv.share_percent}% dari total tugas aktif workspace) · **${targetDiv.done_tasks_count} selesai** · **${targetDiv.overdue_tasks.length} telat** · **${targetDiv.under_6h_tasks.length} deadline < 6 jam** · **${targetDiv.due_tomorrow_tasks.length} deadline besok**`,
        ``,
        `👤 **Rincian Beban per Anggota ${targetDiv.name}:**`,
        mLines
      ].join("\n"));
    }

    if (hasEmployeeKw) {
      const empLines = targetDiv.members.length > 0
        ? targetDiv.members.map((m) => `• **${m.name}** — ${m.job_title} (${m.online ? "Online" : "Offline"} · Load: ${m.status_label}, ${m.active} tugas aktif)`).join("\n")
        : "• Belum ada karyawan di divisi ini.";
      answerBlocks.push(`👥 **Anggota Tim ${targetDiv.name}: ${targetDiv.member_count} orang** (${targetDiv.online_count} online)\n${empLines}`);
    }

    if (hasDeadlineKw && !hasOverdueKw) {
      const urgentDiv = [...targetDiv.overdue_tasks, ...targetDiv.under_6h_tasks, ...targetDiv.due_today_tasks, ...targetDiv.due_tomorrow_tasks];
      const uniqueUrgent = Array.from(new Map(urgentDiv.map((t) => [t.id, t])).values());
      answerBlocks.push(
        `📅 **Deadline Mendesak Tim ${targetDiv.name}:**\n` +
        `• Telat: ${targetDiv.overdue_tasks.length} | < 6 jam: ${targetDiv.under_6h_tasks.length} | Hari ini: ${targetDiv.due_today_tasks.length} | Besok: ${targetDiv.due_tomorrow_tasks.length}\n` +
        (uniqueUrgent.length > 0 ? formatTaskListLines(uniqueUrgent, 8) : "• Tidak ada tugas dengan deadline mendesak dalam 2 hari ke depan.")
      );
    }

    if (hasTaskKw && !hasOverdueKw && !hasLoadKw && !hasDeadlineKw && matchedMultipleSpecific === 0) {
      answerBlocks.push(
        `📌 **Daftar Tugas Tim ${targetDiv.name}:** ${targetDiv.total_tasks} total (${targetDiv.active_tasks_count} aktif, ${targetDiv.done_tasks_count} selesai, ${targetDiv.overdue_tasks.length} telat)\n` +
        (targetDiv.active_tasks.length > 0 ? formatTaskListLines(targetDiv.active_tasks, 8) : "• Tidak ada tugas aktif di tim ini.")
      );
    }

    if (answerBlocks.length > 0) return answerBlocks.join("\n\n");
  }

  // 2. Specific Person (or "Tugas saya / load saya")
  if (targetPerson || (asksAboutMe && intel.my_summary)) {
    const person = targetPerson || intel.my_summary?.workload;
    if (person) {
      const personTasks = intel.tasks.all_active.filter((t) => t.assignee_ids.includes(person.user_id));
      const personOverdue = intel.tasks.overdue_list.filter((t) => t.assignee_ids.includes(person.user_id));

      if (hasOverdueKw) {
        return `⏰ **Tugas Telat ${person.name}: ${personOverdue.length} tugas**\n` +
          (personOverdue.length > 0 ? formatTaskListLines(personOverdue, 8) : `Tidak ada tugas ${person.name} yang melewati tenggat waktu.`);
      }
      return [
        `👤 **Profil & Beban Kerja: ${person.name}** (${person.department} · ${person.job_title})`,
        `• Status Load: **${person.status_label}** — ${person.status_reason}`,
        `• Tugas Aktif: **${person.active} tugas** (${person.share}% beban workspace) · Selesai: **${person.done}** · Telat: **${person.overdue}** · Deadline < 6 jam: **${person.under_6h}**`,
        ``,
        `📌 **Tugas Aktif ${person.name}:**`,
        personTasks.length > 0 ? formatTaskListLines(personTasks, 8) : "• Tidak ada tugas aktif saat ini."
      ].join("\n");
    }
  }

  // 3. Employees / Members count & list
  if (hasEmployeeKw) {
    const byDeptLines = intel.divisions
      .filter((d) => d.member_count > 0)
      .map((d) => {
        const names = d.members.map((m) => `${m.name}${m.online ? " 🟢" : ""}`).join(", ");
        return `• **${d.name}**: ${d.member_count} orang (${names})`;
      });
    const emptyDepts = intel.divisions.filter((d) => d.member_count === 0).map((d) => d.name);

    const empText = [
      `👥 **Data Karyawan ${intel.workspace_name}**`,
      `• Total Karyawan: **${intel.employees.total} orang** (${intel.employees.active} aktif, ${intel.employees.online} sedang online)`,
      ...(intel.employees.inactive > 0 ? [`• Nonaktif/Suspended: ${intel.employees.inactive} orang`] : []),
      ...(intel.access_requests.pending_count > 0 ? [`• Menunggu Persetujuan Akses: ${intel.access_requests.pending_count} orang`] : []),
      ``,
      `🏢 **Sebaran per Divisi:**`,
      ...(byDeptLines.length ? byDeptLines : ["• Belum ada karyawan terdaftar."]),
      ...(emptyDepts.length ? [`• _Divisi belum memiliki anggota: ${emptyDepts.join(", ")}_`] : [])
    ].join("\n");
    answerBlocks.push(empText);
  }

  // 4. Overdue / Late tasks (Workspace-wide)
  if (hasOverdueKw) {
    const divLateSummary = intel.divisions
      .filter((d) => d.overdue_tasks.length > 0)
      .map((d) => `• **${d.name}**: ${d.overdue_tasks.length} tugas telat`)
      .join("\n");

    answerBlocks.push([
      `⏰ **Laporan Tugas Telat (Overdue) Workspace: ${intel.tasks.overdue_count} tugas**`,
      intel.tasks.overdue_count > 0
        ? `Sebaran per Divisi:\n${divLateSummary || "- Tersebar di board"}\n\n📋 **Daftar Tugas Telat:**\n${formatTaskListLines(intel.tasks.overdue_list, 10)}`
        : `Semua **${intel.tasks.active} tugas aktif** berada dalam tenggat waktu (0 tugas terlambat).`
    ].join("\n"));
  }

  // 5. Global Workload / Load (Optimal / Stabil / Under Pressure)
  if (hasLoadKw) {
    const wantsBusiest = /(paling sibuk|paling padat|terpadat|overload|paling berat|under pressure|tertinggi)/i.test(norm);
    const wantsFree = /(paling santai|paling luang|kosong|tersedia|available|ringan|terendah)/i.test(norm);

    const sortedPeople = [...intel.workload_summary.people].sort((a, b) => {
      const rank = { pressure: 3, stabil: 2, optimal: 1 };
      return (rank[b.status] - rank[a.status]) || (b.active - a.active);
    });

    const filteredPeople = wantsBusiest
      ? sortedPeople.filter((p) => p.status === "pressure" || p.active > 0)
      : wantsFree
        ? [...sortedPeople].reverse().filter((p) => p.status === "optimal")
        : sortedPeople;

    const divLoadLines = intel.divisions.map((d) =>
      `• **${d.name}** (${d.member_count} orang): **${d.load_status_label}** — ${d.active_tasks_count} tugas aktif (${d.overdue_tasks.length} telat) · _${d.load_reason}_`
    );

    const peopleLoadLines = (filteredPeople.length ? filteredPeople : sortedPeople).map((p) =>
      `• **${p.name}** (${p.department}): **${p.status_label}** — ${p.active} aktif (${p.share}%), ${p.overdue} telat · _${p.status_reason}_`
    );

    answerBlocks.push([
      `📊 **Analisa Load / Beban Kerja Workspace**`,
      `• Ringkasan Karyawan: **${intel.workload_summary.optimal_count} Optimal** · **${intel.workload_summary.stabil_count} Stabil** · **${intel.workload_summary.pressure_count} Under Pressure**`,
      `• Total Tugas Aktif Berjalan: **${intel.workload_summary.total_active_tasks} tugas**`,
      ``,
      `🏢 **Load per Divisi:**`,
      ...divLoadLines,
      ``,
      `👤 **Load per Karyawan${wantsBusiest ? " (Tertinggi / Sibuk)" : wantsFree ? " (Kapasitas Luang)" : ""}:**`,
      ...peopleLoadLines
    ].join("\n"));
  }

  // 6. Urgent deadlines (non-overdue)
  if (hasDeadlineKw && !hasOverdueKw) {
    const urgentAll = [...intel.tasks.under_6h_list, ...intel.tasks.due_today_list, ...intel.tasks.due_tomorrow_list];
    const uniqueUrgent = Array.from(new Map(urgentAll.map((t) => [t.id, t])).values());
    answerBlocks.push([
      `⏳ **Monitoring Deadline Terdekat (${intel.generated_at_wib})**`,
      `• Terlewat (Overdue): **${intel.tasks.overdue_count}** | < 6 Jam: **${intel.tasks.under_6h_count}** | Hari Ini: **${intel.tasks.due_today_count}** | Besok: **${intel.tasks.due_tomorrow_count}**`,
      uniqueUrgent.length > 0
        ? `\n📋 **Daftar Tugas Deadline Terdekat:**\n${formatTaskListLines(uniqueUrgent, 8)}`
        : `\nTidak ada tugas dengan deadline mendesak dalam 48 jam ke depan.`
    ].join("\n"));
  }

  // 7. Brand / Label specific tasks
  if (targetLabel) {
    const labelTasks = intel.tasks.all_active.filter((t) => t.label_names.includes(targetLabel.name));
    answerBlocks.push([
      `🏷️ **Data Tugas Brand / Label: ${targetLabel.name}**`,
      `• Total: **${targetLabel.total} tugas** (${targetLabel.active} aktif, ${targetLabel.done} selesai, ${targetLabel.overdue} telat)`,
      labelTasks.length > 0 ? `\n${formatTaskListLines(labelTasks, 8)}` : `\nTidak ada tugas aktif untuk label **${targetLabel.name}**.`
    ].join("\n"));
  }

  // 8. Project specific or project list
  if (targetProject || hasProjectKw) {
    if (targetProject) {
      const pTasks = intel.tasks.all_active.filter((t) => t.project_id === targetProject.id);
      answerBlocks.push([
        `🗂️ **Detail Proyek: ${targetProject.name}** (Status: ${targetProject.status})`,
        `• Progress: **${targetProject.progress_percent}%** (${targetProject.done_tasks}/${targetProject.total_tasks} tugas selesai, ${targetProject.active_tasks} aktif, ${targetProject.overdue_tasks} telat)`,
        pTasks.length > 0 ? `\n${formatTaskListLines(pTasks, 6)}` : ``
      ].filter(Boolean).join("\n"));
    } else {
      const pLines = intel.projects.length
        ? intel.projects.map((p) => `• **${p.name}** (${p.status}) — ${p.progress_percent}% (${p.done_tasks}/${p.total_tasks} tugas selesai, ${p.overdue_tasks} telat)`)
        : ["• Belum ada proyek yang dibuat."];
      answerBlocks.push(`🗂️ **Daftar Proyek (${intel.projects.length} proyek):**\n${pLines.join("\n")}`);
    }
  }

  // 9. General Task Breakdown
  if (hasTaskKw && !hasOverdueKw && !hasLoadKw && !hasDeadlineKw && !targetLabel && !targetProject) {
    const statusMapLabel: Record<string, string> = {
      todo: "To Do",
      in_progress: "In Progress",
      in_review: "In Review",
      done: "Done"
    };
    const stLines = Object.entries(intel.tasks.by_status)
      .map(([k, v]) => `${statusMapLabel[k] || k}: **${v}**`)
      .join(" · ");
    const prLines = Object.entries(intel.tasks.by_priority)
      .map(([k, v]) => `${k.toUpperCase()}: **${v}**`)
      .join(" · ");
    const boardLines = intel.boards
      .map((b) => `• **${b.name}**: ${b.tasks_total} total (${b.tasks_active} aktif, ${b.tasks_overdue} telat)`)
      .join("\n");

    answerBlocks.push([
      `📌 **Statistik Tugas Workspace: ${intel.tasks.total} total** (${intel.tasks.active} aktif · ${intel.tasks.done} selesai · ${intel.tasks.overdue_count} telat)`,
      stLines ? `• Per Status: ${stLines}` : "",
      prLines ? `• Per Prioritas: ${prLines}` : "",
      `• Belum Di-assign (Unassigned): ${intel.tasks.unassigned_active} tugas aktif`,
      ``,
      `📋 **Sebaran per Board:**`,
      boardLines || "• Belum ada board.",
      ...(intel.tasks.all_active.length > 0 ? [``, `⚡ **Tugas Aktif Terbaru:**`, formatTaskListLines(intel.tasks.all_active, 6)] : [])
    ].filter(Boolean).join("\n"));
  }

  // 10. Boards / Org structure
  if (hasBoardKw && !hasEmployeeKw && !hasLoadKw && !hasTaskKw) {
    const bLines = intel.boards.map((b) => `• **${b.name}** (Divisi ${b.department}): ${b.tasks_total} tugas (${b.tasks_active} aktif, ${b.tasks_overdue} telat)`);
    answerBlocks.push(`🧩 **Daftar Board & Divisi (${intel.boards.length} board):**\n${bLines.join("\n")}`);
  }

  // 11. Access Requests / Invitations
  if (hasAccessKw) {
    const reqLines = intel.access_requests.pending_list.map((r) => `• **${r.name}** (${r.email}) — Divisi ${r.department} [${r.type}]`);
    answerBlocks.push([
      `🔐 **Permintaan Akses & Undangan**`,
      `• Permintaan Akses Pending: **${intel.access_requests.pending_count}**`,
      `• Undangan Terkirim Pending: **${intel.access_requests.pending_invitations_count}**`,
      ...(reqLines.length ? [`\nDaftar Pending:\n${reqLines.join("\n")}`] : [`\nTidak ada permintaan akses yang menunggu persetujuan.`])
    ].join("\n"));
  }

  // 12. Feed Beranda
  if (hasFeedKw) {
    const pLines = intel.feed.latest_posts.map((p) => `• **${p.author}** (${p.created_at}): "${p.content || "(Lampiran/media)"}" — ❤️ ${p.likes} · 💬 ${p.comments}`);
    answerBlocks.push([
      `📰 **Feed Beranda Workspace**`,
      `• Total Postingan: **${intel.feed.posts_count}** · Total Komentar: **${intel.feed.comments_count}**`,
      ...(intel.feed.top_post ? [`• Postingan Terpopuler: **${intel.feed.top_post.author}** (❤️ ${intel.feed.top_post.likes}): "${intel.feed.top_post.content}"`] : []),
      ...(pLines.length ? [`\nPostingan Terbaru:\n${pLines.join("\n")}`] : [`\nBelum ada postingan di Beranda.`])
    ].join("\n"));
  }

  // 13. Polls
  if (hasPollKw) {
    const pollLines = intel.polls.map((pl) => {
      const optStr = pl.options.map((o: { text: string; votes: number }) => `${o.text} (${o.votes})`).join(", ");
      return `• **${pl.question}** — ${pl.total_votes} suara [${pl.closed ? "Selesai" : "Aktif"}]\n  Opsi: ${optStr}`;
    });
    answerBlocks.push(
      `📊 **Data Polling (${intel.polls.length} polling):**\n` +
      (pollLines.length ? pollLines.join("\n") : "• Belum ada polling yang dibuat di chat grup.")
    );
  }

  // 14. Chat & Groups
  if (hasChatKw) {
    const gLines = intel.chat.groups.map((g) => `• **${g.name}** (${g.members_count} anggota)`);
    answerBlocks.push([
      `💬 **Statistik Chatting & Grup**`,
      `• Grup Chat: **${intel.chat.groups_count}** · Percakapan DM: **${intel.chat.dm_count}** · Total Pesan Tersimpan: **${intel.chat.messages_count}**`,
      ...(gLines.length ? [`\nDaftar Grup:\n${gLines.join("\n")}`] : [])
    ].join("\n"));
  }

  // 15. Meetings / Schedules
  if (hasMeetingKw) {
    const mLines = intel.meetings.upcoming.map((m) => `• **${m.title}** — ${m.when}${m.location && m.location !== "-" ? ` (${m.location})` : ""}`);
    answerBlocks.push([
      `📅 **Jadwal & Meeting (${intel.meetings.total} total, ${intel.meetings.upcoming.length} mendatang)**`,
      mLines.length ? mLines.join("\n") : "• Tidak ada jadwal meeting mendatang."
    ].join("\n"));
  }

  // 16. Reminders
  if (hasReminderKw) {
    const rLines = intel.reminders.pending.map((r) => `• ${r.title}${r.due ? ` (${r.due})` : ""}`);
    answerBlocks.push(
      `🔔 **Pengingat Aktif: ${intel.reminders.pending.length} dari ${intel.reminders.total} total**\n` +
      (rLines.length ? rLines.join("\n") : "• Tidak ada pengingat yang belum selesai.")
    );
  }

  // 17. Drive
  if (hasDriveKw) {
    const dLines = intel.drive.items.map((d) => `• **${d.title}** (${d.division})`);
    answerBlocks.push(
      `📁 **Shortcut Google Drive & Dokumen (${intel.drive.total} item):**\n` +
      (dLines.length ? dLines.join("\n") : "• Belum ada shortcut Drive.")
    );
  }

  // 18. Recent Activity
  if (hasActivityKw) {
    answerBlocks.push(
      `🕒 **Aktivitas Terbaru Workspace:**\n` +
      (intel.activity_recent.length ? intel.activity_recent.map((a) => `• ${a}`).join("\n") : "• Belum ada log aktivitas terbaru.")
    );
  }

  if (answerBlocks.length > 0) {
    return answerBlocks.join("\n\n");
  }

  // Smart fallback: return concise live overview + tip so user always gets real data
  return [
    `Saya sudah memeriksa data langsung workspace untuk pertanyaan: _"${question}"_`,
    ``,
    formatFullOverview(intel),
    ``,
    `💡 _Tips: Anda bisa tanya lebih spesifik, misalnya "Berapa jumlah karyawan?", "Berapa load team Marketing?", "Tugas yang telat di IT?", atau "Feed & polling terbaru"._`
  ].join("\n");
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}

export async function generateCircleBotReply(params: {
  db: Record<string, any>;
  senderUser: any;
  question: string;
  historyMessages?: any[];
}): Promise<{ text: string; createdTask?: any }> {
  const { db, senderUser, question, historyMessages = [] } = params;
  const trimmed = (question || "").trim();
  const textLower = trimmed.toLowerCase();

  // Keep instant /task & "buat task ..." command deterministic & immediate
  if (textLower.startsWith("/task") || textLower.includes("buat task") || textLower.includes("buatkan tugas")) {
    const taskTitle = trimmed.replace(/\/task|buat task|buatkan tugas/gi, "").trim() || "Tugas Baru dari Circle";
    const senderDept = senderUser?.department;
    const matchedBoard = (db.boards || []).find(
      (b: any) => senderDept && String(b.department || b.name || "").toLowerCase() === String(senderDept).toLowerCase()
    );
    const newTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      number: (db.tasks?.length || 0) + 1,
      number_str: `TSK-${String((db.tasks?.length || 0) + 1).padStart(3, "0")}`,
      title: taskTitle,
      status: "todo",
      priority: "medium",
      board_id: matchedBoard?.id || db.boards?.[0]?.id || "brd_div_marketing",
      requestor_ids: [senderUser?.user_id].filter(Boolean),
      reviewer_ids: [senderUser?.user_id].filter(Boolean),
      created_by: senderUser?.user_id || CIRCLE_BOT_ID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.tasks.unshift(newTask);
    return {
      createdTask: newTask,
      text: `✨ Tugas baru berhasil dibuat otomatis oleh Circle!\n\n📌 **${newTask.number_str}: ${newTask.title}**\nStatus: To Do | Prioritas: Medium | Board: ${matchedBoard?.name || "Marketing"}\n\nAnda dapat melihat dan mengelola tugas ini langsung di menu Tasks.`
    };
  }

  const now = new Date();
  const deterministicReply = answerWorkspaceQuestionDeterministically(trimmed, db, senderUser, now);

  // If GEMINI_API_KEY is available, use gemini-4-hydrogen grounded strictly on real live snapshot
  const ai = getGeminiClient();
  if (!ai) {
    return { text: deterministicReply };
  }

  try {
    const intel = buildWorkspaceIntelligence(db, senderUser, now);
    const recentHistory = historyMessages
      .slice(-6)
      .filter((m: any) => m?.text && !m.deleted)
      .map((m: any) => `${m.sender_id === CIRCLE_BOT_ID ? "Circle" : (senderUser?.name || "User")}: ${String(m.text).slice(0, 350)}`)
      .join("\n");

    const systemInstruction = [
      `Kamu adalah Circle, asisten analitik cerdas untuk workspace perusahaan "${intel.workspace_name}".`,
      `TUGAS UTAMAMU: Menjawab pertanyaan pengguna tentang data workspace (karyawan, divisi, beban kerja/load Optimal/Stabil/Under Pressure, tugas telat/overdue, deadline, proyek, board, feed Beranda, chat, polling, meeting, drive, permintaan akses, aktivitas) secara AKURAT, JELAS, dan INFORMATIF dalam Bahasa Indonesia.`,
      ``,
      `ATURAN KERAS (WAJIB DIPATUHI):`,
      `1. HANYA gunakan angka, nama orang, nama divisi, judul tugas, dan status yang ADA di dalam DATA LIVE WORKSPACE JSON di bawah. DILARANG KERAS mengarang atau menebak data.`,
      `2. Definisi Status Load Tim & Karyawan di workspace ini:`,
      `   - Optimal: Tidak ada tugas telat/deadline < 6 jam, dan beban tugas masih ringan (atau deadline >= 2 hari).`,
      `   - Stabil: Ada >= 3 tugas deadline <= besok, atau ada deadline hari ini (>= 6 jam), atau >= 5 tugas aktif dengan deadline >= 2 hari.`,
      `   - Under Pressure: Ada tugas telat (overdue > 0), atau deadline < 6 jam, atau >= 5 tugas deadline <= besok, atau >= 8 tugas aktif.`,
      `3. Format jawaban dengan rapi menggunakan poin bullet (•) dan **bold** untuk angka/nama/status penting agar mudah dibaca di gelembung chat.`,
      `4. Jawab langsung ke inti pertanyaan, lalu tambahkan rincian relevan (misal nama anggota, TSK-xxx, deadline WIB, alasan status load).`,
      `5. Jika data untuk kategori yang ditanya bernilai 0 atau kosong, nyatakan dengan jujur bahwa jumlahnya 0 berdasarkan data live saat ini.`
    ].join("\n");

    const prompt = [
      `DATA LIVE WORKSPACE (Waktu: ${intel.generated_at_wib}):`,
      JSON.stringify(intel),
      recentHistory ? `\nRIWAYAT CHAT TERAKHIR:\n${recentHistory}` : "",
      `\nPENANYA SAAT INI: ${senderUser?.name || "Pengguna"} (Divisi: ${senderUser?.department || "-"}, Role: ${senderUser?.role || "member"})`,
      `PERTANYAAN PENGGUNA: "${trimmed}"`
    ].filter(Boolean).join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });

    const aiText = response.text?.trim();
    if (aiText && aiText.length > 0) {
      return { text: aiText };
    }
  } catch (err) {
    console.warn("[CircleBot] Gemini fallback to deterministic intelligence:", (err as any)?.message || err);
  }

  return { text: deterministicReply };
}
