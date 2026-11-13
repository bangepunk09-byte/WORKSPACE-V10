import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Columns3, ArrowUp, ArrowDown, Eye, EyeOff, Plus, ArrowUpDown, Pencil, Maximize2, Link2, Layers, LayoutList } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { PRIORITY, fmtDate, Avatar, AvatarStack, getTaskCompliance, getTaskComplianceDetail } from "../../components/common";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { TaskCard } from "./Board";
import { ItemPicker, ItemChip, getItemMeta, itemStyle } from "./fields";

export const COLS = [
  ["requestor_id", "Requestor", 11],
  ["assignee_id", "Assignee", 12],
  ["label_ids", "Brand", 11],
  ["item_type", "Item", 14],
  ["title", "Title", 22],
  ["priority", "Priority", 9],
  ["link_url", "Link File/Folder", 11],
  ["status", "Status", 11],
  ["number", "ID", 5],
  ["project_id", "Project", 10],
  ["completed_at", "Completed", 9],
  ["updated_at", "Last updated", 9]
];
export const DEFAULT_HIDDEN = ["number", "project_id", "completed_at", "updated_at"];
const ci = "h-7 w-full min-w-0 rounded-md bg-transparent px-1.5 text-xs outline-none hover:bg-surface2 focus:bg-surface focus:ring-2 focus:ring-sky-400";

function getReqIds(taskItem) {
  if (!taskItem) return [];
  if (Array.isArray(taskItem.requestor_ids) && taskItem.requestor_ids.length) return taskItem.requestor_ids.filter(Boolean);
  if (taskItem.requestor_id) return [taskItem.requestor_id];
  if (taskItem.created_by) return [taskItem.created_by];
  return [];
}

function getAssigneeIds(taskItem) {
  if (!taskItem) return [];
  if (Array.isArray(taskItem.assignee_ids) && taskItem.assignee_ids.length) return taskItem.assignee_ids.filter(Boolean);
  if (taskItem.assignee_id) return [taskItem.assignee_id];
  return [];
}

function getCheckpointCompliance(cp, taskItem) {
  if (!cp) return getTaskCompliance(taskItem);
  const effectiveDeadline = cp.deadline || taskItem?.deadline || null;
  if (cp.done) {
    if (!effectiveDeadline) return "On time";
    const finishedAt = new Date(cp.done_at || taskItem?.completed_at || taskItem?.updated_at || Date.now());
    const dl = new Date(effectiveDeadline);
    if (cp.deadline && /^\d{4}-\d{2}-\d{2}$/.test(String(cp.deadline))) {
      dl.setHours(23, 59, 59, 999);
    }
    return finishedAt > dl ? "Overdue" : "On time";
  }
  if (!effectiveDeadline) return "In Progress";
  const now = new Date();
  const dl = new Date(effectiveDeadline);
  if (cp.deadline && /^\d{4}-\d{2}-\d{2}$/.test(String(cp.deadline))) {
    dl.setHours(23, 59, 59, 999);
  }
  return now > dl ? "Overdue" : "In Progress";
}

function getCheckpointComplianceDetail(cp, taskItem) {
  if (!cp) return getTaskComplianceDetail(taskItem);
  const effectiveDeadline = cp.deadline || taskItem?.deadline || null;
  if (cp.done) {
    if (!effectiveDeadline) return `Tahap "${cp.title}" selesai tepat waktu (tanpa deadline)`;
    const finishedAt = new Date(cp.done_at || taskItem?.completed_at || taskItem?.updated_at || Date.now());
    const dl = new Date(effectiveDeadline);
    if (cp.deadline && /^\d{4}-\d{2}-\d{2}$/.test(String(cp.deadline))) {
      dl.setHours(23, 59, 59, 999);
    }
    return finishedAt > dl
      ? `Tahap "${cp.title}" selesai melebihi deadline (Overdue)`
      : `Tahap "${cp.title}" selesai tepat waktu (On time)`;
  }
  if (!effectiveDeadline) return `Tahap "${cp.title}" sedang dikerjakan (tanpa deadline)`;
  const now = new Date();
  const dl = new Date(effectiveDeadline);
  if (cp.deadline && /^\d{4}-\d{2}-\d{2}$/.test(String(cp.deadline))) {
    dl.setHours(23, 59, 59, 999);
  }
  return now > dl
    ? `Tahap "${cp.title}" belum selesai & melewati deadline (Overdue)`
    : `Tahap "${cp.title}" sedang dikerjakan dalam tenggat waktu`;
}

function LinkCell({ t, patch }) {
  const [edit, setEdit] = useState(false);
  const v = t.link_url || "";
  if (edit || !v) {
    return (
      <input
        autoFocus={edit}
        defaultValue={v}
        placeholder={edit ? "Tempel link…" : ""}
        onBlur={(e) => {
          setEdit(false);
          const n = e.target.value.trim();
          if (n !== v) patch(t, { link_url: n });
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={ci}
        data-testid={`sheet-link-input-${t.id}`}
      />
    );
  }
  const href = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return (
    <div className="flex h-7 items-center gap-1 px-1.5">
      <Link2 size={12} className="shrink-0 text-sub print:hidden" />
      <a href={href} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-xs text-blue-600 underline dark:text-blue-400" data-testid={`sheet-link-${t.id}`}>
        {v.replace(/^https?:\/\//i, "")}
      </a>
      <button onClick={() => setEdit(true)} className="shrink-0 text-sub opacity-0 group-hover:opacity-100 print:hidden" aria-label="Edit link" data-testid={`sheet-link-edit-${t.id}`}>
        <Pencil size={11} />
      </button>
    </div>
  );
}

function TitleCell({ row, patch, onOpen }) {
  const [editing, setEditing] = useState(false);
  const taskItem = row.task;
  const cp = row.cp;

  if (editing) {
    return (
      <div className="flex h-7 items-center gap-1 min-w-0">
        <input
          autoFocus
          defaultValue={taskItem.title}
          key={`title_edit_${taskItem.id}_${taskItem.updated_at || ""}`}
          onBlur={(e) => {
            setEditing(false);
            const val = e.target.value.trim();
            if (val && val !== taskItem.title) patch(taskItem, { title: val });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className={`${ci} text-[13px] font-medium`}
          data-testid={`list-title-${taskItem.id}`}
        />
      </div>
    );
  }

  return (
    <div className="flex h-7 items-center gap-1.5 min-w-0 flex-nowrap px-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-w-0 truncate text-left text-[13px] font-medium text-ink hover:text-brand cursor-text"
        title={taskItem.title}
        data-testid={`list-title-${taskItem.id}`}
      >
        {taskItem.title}
      </button>
      {cp && (
        <button
          type="button"
          onClick={() => onOpen(taskItem.id)}
          className="inline-flex shrink-0 max-w-[54%] items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/15 truncate cursor-pointer"
          title={`Tahap ${row.cpIndex + 1}/${row.cpTotal}: ${cp.title}${cp.deadline ? ` (Deadline: ${cp.deadline})` : ""}`}
        >
          <span className="truncate">{row.cpIndex + 1}/{row.cpTotal} · {cp.title}</span>
          {cp.deadline && <span className="shrink-0 opacity-75">· {fmtDate(cp.deadline, "d MMM")}</span>}
        </button>
      )}
      <button
        onClick={() => onOpen(taskItem.id)}
        className="ml-auto shrink-0 rounded-md p-1 text-sub opacity-0 hover:bg-surface2 group-hover:opacity-100 print:hidden"
        aria-label="Buka detail"
        data-testid={`open-task-${taskItem.id}`}
      >
        <Maximize2 size={12} />
      </button>
    </div>
  );
}

function Cell({ k, row, projects, patch, onOpen }) {
  const { userMap, users, statuses, labels, labelMap, ws, t } = useApp();
  const taskItem = row.task;
  const cp = row.cp;
  const humanUsers = users.filter((u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant");

  switch (k) {
    case "requestor_id": {
      const reqUids = getReqIds(taskItem);
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-full bg-surface2 px-2.5 text-left text-xs hover:ring-1 hover:ring-brand/40 transition-all cursor-pointer outline-none focus:outline-none"
              data-testid={`sheet-requestor-${taskItem.id}`}
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {reqUids.length > 0 ? (
                  <>
                    <AvatarStack ids={reqUids} max={2} size={18} />
                    <span className="truncate font-medium">
                      {reqUids.map((id) => userMap[id]?.name?.split(" ")[0]).filter(Boolean).join(", ") || "—"}
                    </span>
                  </>
                ) : (
                  <span className="text-sub">—</span>
                )}
              </div>
              <ChevronDown size={11} className="shrink-0 opacity-40 print:hidden" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 bg-surface p-2 shadow-xl rounded-2xl border outline-none focus:outline-none" align="start">
            <p className="px-2 py-1 text-[11px] font-bold text-sub uppercase tracking-wider">{t("table_choose_requestor", "Pilih Requestor")} ({reqUids.length} orang)</p>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {humanUsers.map((u) => {
                const on = reqUids.includes(u.user_id);
                return (
                  <button
                    key={u.user_id}
                    type="button"
                    onClick={() => {
                      const next = on ? reqUids.filter((id) => id !== u.user_id) : [...reqUids, u.user_id];
                      patch(taskItem, { requestor_ids: next, requestor_id: next[0] || null });
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-xs transition-colors cursor-pointer outline-none focus:outline-none ${
                      on ? "bg-brand/10 font-bold text-brand" : "hover:bg-surface2 text-ink"
                    }`}
                  >
                    <span className="truncate">{u.name}</span>
                    {on && <span className="text-brand font-bold text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      );
    }
    case "assignee_id": {
      if (cp) {
        const cpUid = cp.assignee_id || null;
        const cpUser = cpUid ? userMap[cpUid] : null;
        return (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-full bg-surface2 px-2.5 text-left text-xs hover:ring-1 hover:ring-brand/40 transition-all cursor-pointer outline-none focus:outline-none"
                title={`PIC Tahap ${row.cpIndex + 1}: ${cp.title}`}
                data-testid={`sheet-name-${row.rowKey}`}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {cpUser ? (
                    <>
                      <Avatar user={cpUser} size={18} showStatus={false} ringDeadline={false} />
                      <span className="truncate font-medium">{cpUser.name?.split(" ")[0] || cpUser.name}</span>
                    </>
                  ) : (
                    <span className="truncate text-sub">— Unassigned</span>
                  )}
                </div>
                <ChevronDown size={11} className="shrink-0 opacity-40 print:hidden" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 bg-surface p-2 shadow-xl rounded-2xl border outline-none focus:outline-none" align="start">
              <p className="px-2 py-1 text-[11px] font-bold text-sub uppercase tracking-wider truncate">
                PIC Tahap {row.cpIndex + 1}: {cp.title}
              </p>
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const updatedCps = (taskItem.checkpoints || []).map((c, idx) =>
                      (c.id && cp.id ? c.id === cp.id : idx === row.cpIndex) ? { ...c, assignee_id: null } : c
                    );
                    patch(taskItem, { checkpoints: updatedCps });
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-xs transition-colors cursor-pointer ${
                    !cpUid ? "bg-brand/10 font-bold text-brand" : "hover:bg-surface2 text-sub"
                  }`}
                >
                  <span>— Unassigned</span>
                  {!cpUid && <span className="text-brand font-bold text-xs">✓</span>}
                </button>
                {humanUsers.map((u) => {
                  const on = cpUid === u.user_id;
                  return (
                    <button
                      key={u.user_id}
                      type="button"
                      onClick={() => {
                        const updatedCps = (taskItem.checkpoints || []).map((c, idx) =>
                          (c.id && cp.id ? c.id === cp.id : idx === row.cpIndex) ? { ...c, assignee_id: u.user_id } : c
                        );
                        patch(taskItem, { checkpoints: updatedCps });
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-xs transition-colors cursor-pointer ${
                        on ? "bg-brand/10 font-bold text-brand" : "hover:bg-surface2 text-ink"
                      }`}
                    >
                      <span className="truncate">{u.name}</span>
                      {on && <span className="text-brand font-bold text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        );
      }

      const uids = getAssigneeIds(taskItem);
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-full bg-surface2 px-2.5 text-left text-xs hover:ring-1 hover:ring-brand/40 transition-all cursor-pointer outline-none focus:outline-none focus:ring-0"
              data-testid={`sheet-name-${taskItem.id}`}
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {uids.length > 0 ? (
                  <>
                    <AvatarStack ids={uids} max={2} size={18} />
                    <span className="truncate font-medium">
                      {uids.map((id) => userMap[id]?.name?.split(" ")[0]).filter(Boolean).join(", ")}
                    </span>
                  </>
                ) : (
                  <span className="text-sub">— {t("table_unassigned", "Unassigned")}</span>
                )}
              </div>
              <ChevronDown size={11} className="shrink-0 opacity-40 print:hidden" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 bg-surface p-2 shadow-xl rounded-2xl border outline-none focus:outline-none" align="start">
            <p className="px-2 py-1 text-[11px] font-bold text-sub uppercase tracking-wider">{t("table_choose_assignee", "Pilih Assignee")} ({uids.length} orang)</p>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {humanUsers.map((u) => {
                const on = uids.includes(u.user_id);
                return (
                  <button
                    key={u.user_id}
                    type="button"
                    onClick={() => {
                      const next = on ? uids.filter((id) => id !== u.user_id) : [...uids, u.user_id];
                      patch(taskItem, { assignee_ids: next, assignee_id: next[0] || null });
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-xs transition-colors cursor-pointer outline-none focus:outline-none ${
                      on ? "bg-brand/10 font-bold text-brand" : "hover:bg-surface2 text-ink"
                    }`}
                  >
                    <span className="truncate">{u.name}</span>
                    {on && <span className="text-brand font-bold text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      );
    }
    case "label_ids": {
      const l = labelMap[taskItem.label_ids?.[0]];
      const set = (id) => patch(taskItem, { label_ids: id ? [id, ...(taskItem.label_ids || []).slice(1).filter((x) => x !== id)] : (taskItem.label_ids || []).slice(1) });
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-full px-2.5 text-xs font-semibold cursor-pointer outline-none focus:outline-none transition-all hover:opacity-90 ${
                l ? "" : "bg-surface2 text-sub hover:bg-surface2/80 font-medium"
              }`}
              style={l ? { background: l.color, color: "#fff" } : undefined}
              data-testid={`sheet-owner-${taskItem.id}`}
            >
              <span className="truncate flex-1 text-left">{l ? l.name : "—"}</span>
              <ChevronDown size={11} className={`shrink-0 print:hidden ${l ? "opacity-75 text-white" : "opacity-40"}`} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 bg-surface p-2 shadow-xl rounded-2xl border outline-none focus:outline-none" align="start">
            <p className="px-2 py-1 text-[11px] font-bold text-sub uppercase tracking-wider">{t("table_choose_brand", "Pilih Brand")}</p>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              <button
                type="button"
                onClick={() => set(null)}
                className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-xs transition-colors cursor-pointer outline-none focus:outline-none ${
                  !l ? "bg-brand/10 font-bold text-brand" : "hover:bg-surface2 text-sub"
                }`}
              >
                <span>— {t("table_no_brand", "Tanpa Brand")}</span>
                {!l && <span className="text-brand font-bold text-xs">✓</span>}
              </button>
              {labels.filter((x) => !x.archived || x.id === l?.id).map((x) => {
                const on = l?.id === x.id;
                return (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => set(x.id)}
                    className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-xs transition-colors cursor-pointer outline-none focus:outline-none ${
                      on ? "bg-brand/10 font-bold text-brand" : "hover:bg-surface2 text-ink"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: x.color }} />
                      <span className="truncate">{x.name}</span>
                    </div>
                    {on && <span className="text-brand font-bold text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      );
    }
    case "item_type": {
      const itemMeta = taskItem.item_type ? getItemMeta(taskItem.item_type, ws?.item_types) : null;
      const itemBtnStyle = itemMeta ? itemStyle(itemMeta) : undefined;
      return (
        <ItemPicker
          value={taskItem.item_type}
          onChange={(v) => patch(taskItem, { item_type: v })}
          testid={`sheet-item-${taskItem.id}`}
          trigger={
            <button
              type="button"
              className={`flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-full px-2.5 text-xs font-semibold cursor-pointer outline-none focus:outline-none transition-all hover:opacity-90 border ${
                itemMeta ? "" : "border-transparent bg-surface2 text-sub hover:bg-surface2/80 font-medium"
              }`}
              style={itemBtnStyle}
              data-testid={`sheet-item-${taskItem.id}`}
            >
              <span className="truncate flex-1 text-left">{itemMeta?.name || taskItem.item_type || "—"}</span>
              <ChevronDown size={11} className={`shrink-0 print:hidden ${itemMeta ? "opacity-75" : "opacity-40"}`} />
            </button>
          }
        />
      );
    }
    case "link_url": return <LinkCell t={taskItem} patch={patch} />;
    case "title": return <TitleCell row={row} patch={patch} onOpen={onOpen} />;
    case "priority": {
      const pObj = PRIORITY[taskItem.priority] || PRIORITY.none;
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-full bg-surface2 px-2.5 text-xs font-semibold cursor-pointer outline-none focus:outline-none hover:bg-surface2/80 transition-all"
              data-testid={`list-priority-${taskItem.id}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {pObj?.color ? <span className="h-2 w-2 rounded-full shrink-0" style={{ background: pObj.color }} /> : null}
                <span className="truncate" style={pObj?.color ? { color: pObj.color } : {}}>{pObj?.name || taskItem.priority || "None"}</span>
              </div>
              <ChevronDown size={11} className="shrink-0 opacity-40 print:hidden" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 bg-surface p-2 shadow-xl rounded-2xl border outline-none focus:outline-none" align="start">
            <p className="px-2 py-1 text-[11px] font-bold text-sub uppercase tracking-wider">{t("table_choose_priority", "Pilih Prioritas")}</p>
            <div className="space-y-0.5">
              {Object.entries(PRIORITY).map(([p, v]) => {
                const on = taskItem.priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => patch(taskItem, { priority: p })}
                    className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-xs transition-colors cursor-pointer outline-none focus:outline-none ${
                      on ? "bg-brand/10 font-bold text-brand" : "hover:bg-surface2 text-ink"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {v.color ? <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: v.color }} /> : <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-sub/30" />}
                      <span>{v.name}</span>
                    </div>
                    {on && <span className="text-brand font-bold text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      );
    }
    case "status":
    case "deadline_compliance": {
      const val = cp ? getCheckpointCompliance(cp, taskItem) : getTaskCompliance(taskItem);
      const valLabel = val === "On time"
        ? t("compliance_on_time", "On time")
        : val === "Overdue"
        ? t("compliance_late", "Overdue")
        : t("compliance_in_progress", "In Progress");
      const detail = cp ? getCheckpointComplianceDetail(cp, taskItem) : getTaskComplianceDetail(taskItem);
      const isDone = cp ? !!cp.done : taskItem.status === "done";
      const effectiveDeadline = cp ? (cp.deadline || taskItem.deadline) : taskItem.deadline;
      const doneTimestamp = cp ? cp.done_at : (taskItem.completed_at || (isDone ? taskItem.updated_at : null));

      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-full px-2.5 text-xs font-semibold cursor-pointer outline-none focus:outline-none focus:ring-0 transition-all hover:opacity-90 ${
                val === "On time"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : val === "Overdue"
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              }`}
              title={detail}
              data-testid={`list-status-${row.rowKey}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    val === "On time" ? "bg-emerald-500" : val === "Overdue" ? "bg-rose-500" : "bg-amber-500"
                  }`}
                />
                <span className="truncate flex-1 text-left font-bold">{valLabel}</span>
              </div>
              <ChevronDown size={11} className="shrink-0 opacity-40 print:hidden" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 bg-surface p-3 shadow-xl rounded-2xl border outline-none focus:outline-none text-xs" align="start">
            <div className="flex items-center justify-between pb-2 mb-2 border-b">
              <span className="text-[10px] font-bold text-sub uppercase tracking-wider">
                {cp ? `Tahap ${row.cpIndex + 1}/${row.cpTotal}` : t("table_choose_status", "Status Otomatis")}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  val === "On time"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : val === "Overdue"
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    val === "On time" ? "bg-emerald-500" : val === "Overdue" ? "bg-rose-500" : "bg-amber-500"
                  }`}
                />
                {valLabel}
              </span>
            </div>
            <p className="text-sub text-[11px] mb-2.5 leading-relaxed">{detail}</p>
            <div className="space-y-1.5 pt-1.5 text-[11px] border-t">
              <div className="flex justify-between">
                <span className="text-sub">Tenggat (Deadline):</span>
                <span className="font-semibold text-ink">
                  {effectiveDeadline ? fmtDate(effectiveDeadline, cp?.deadline ? "d MMM yyyy" : "d MMM yyyy HH:mm") : "— (Tanpa Deadline)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sub">Selesai pada:</span>
                <span className="font-semibold text-ink">
                  {doneTimestamp ? fmtDate(doneTimestamp, "d MMM yyyy HH:mm") : "Belum selesai"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sub">Status Board:</span>
                <span className="font-semibold text-ink">{statuses.find((s) => s.key === taskItem.status)?.name || taskItem.status}</span>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t">
              <button
                type="button"
                onClick={() => {
                  if (cp) {
                    const nextDone = !cp.done;
                    const updatedCps = (taskItem.checkpoints || []).map((c, idx) =>
                      (c.id && cp.id ? c.id === cp.id : idx === row.cpIndex)
                        ? { ...c, done: nextDone, done_at: nextDone ? new Date().toISOString() : null }
                        : c
                    );
                    patch(taskItem, { checkpoints: updatedCps });
                    return;
                  }
                  const nextDone = !isDone;
                  const nextCompletedAt = nextDone ? new Date().toISOString() : null;
                  let nextCompliance = "In Progress";
                  if (nextDone) {
                    nextCompliance = taskItem.deadline ? (new Date(nextCompletedAt) > new Date(taskItem.deadline) ? "Overdue" : "On time") : "On time";
                  } else {
                    nextCompliance = (taskItem.deadline && new Date() > new Date(taskItem.deadline)) ? "Overdue" : "In Progress";
                  }
                  patch(taskItem, {
                    status: nextDone ? "done" : "in_progress",
                    completed_at: nextCompletedAt,
                    deadline_compliance: nextCompliance,
                    progress: nextDone ? 100 : taskItem.progress
                  });
                }}
                className={`w-full rounded-xl py-1.5 text-center font-bold text-xs transition-colors cursor-pointer ${
                  isDone
                    ? "bg-surface2 hover:bg-surface2/80 text-ink"
                    : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-xs"
                }`}
              >
                {cp
                  ? (isDone ? "Buka Kembali Tahap Ini" : "Tandai Tahap Selesai")
                  : (isDone ? "Buka Kembali (Set In Progress)" : "Tandai Selesai (Set Done)")}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      );
    }
    case "number": return <button onClick={() => onOpen(taskItem.id)} className="px-1.5 text-xs font-semibold text-sub hover:text-brand hover:underline cursor-pointer text-left" title="Buka detail task">{taskItem.number_str}</button>;
    case "project_id": return <span className="block truncate px-1.5 text-xs">{projects[taskItem.project_id]?.name || "—"}</span>;
    case "completed_at": return <span className="block truncate px-1.5 text-xs text-emerald-600">{taskItem.completed_at ? fmtDate(taskItem.completed_at, "d MMM") : "—"}</span>;
    case "updated_at": return <span className="block truncate px-1.5 text-xs text-sub">{fmtDate(taskItem.updated_at, "d MMM HH:mm")}</span>;
    default: {
      const cf = (ws.task_fields || []).find((f) => f.key === k);
      return cf ? <input defaultValue={taskItem.custom?.[k] || ""} onBlur={(e) => e.target.value !== (taskItem.custom?.[k] || "") && patch(taskItem, { custom: { ...(taskItem.custom || {}), [k]: e.target.value } })} className={ci} /> : null;
    }
  }
}

function getColLabel(t, key, defaultLabel) {
  switch (key) {
    case "assignee_id": return t("col_name", defaultLabel);
    case "label_ids": return t("col_brand", defaultLabel);
    case "item_type": return t("col_item", defaultLabel);
    case "title": return t("col_title", defaultLabel);
    case "priority": return t("col_priority", defaultLabel);
    case "status": return t("col_status", defaultLabel);
    case "deadline_compliance": return t("col_status_tenggat", defaultLabel);
    case "link_url": return t("col_link", defaultLabel);
    case "number": return t("col_number", defaultLabel);
    case "requestor_id": return t("col_requestor", defaultLabel);
    case "project_id": return t("col_project", defaultLabel);
    case "completed_at": return t("col_completed", defaultLabel);
    case "updated_at": return t("col_updated", defaultLabel);
    default: return defaultLabel;
  }
}

export function ColumnMenu({ cols, cfg, save }) {
  const { isManager, ws, reloadWs, t } = useApp();
  const [name, setName] = useState("");
  const move = (k, dir) => { const o = cols.map((c) => c[0]); const i = o.indexOf(k); const j = i + dir; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ ...cfg, order: o }); };
  const toggle = (k) => save({ ...cfg, hidden: (cfg.hidden || []).includes(k) ? cfg.hidden.filter((x) => x !== k) : [...(cfg.hidden || []), k] });
  const add = async () => { try { await api.put("/settings/task-config", { task_fields: [...(ws.task_fields || []), { name }] }); setName(""); reloadWs(); toast.success("Column added"); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Popover><PopoverTrigger asChild><button className="btn-ghost flex h-10 items-center gap-1.5 rounded-full border bg-surface px-4 text-xs sm:text-sm font-semibold transition-all shadow-xs text-sub hover:text-ink hover:bg-surface2 outline-none focus:outline-none focus:ring-0" data-testid="list-columns-btn"><Columns3 size={14} />{t("table_columns_btn", "Columns")}</button></PopoverTrigger>
      <PopoverContent className="w-72 bg-surface p-2 shadow-xl rounded-2xl border outline-none focus:outline-none" align="end">
        <div className="max-h-72 overflow-y-auto">{cols.map(([k, l], i) => (
          <div key={`col_${k}`} className="flex items-center gap-1 rounded-xl px-2 py-1 text-sm hover:bg-surface2"><span className={`flex-1 ${(cfg.hidden || []).includes(k) ? "text-sub line-through" : ""}`}>{getColLabel(t, k, l)}</span>
            <button onClick={() => move(k, -1)} disabled={!i} className="text-sub disabled:opacity-30 p-1 hover:text-ink" aria-label="Move left"><ArrowUp size={13} /></button>
            <button onClick={() => move(k, 1)} className="text-sub p-1 hover:text-ink" aria-label="Move right"><ArrowDown size={13} /></button>
            <button onClick={() => toggle(k)} className="text-sub p-1 hover:text-ink" aria-label="Toggle column" data-testid={`toggle-col-${k}`}>{(cfg.hidden || []).includes(k) ? <EyeOff size={13} /> : <Eye size={13} />}</button></div>))}</div>
        {isManager && <div className="mt-2 flex gap-1 border-t pt-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="New custom column" className="h-8 flex-1 rounded-lg border bg-surface2 px-2 text-xs" data-testid="custom-column-input" /><button onClick={add} disabled={!name.trim()} className="btn-accent flex h-8 w-8 items-center justify-center disabled:opacity-40" aria-label="Add column" data-testid="custom-column-add"><Plus size={14} /></button></div>}
        <button onClick={() => save({ hidden: DEFAULT_HIDDEN, order: undefined })} className="mt-2 w-full text-xs font-semibold text-brand hover:underline p-1">{t("table_reset_columns", "Reset columns")}</button>
      </PopoverContent></Popover>
  );
}

function AddRow({ span, onAdd, gkey }) {
  const { t } = useApp();
  const [v, setV] = useState("");
  const submit = async () => { if (!v.trim()) return; await onAdd(v.trim()); setV(""); };
  return <tr className="print:hidden"><td className="border-r p-0 text-center text-sub"><Plus size={13} className="mx-auto" /></td><td colSpan={span} className="p-0"><input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} onBlur={submit} placeholder={t("table_add_row", "Tambah baris baru — ketik judul lalu Enter")} className="h-9 w-full bg-transparent px-3 text-xs outline-none placeholder:text-sub focus:bg-surface2" data-testid={`sheet-add-row-${gkey}`} /></td></tr>;
}

export default function ListView({ tasks, projects, onOpen, selected, setSelected, reload, groupBy, boardId, reportMode: controlledReportMode, onReportModeChange }) {
  const { prefs, ws, statuses, userMap, labelMap, t } = useApp();
  const [collapsed, setCollapsed] = useState({});
  const [sort, setSort] = useState({ k: "number", dir: 1 });
  const [limit, setLimit] = useState({});
  const [localReportMode, setLocalReportMode] = useState("checkpoint"); // "checkpoint" (3 stages = 3 PIC rows) | "card" (1 card = 1 row)
  const reportMode = controlledReportMode ?? localReportMode;
  const setReportMode = onReportModeChange ?? setLocalReportMode;
  const cfg = prefs.task_sheet || { hidden: DEFAULT_HIDDEN };

  const standardKeys = new Set(COLS.map((c) => c[0].toLowerCase()));
  const standardNames = new Set(COLS.map((c) => c[1].toLowerCase()));
  const customCols = (ws.task_fields || [])
    .filter((f) => {
      const k = (f.key || f.name || "").toLowerCase();
      const n = (f.name || "").toLowerCase();
      return n !== "estimate" && !standardKeys.has(k) && !standardNames.has(n);
    })
    .map((f) => [f.key || f.name, f.name, 10]);

  const rawAll = [...COLS, ...customCols].map(([k, l, w]) => [k, getColLabel(t, k, l), w]);
  const seenK = new Set();
  const all = rawAll.filter(([k]) => {
    if (seenK.has(k)) return false;
    seenK.add(k);
    return true;
  });

  const targetPrefix = ["requestor_id", "assignee_id", "label_ids", "item_type", "title", "priority", "link_url", "status"];
  const isOutdatedOrder =
    !cfg.order ||
    cfg.order.includes("deadline_compliance") ||
    cfg.order.indexOf("link_url") > cfg.order.indexOf("status") ||
    cfg.order.indexOf("priority") > cfg.order.indexOf("link_url") ||
    cfg.order.filter((x) => x === "priority").length > 1;

  const effectiveOrder = isOutdatedOrder ? targetPrefix : cfg.order;
  const cols = [
    ...(effectiveOrder || []).map((k) => all.find((c) => c[0] === k)).filter(Boolean),
    ...all.filter((c) => !(effectiveOrder || []).includes(c[0]))
  ];
  const visible = cols.filter((c) => !(cfg.hidden || []).includes(c[0]));
  const total = 4 + visible.reduce((s, c) => s + c[2], 0);
  const patch = async (taskObj, body) => { try { await api.patch(`/tasks/${taskObj.id}`, body); reload(); } catch (e) { toast.error(errMsg(e)); } };

  const expandedRows = useMemo(() => {
    const out = [];
    tasks.forEach((taskItem) => {
      const cps = Array.isArray(taskItem.checkpoints) ? taskItem.checkpoints : [];
      if (reportMode === "checkpoint" && cps.length > 0) {
        cps.forEach((cp, idx) => {
          out.push({
            rowKey: `${taskItem.id}__cp_${cp.id || idx}`,
            task: taskItem,
            cp,
            cpIndex: idx,
            cpTotal: cps.length
          });
        });
      } else {
        out.push({
          rowKey: taskItem.id,
          task: taskItem,
          cp: null,
          cpIndex: 0,
          cpTotal: 0
        });
      }
    });
    return out;
  }, [tasks, reportMode]);

  const val = (row, k) => {
    const taskItem = row.task;
    if (k === "requestor_id") {
      return getReqIds(taskItem).map((id) => userMap[id]?.name).filter(Boolean).join(", ");
    }
    if (k === "assignee_id") {
      if (row.cp) return userMap[row.cp.assignee_id]?.name || "";
      return getAssigneeIds(taskItem).map((id) => userMap[id]?.name).filter(Boolean).join(", ");
    }
    if (k === "label_ids") return labelMap[taskItem.label_ids?.[0]]?.name ?? "";
    if (k === "status" || k === "deadline_compliance") {
      return row.cp ? getCheckpointCompliance(row.cp, taskItem) : getTaskCompliance(taskItem);
    }
    return taskItem[k] ?? "";
  };

  const sortedRows = useMemo(
    () =>
      [...expandedRows].sort((a, b) => {
        const x = val(a, sort.k);
        const y = val(b, sort.k);
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      }),
    [expandedRows, sort, userMap, labelMap] // eslint-disable-line
  );

  const groups = useMemo(() => {
    if (groupBy === "status") {
      return statuses.map((s) => [s.key, s.name, s.color, sortedRows.filter((r) => r.task.status === s.key)]);
    }
    if (groupBy === "assignee") {
      const ids = [
        ...new Set(
          sortedRows.flatMap((r) => {
            if (r.cp) return [r.cp.assignee_id || ""];
            const uids = getAssigneeIds(r.task);
            return uids.length ? uids : [""];
          })
        )
      ];
      return ids.map((id) => [
        id || "none",
        userMap[id]?.name || "Unassigned",
        "var(--s-blue)",
        sortedRows.filter((r) => {
          if (r.cp) return id ? r.cp.assignee_id === id : !r.cp.assignee_id;
          const uids = getAssigneeIds(r.task);
          return id ? uids.includes(id) : !uids.length;
        })
      ]);
    }
    if (groupBy === "department") {
      const ds = [...new Set(sortedRows.map((r) => r.task.department || ""))];
      return ds.map((d) => [d || "none", d || "No department", "var(--s-green)", sortedRows.filter((r) => (r.task.department || "") === d)]);
    }
    if (groupBy === "label") {
      const ls = [...new Set(sortedRows.flatMap((r) => (r.task.label_ids?.length ? r.task.label_ids : [""])))];
      return ls.map((l) => [l || "none", labelMap[l]?.name || "No label", labelMap[l] ? `${labelMap[l].color}33` : "var(--s-yellow)", sortedRows.filter((r) => (l ? r.task.label_ids?.includes(l) : !r.task.label_ids?.length))]);
    }
    return [["all", null, null, sortedRows]];
  }, [groupBy, sortedRows, statuses, userMap, labelMap]);

  const toggleSel = (id) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const addRow = async (key, title) => {
    const body = { title, ...(boardId ? { board_id: boardId } : {}) };
    if (groupBy === "status") body.status = key;
    if (groupBy === "assignee" && key !== "none") body.assignee_id = key;
    if (groupBy === "label" && key !== "none") body.label_ids = [key];
    try { await api.post("/tasks", body); reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  const checkpointTasksCount = tasks.filter((x) => Array.isArray(x.checkpoints) && x.checkpoints.length > 0).length;

  return (
    <div data-testid="task-list-view">
      {/* Report Mode Switcher: Checkpoint Stages (per PIC) vs Card Summary */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:mb-2">
        <div className="inline-flex h-10 items-center gap-0.5 rounded-full border bg-surface p-1 shadow-2xs print:hidden" data-testid="report-mode-switcher">
          <button
            type="button"
            onClick={() => setReportMode("checkpoint")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              reportMode === "checkpoint" ? "bg-brand text-white shadow-xs" : "text-sub hover:text-ink hover:bg-surface2"
            }`}
            data-testid="report-mode-checkpoint"
          >
            <Layers size={14} />
            <span>{t("tasks_report_checkpoint", "Report per Tahap (Checkpoint PIC)")}</span>
          </button>
          <button
            type="button"
            onClick={() => setReportMode("card")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              reportMode === "card" ? "bg-brand text-white shadow-xs" : "text-sub hover:text-ink hover:bg-surface2"
            }`}
            data-testid="report-mode-card"
          >
            <LayoutList size={14} />
            <span>{t("tasks_report_card", "Per Card Tugas")}</span>
          </button>
        </div>
        <p className="text-xs font-medium text-sub">
          Menampilkan <b className="text-ink">{expandedRows.length} baris</b> ({tasks.length} card{checkpointTasksCount > 0 ? `, ${checkpointTasksCount} memiliki tahap checkpoint` : ""})
        </p>
      </div>

      {!tasks.length && <p className="mb-3 rounded-2xl border border-dashed p-6 text-center text-sm text-sub" data-testid="task-list-empty">No tasks match these filters.</p>}
      <div className="space-y-5">
        {groups.map(([key, name, color, rows]) => {
          const lim = limit[key] || 200;
          const uniqueTaskIds = [...new Set(rows.map((r) => r.task.id))];
          return (
            <section key={key} data-testid={`list-group-${key}`}>
              {name && (
                <button onClick={() => setCollapsed({ ...collapsed, [key]: !collapsed[key] })} className="mb-2 flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left" style={{ background: color }}>
                  {collapsed[key] ? <ChevronRight size={15} className="print:hidden" /> : <ChevronDown size={15} className="print:hidden" />}
                  <span className="text-sm font-bold text-[#20283B] dark:text-ink">{name}</span>
                  <span className="rounded-full bg-surface px-2 text-xs font-semibold">{rows.length}</span>
                </button>
              )}
              {!collapsed[key] && (
                <>
                  <div className="hidden overflow-hidden rounded-xl border bg-surface md:block print:block">
                    <table className="w-full table-fixed border-collapse text-left" data-testid={`task-sheet-${key}`}>
                      <colgroup>
                        <col key={`${key}_col_num`} style={{ width: `${(4 / total) * 100}%` }} />
                        {visible.map(([k, , w], idx) => (
                          <col key={`${key}_col_${k || idx}`} style={{ width: `${(w / total) * 100}%` }} />
                        ))}
                      </colgroup>
                      <thead>
                        <tr className="bg-surface2">
                          <th className="border-b border-r p-0 text-center">
                            <input
                              type="checkbox"
                              checked={uniqueTaskIds.length > 0 && uniqueTaskIds.every((id) => selected.includes(id))}
                              onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...uniqueTaskIds])] : selected.filter((x) => !uniqueTaskIds.includes(x)))}
                              className="accent-[var(--c-accent)] print:hidden"
                              aria-label="Select all"
                              data-testid={`select-all-${key}`}
                            />
                            <span className="hidden text-[11px] font-bold text-sub print:inline">#</span>
                          </th>
                          {visible.map(([k, l], idx) => (
                            <th key={`${key}_th_${k || idx}`} className="border-b border-r px-2 py-2 last:border-r-0">
                              <button onClick={() => setSort({ k, dir: sort.k === k ? -sort.dir : 1 })} className="flex w-full min-w-0 items-center gap-1 text-xs font-bold text-ink" data-testid={`sort-${k}`}>
                                <span className="truncate">{l}</span>
                                <ArrowUpDown size={10} className={`shrink-0 print:hidden ${sort.k === k ? "text-brand" : "opacity-30"}`} />
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, lim).map((row, i) => {
                          const taskItem = row.task;
                          const on = selected.includes(taskItem.id);
                          return (
                            <tr key={`${key}_row_${row.rowKey}`} className={`group border-b ${on ? "bg-soft-red" : i % 2 ? "bg-[var(--s-blue)]/30" : ""} hover:bg-surface2/70`} data-testid={`task-row-${row.rowKey}`}>
                              <td className="relative border-r p-0 text-center">
                                <span className={`text-[11px] text-sub ${on ? "opacity-0 print:opacity-100" : "group-hover:opacity-0 print:group-hover:opacity-100"}`}>{i + 1}</span>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => toggleSel(taskItem.id)}
                                  className={`absolute inset-0 m-auto h-4 w-4 accent-[var(--c-accent)] print:hidden ${on ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                  aria-label="Select task"
                                  data-testid={`select-task-${row.rowKey}`}
                                />
                              </td>
                              {visible.map(([k], idx) => (
                                <td key={`${key}_cell_${row.rowKey}_${k || idx}`} className="border-r px-1 py-0.5 last:border-r-0">
                                  <Cell k={k} row={row} projects={projects} patch={patch} onOpen={onOpen} />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                        <AddRow span={visible.length} onAdd={(title) => addRow(key, title)} gkey={key} />
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-2 md:hidden print:hidden">
                    {rows.slice(0, lim).map((row) => {
                      const taskItem = row.task;
                      return (
                        <div key={`${row.rowKey}_${taskItem.updated_at || taskItem.created_at || "1"}`} className="flex items-start gap-2">
                          <input type="checkbox" checked={selected.includes(taskItem.id)} onChange={() => toggleSel(taskItem.id)} className="mt-4 h-5 w-5 accent-[var(--c-accent)]" aria-label="Select task" />
                          <div className="min-w-0 flex-1">
                            {row.cp && (
                              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-brand">
                                <span className="rounded-md bg-brand/10 px-2 py-0.5">
                                  Tahap {row.cpIndex + 1}/{row.cpTotal}: {row.cp.title}
                                </span>
                                {row.cp.assignee_id && <span className="text-sub">PIC: {userMap[row.cp.assignee_id]?.name}</span>}
                              </div>
                            )}
                            <TaskCard t={taskItem} onOpen={onOpen} done={statuses.find((s) => s.key === taskItem.status)?.is_done} reload={reload} />
                            {taskItem.item_type && <div className="mt-1 pl-1"><ItemChip name={taskItem.item_type} small /></div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {rows.length > lim && <button onClick={() => setLimit({ ...limit, [key]: lim + 200 })} className="mt-2 text-sm font-semibold text-brand print:hidden">Show more ({rows.length - lim})</button>}
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
