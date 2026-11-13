import { useCallback, useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckSquare, Plus, Search, Download, KanbanSquare, List, GanttChart, CalendarDays, SlidersHorizontal, X, Archive, ChevronDown, Users, Printer, Upload, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, downloadFrom } from "../lib/api";
import { useApp } from "../context/AppContext";
import { PageHeader, AccentButton, GhostButton, PRIORITY, fmtDate } from "../components/common";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import Board from "./tasks/Board";
import ListView, { ColumnMenu, COLS, DEFAULT_HIDDEN } from "./tasks/ListView";
import { Timeline, Calendar } from "./tasks/TimelineCalendar";
import TaskCreate from "./tasks/TaskCreate";
import TaskDetail from "./tasks/TaskDetail";
import BoardDialog from "./tasks/BoardDialog";
import BoardMembersModal from "./tasks/BoardMembersModal";
import ArchiveView from "./tasks/ArchiveView";
import PrintPreviewDialog from "../components/PrintPreviewDialog";
import { tryNativePrint } from "../lib/printReport";

export const SAVED_VIEWS = [["all", "All Tasks"], ["active", "Active"], ["my", "My Tasks"], ["requested", "Requested by Me"], ["assigned", "Assigned to Me"], ["today", "Due Today"], ["upcoming", "Upcoming"], ["overdue", "Overdue"], ["issues", "Ada Kendala"], ["completed", "Completed"], ["archived", "Archived (Folder Bulanan)"]];
const VIEWS = [["board", "Board", KanbanSquare], ["list", "List", List], ["timeline", "Timeline", GanttChart], ["calendar", "Calendar", CalendarDays]];
const sel = "h-10 rounded-full border bg-surface text-sm font-medium text-ink shadow-sm transition-all hover:bg-surface2 focus:ring-2 focus:ring-brand/20 outline-none cursor-pointer";

import { INITIAL_TASKS } from "../data/initialTasks";

export const DEFAULT_BOARDS = [
  { id: "brd_div_marketing", name: "Marketing", department: "Marketing", color: "#10B981" },
  { id: "brd_div_sales", name: "Sales", department: "Sales", color: "#F59E0B" },
  { id: "brd_div_it", name: "IT", department: "IT", color: "#06B6D4" },
  { id: "brd_div_finance", name: "Finance", department: "Finance", color: "#14B8A6" },
  { id: "brd_div_legal", name: "Legal", department: "Legal", color: "#6366F1" },
  { id: "brd_div_hrga", name: "HRGA", department: "HRGA", color: "#F97316" }
];

export const PRIMARY_SAVED_VIEWS = [
  ["all", "All Tasks"],
  ["active", "Active"],
  ["my", "My Tasks"],
  ["assigned", "Assigned to Me"],
];

export const MORE_SAVED_VIEWS = [
  ["today", "Due Today"],
  ["upcoming", "Upcoming"],
  ["overdue", "Overdue"],
  ["requested", "Requested by Me"],
  ["issues", "Ada Kendala"],
  ["completed", "Completed"],
  ["archived", "Archived (Folder Bulanan)"],
];

export function parseCSV(text) {
  const cleanText = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = cleanText.split(/\r?\n/)[0] || "";
  let commaCount = 0;
  let semiCount = 0;
  let qOpen = false;
  for (let i = 0; i < firstLine.length; i++) {
    if (firstLine[i] === '"') qOpen = !qOpen;
    else if (!qOpen) {
      if (firstLine[i] === ",") commaCount++;
      else if (firstLine[i] === ";") semiCount++;
    }
  }
  const sep = semiCount > commaCount ? ";" : ",";

  const lines = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const next = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === sep && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) {
        lines.push(row);
      }
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell.length > 0)) {
      lines.push(row);
    }
  }

  if (lines.length < 2) return [];

  const headers = lines[0].map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  const items = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];
    const item = {};
    headers.forEach((header, idx) => {
      const val = values[idx] || "";
      if (!val) return;
      if (["title", "nama", "tugas", "name", "judul"].includes(header)) item.title = val;
      else if (["description", "deskripsi", "desc", "catatan"].includes(header)) item.description = val;
      else if (["status"].includes(header)) item.status = val.toLowerCase().replace(/\s+/g, "_");
      else if (["priority", "prioritas"].includes(header)) item.priority = val.toLowerCase();
      else if (["assignee", "assignee_id", "petugas", "assignees", "pic"].includes(header)) {
        const list = val.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
        item.assignee_id = list[0] || val;
        item.assignee_ids = list;
      }
      else if (["requestor", "requestor_id", "requestor_ids", "peminta"].includes(header)) {
        const list = val.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
        item.requestor_id = list[0] || val;
        item.requestor_ids = list;
      }
      else if (["brand", "label", "labels", "label_ids"].includes(header)) {
        item.brand = val;
        item.label_ids = val.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
      }
      else if (["item", "item_type", "tipe", "jenis"].includes(header)) item.item_type = val;
      else if (["link", "link_url", "linkfilefolder", "url"].includes(header)) item.link_url = val;
      else if (["deadline", "tenggat", "due_date"].includes(header)) item.deadline = val;
      else if (["department", "divisi", "division"].includes(header)) item.department = val;
      else if (["board", "board_id"].includes(header)) item.board = val;
      else if (["number", "number_str"].includes(header)) item.number_str = val;
    });

    if (!item.title && values.length >= 3) {
      if (headers[2] === "title" || headers[0] === "id") {
        item.title = values[2] || values[0];
      } else if (values[0]) {
        item.title = values[0];
      }
    }

    if (item.title) {
      items.push(item);
    }
  }

  return items;
}

let GLOBAL_TASKS_CACHE = null;

export function TaskWorkspace({ projectId, compactHeader }) {
  const { me, isAdmin, isManager, users, userMap, labels, labelMap, statuses, subscribe, prefs, savePrefs, ws, t } = useApp();
  const [params, setParams] = useSearchParams();
  const [boards, setBoards] = useState(() => {
    try {
      const cached = localStorage.getItem("circle_boards_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const clean = parsed.filter((b) => b && b.id !== "brd_1");
          if (clean.length > 0) return clean;
        }
      }
    } catch {}
    return DEFAULT_BOARDS;
  });
  const [boardId, setBoardId] = useState(params.get("board") || "");
  const [editBoard, setEditBoard] = useState(null);
  const [managingMembersBoard, setManagingMembersBoard] = useState(null);
  const [tasks, setTasks] = useState(() => {
    if (GLOBAL_TASKS_CACHE && Array.isArray(GLOBAL_TASKS_CACHE)) {
      return GLOBAL_TASKS_CACHE;
    }
    try {
      const cached = localStorage.getItem("circle_tasks_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          GLOBAL_TASKS_CACHE = parsed;
          return parsed;
        }
      }
    } catch {}
    return INITIAL_TASKS;
  });
  const [loading] = useState(false);
  const [importModal, setImportModal] = useState(null); // null | "csv" | "json"
  const [allImportBoards, setAllImportBoards] = useState(DEFAULT_BOARDS);
  const [importTargetBoardId, setImportTargetBoardId] = useState("");
  const [overrideImportBoard, setOverrideImportBoard] = useState(true);
  const jsonInputRef = useRef(null);
  const csvInputRef = useRef(null);

  const openImportModal = (type) => {
    setImportTargetBoardId(boardId || boards.find((b) => b.department?.toLowerCase() === me?.department?.toLowerCase())?.id || allImportBoards[0]?.id || "");
    setOverrideImportBoard(true);
    setImportModal(type);
  };

  const importCSVTasks = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsedItems = parseCSV(text);
      if (!parsedItems.length) {
        return toast.error("File CSV tidak berisi data tugas yang valid. Pastikan header memiliki kolom Title/Judul.");
      }
      const targetBoard = allImportBoards.find((b) => b.id === importTargetBoardId) || boards.find((b) => b.id === importTargetBoardId);
      const { data } = await api.post("/tasks/import-csv", {
        items: parsedItems,
        board_id: importTargetBoardId || boardId || undefined,
        department: targetBoard?.department || undefined,
        override_board: Boolean(importTargetBoardId && overrideImportBoard)
      });
      setImportModal(null);
      toast.success(`Berhasil mengimpor ${data.count || parsedItems.length} kartu tugas ke ${targetBoard?.name || "Board tujuan"}!`);
      if (importTargetBoardId && boards.some((b) => b.id === importTargetBoardId) && importTargetBoardId !== boardId) {
        setBoardId(importTargetBoardId);
        params.set("board", importTargetBoardId);
        setParams(params);
      }
      loadBoards();
      load();
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengimpor file CSV"));
    } finally {
      e.target.value = "";
    }
  };

  const importJSONTasks = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.tasks || [parsed]);
      const targetBoard = allImportBoards.find((b) => b.id === importTargetBoardId) || boards.find((b) => b.id === importTargetBoardId);
      const { data } = await api.post("/tasks/import", {
        items,
        board_id: importTargetBoardId || boardId || undefined,
        department: targetBoard?.department || undefined,
        override_board: Boolean(importTargetBoardId && overrideImportBoard)
      });
      setImportModal(null);
      toast.success(`Berhasil mengimpor ${data.count || items.length} kartu tugas ke ${targetBoard?.name || "Board tujuan"}!`);
      if (importTargetBoardId && boards.some((b) => b.id === importTargetBoardId) && importTargetBoardId !== boardId) {
        setBoardId(importTargetBoardId);
        params.set("board", importTargetBoardId);
        setParams(params);
      }
      loadBoards();
      load();
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengimpor file JSON"));
    } finally {
      e.target.value = "";
    }
  };

  const [projects, setProjects] = useState({});
  const [saved, setSaved] = useState(params.get("view") || "all");
  const [view, setView] = useState(params.get("kanban") ? "board" : prefs.task_view || "board");
  const [f, setF] = useState({ q: "", label: params.get("label") || "", assignee_id: params.get("assignee") || "", priority: "", department: "" });
  const [groupBy, setGroupBy] = useState("none");
  const [selected, setSelected] = useState([]);
  const [create, setCreate] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [reportMode, setReportMode] = useState("checkpoint");
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const handlePrint = () => {
    if (!tryNativePrint()) {
      setPrintPreviewOpen(true);
    }
  };
  const openId = params.get("task") || params.get("id");
  const query = useCallback(() => ({
    view: saved,
    ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)),
    ...(projectId ? { project_id: projectId } : {}),
    ...(boardId ? { board_id: boardId } : {})
  }), [saved, f, projectId, boardId]);
  const loadBoards = useCallback(() => {
    api.get("/boards", { params: { all: "1" } }).then((r) => {
      if (Array.isArray(r.data) && r.data.length > 0) {
        setAllImportBoards(r.data);
      }
    }).catch(() => {});
    return api.get("/boards").then((r) => {
      if (Array.isArray(r.data) && r.data.length > 0) {
        setBoards(r.data);
        try { localStorage.setItem("circle_boards_cache", JSON.stringify(r.data)); } catch {}
      }
    }).catch(() => {});
  }, []);
  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => subscribe((e) => {
    if (e.type === "tasks:changed" || e.type === "boards:changed" || e.type === "groups:changed" || e.type === "workspace:updated" || e.type === "org:changed") {
      loadBoards();
    }
  }), [subscribe, loadBoards]);
  const didAutoSelectBoardRef = useRef(false);
  const loadSeqRef = useRef(0);

  const isTaskAssignedToMe = useCallback((t, uid) => {
    if (!t || !uid) return false;
    if (t.assignee_id === uid) return true;
    if (Array.isArray(t.assignee_ids) && t.assignee_ids.includes(uid)) return true;
    if (Array.isArray(t.collaborator_ids) && t.collaborator_ids.includes(uid)) return true;
    if (Array.isArray(t.checkpoints) && t.checkpoints.some((c) => c && c.assignee_id === uid)) return true;
    return false;
  }, []);

  const shouldShowTask = useCallback((t) => {
    if (!t || !t.id) return false;
    const isArchive = view === "archive" || saved === "archived";
    if (isArchive) {
      if (!t.archived) return false;
    } else {
      if (t.archived) return false;
      if (saved === "active" && t.status === "done") return false;
      if (saved === "completed" && t.status !== "done") return false;
      if ((saved === "my" || saved === "assigned") && !isTaskAssignedToMe(t, me?.user_id)) return false;
      if (saved === "requested" && t.created_by !== me?.user_id && !(Array.isArray(t.requestor_ids) && t.requestor_ids.includes(me?.user_id))) return false;
      if (saved === "today") {
        const todayStr = new Date().toISOString().slice(0, 10);
        if (!t.deadline || String(t.deadline).slice(0, 10) !== todayStr) return false;
      }
      if (saved === "overdue") {
        if (t.status === "done" || !t.deadline || new Date(t.deadline) >= new Date()) return false;
      }
    }
    if (projectId && t.project_id !== projectId) return false;
    if (boardId) {
      if (t.board_id !== boardId) {
        const selectedBoard = boards.find((b) => b.id === boardId);
        const userDept = String(me?.department || "").trim().toLowerCase();
        const boardDept = String(selectedBoard?.department || "").trim().toLowerCase();
        const isOwnDivBoard = Boolean(userDept && boardDept && userDept === boardDept);
        const canSeeCrossBoard = !isAdmin && isOwnDivBoard && me?.user_id && (
          isTaskAssignedToMe(t, me.user_id) ||
          t.created_by === me.user_id ||
          (Array.isArray(t.requestor_ids) && t.requestor_ids.includes(me.user_id))
        );
        if (!canSeeCrossBoard) return false;
      }
    }
    if (f.assignee_id && !isTaskAssignedToMe(t, f.assignee_id)) return false;
    if (f.priority && String(t.priority || "").toLowerCase() !== String(f.priority).toLowerCase()) return false;
    if (f.label && !(t.label_ids || []).includes(f.label)) return false;
    if (f.department && t.department !== f.department) return false;
    if (f.q) {
      const qLower = String(f.q).toLowerCase();
      const hit =
        (t.title || "").toLowerCase().includes(qLower) ||
        (t.description || "").toLowerCase().includes(qLower) ||
        (t.number_str || "").toLowerCase().includes(qLower);
      if (!hit) return false;
    }
    if (!isAdmin && me?.user_id) {
      const involved =
        isTaskAssignedToMe(t, me.user_id) ||
        t.created_by === me.user_id ||
        (Array.isArray(t.requestor_ids) && t.requestor_ids.includes(me.user_id));
      const sameDept = Boolean(
        me.department && t.department &&
        String(me.department).trim().toLowerCase() === String(t.department).trim().toLowerCase()
      );
      const accessibleBoard = boards.some((b) => b.id === t.board_id && b.is_accessible);
      if (!involved && !sameDept && !accessibleBoard) return false;
    }
    return true;
  }, [view, saved, projectId, boardId, boards, me?.user_id, me?.department, isAdmin, f, isTaskAssignedToMe]);

  useEffect(() => {
    if (didAutoSelectBoardRef.current) return;
    if (!boardId && !params.get("board") && boards.length > 0 && me?.department && !isAdmin) {
      const myBoard = boards.find(
        (b) => b.department && b.department.toLowerCase() === me.department.toLowerCase()
      );
      if (myBoard) {
        didAutoSelectBoardRef.current = true;
        setBoardId(myBoard.id);
      }
    }
  }, [boards, me?.department, isAdmin, boardId, params]);
  const pickBoard = (id) => {
    didAutoSelectBoardRef.current = true;
    setBoardId(id);
    setSelected([]);
    if (id) params.set("board", id);
    else params.delete("board");
    setParams(params);
  };
  const newTask = (extra = {}) => setCreate({ board_id: boardId || "", ...extra });
  const load = useCallback(() => {
    const seq = ++loadSeqRef.current;
    return api.get("/tasks", { params: query() }).then((r) => {
      if (seq !== loadSeqRef.current) return;
      if (Array.isArray(r.data)) {
        setTasks(r.data);
        if (!Object.values(f).some(Boolean) && saved === "all" && !boardId && !projectId) {
          GLOBAL_TASKS_CACHE = r.data;
          try {
            localStorage.setItem("circle_tasks_cache", JSON.stringify(r.data));
            localStorage.setItem("circle_cache_tasks", JSON.stringify(r.data));
          } catch {}
        }
      }
    }).catch(() => {});
  }, [query, f, saved, boardId, projectId]);

  const updateTaskLocally = useCallback((taskId, patch) => {
    setTasks((prev) => {
      const next = prev.map((t) => t.id === taskId ? { ...t, ...patch } : t);
      if (!Object.values(f).some(Boolean) && saved === "all" && !boardId && !projectId) {
        GLOBAL_TASKS_CACHE = next;
        try {
          localStorage.setItem("circle_tasks_cache", JSON.stringify(next));
          localStorage.setItem("circle_cache_tasks", JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, [f, saved, boardId, projectId]);

  const upsertTaskImmediately = useCallback((taskObj) => {
    if (!taskObj?.id) return;
    setTasks((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const matches = shouldShowTask(taskObj);
      const next = matches
        ? (list.some((x) => x.id === taskObj.id)
            ? list.map((x) => (x.id === taskObj.id ? { ...x, ...taskObj } : x))
            : [taskObj, ...list])
        : list.filter((x) => x.id !== taskObj.id);
      if (!Object.values(f).some(Boolean) && saved === "all" && !boardId && !projectId) {
        GLOBAL_TASKS_CACHE = next;
        try {
          localStorage.setItem("circle_tasks_cache", JSON.stringify(next));
          localStorage.setItem("circle_cache_tasks", JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, [shouldShowTask, f, saved, boardId, projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/projects").then((r) => setProjects(Object.fromEntries(r.data.map((p) => [p.id, p])))); }, []);
  useEffect(() => subscribe((e) => {
    if (e.type === "tasks:deleted" && e.id) {
      setTasks((prev) => prev.filter((x) => x.id !== e.id));
      return;
    }
    if (e.type !== "tasks:changed") return;
    if (e.deleted_id) {
      setTasks((prev) => prev.filter((x) => x.id !== e.deleted_id));
      load();
      return;
    }
    if (e.task?.id) {
      upsertTaskImmediately(e.task);
    }
    load();
  }), [subscribe, load, upsertTaskImmediately]);
  const open = (id) => { params.set("task", id); setParams(params); };
  const close = () => { params.delete("task"); setParams(params); };
  const switchView = (v) => {
    setView(v);
    if (v === "archive") {
      setSaved("archived");
    } else if (saved === "archived") {
      setSaved("all");
    }
    savePrefs({ task_view: v }).catch(() => {});
  };
  const exp = async (format, ids) => {
    try {
      const res = await downloadFrom("/tasks/export", { ...query(), format, ...(ids ? { ids: ids.join(",") } : {}) }, `circle-tasks.${format}`);
      toast.success(`Exported ${res.headers["x-record-count"] || ""} tasks`.replace("  ", " "));
    } catch (e) { toast.error(errMsg(e, "Export failed")); }
  };
  const bulk = async (patch) => { try { const { data } = await api.post("/tasks/bulk", { ids: selected, patch }); toast.success(`Updated ${data.updated} tasks`); setSelected([]); load(); } catch (e) { toast.error(errMsg(e)); } };
  const depts = [...new Set(users.map((u) => u.department).filter(Boolean))];
  const active = Object.values(f).filter(Boolean).length;
  const activeMoreView = MORE_SAVED_VIEWS.find(([k]) => k === saved);

  const activeBoardName = boards.find((b) => b.id === boardId)?.name || t("tasks_all_boards", "Semua Board");

  return (
    <div className="space-y-4">
      <input type="file" ref={jsonInputRef} onChange={importJSONTasks} accept=".json,application/json" className="hidden" />
      <input type="file" ref={csvInputRef} onChange={importCSVTasks} accept=".csv,text/csv" className="hidden" />

      {/* Print-only executive header */}
      <div className="hidden print:block border-b-2 border-slate-800 pb-3 mb-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">CIRCLE WORKSPACE · TASK REPORT</p>
            <h1 className="text-2xl font-extrabold text-slate-900">Laporan Tugas — {activeBoardName}</h1>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>Tampilan: <b className="capitalize">{view}</b> · Total: <b>{tasks.length} tugas</b></p>
            <p>Dicetak: {fmtDate(new Date().toISOString(), "d MMM yyyy HH:mm")}</p>
          </div>
        </div>
      </div>

      {/* 1. Header with Compact Action Group */}
      {!compactHeader && (
        <div className="print:hidden">
          <PageHeader
            icon={CheckSquare}
            title={t("tasks_page_title", "Tasks")}
            subtitle={t("tasks_page_subtitle", "One shared task database across board, list, timeline and calendar.")}
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                <AccentButton onClick={() => newTask()} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold shadow-xs" data-testid="new-task-btn">
                  <Plus size={14} />
                  <span>{t("tasks_new_btn", "Tugas Baru")}</span>
                </AccentButton>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <GhostButton className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold" data-testid="export-menu-btn">
                      <Download size={14} />
                      <span>{t("tasks_export_import", "Ekspor / Impor")}</span>
                      <ChevronDown size={12} className="opacity-60 ml-0.5" />
                    </GhostButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-surface min-w-[220px]" align="end">
                    <DropdownMenuItem onClick={() => exp("csv")} data-testid="export-csv-btn">
                      <Download size={13} className="mr-2" /> {t("tasks_export_csv", "Ekspor CSV")} (Filter aktif)
                    </DropdownMenuItem>
                    {selected.length > 0 && (
                      <DropdownMenuItem onClick={() => exp("csv", selected)} data-testid="export-selected-btn">
                        <Download size={13} className="mr-2" /> Ekspor terpilih ({selected.length})
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => exp("json")} data-testid="export-json-btn">
                      <Download size={13} className="mr-2" /> Ekspor JSON
                    </DropdownMenuItem>
                    <div className="my-1 border-t opacity-50" />
                    <DropdownMenuItem onClick={() => openImportModal("csv")} data-testid="import-csv-btn">
                      <FileSpreadsheet size={13} className="mr-2 text-emerald-600 dark:text-emerald-400" /> {t("tasks_import_csv", "Impor File CSV (.csv)")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openImportModal("json")} data-testid="import-json-btn">
                      <Upload size={13} className="mr-2 text-blue-600 dark:text-blue-400" /> Impor File JSON (.json)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <GhostButton
                  onClick={handlePrint}
                  className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold border bg-surface text-sub hover:text-ink hover:bg-surface2"
                  title="Cetak / Simpan PDF langsung tampilan ini"
                  data-testid="print-tasks-btn"
                >
                  <Printer size={14} />
                  <span>{t("tasks_print", "Print")}</span>
                </GhostButton>

                <GhostButton
                  onClick={() => switchView("archive")}
                  className={`h-10 rounded-full px-4 text-xs sm:text-sm font-semibold transition-all ${
                    view === "archive" || saved === "archived"
                      ? "bg-brand text-white shadow-xs"
                      : "bg-surface text-sub hover:text-ink hover:bg-surface2 border"
                  }`}
                  data-testid="archive-header-btn"
                >
                  <Archive size={14} />
                  <span>{t("tasks_archive", "Arsip")}</span>
                </GhostButton>
              </div>
            }
          />
        </div>
      )}

      {compactHeader && (
        <div className="mb-2 flex justify-end gap-2 print:hidden">
          <AccentButton onClick={() => newTask()} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold" data-testid="new-task-btn">
            <Plus size={14} /> {t("tasks_new_btn", "Tugas Baru")}
          </AccentButton>
          <GhostButton onClick={() => openImportModal("csv")} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold" data-testid="import-csv-compact-btn">
            <Upload size={14} /> Impor
          </GhostButton>
          <GhostButton onClick={() => exp("csv")} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold" data-testid="export-csv-btn">
            <Download size={14} /> Ekspor
          </GhostButton>
          <GhostButton onClick={handlePrint} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold border" data-testid="print-tasks-btn">
            <Printer size={14} /> {t("tasks_print", "Print")}
          </GhostButton>
          <GhostButton onClick={() => switchView("archive")} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold border" data-testid="archive-header-btn">
            <Archive size={14} /> {t("tasks_archive", "Arsip")}
          </GhostButton>
        </div>
      )}

      {editBoard && (
        <BoardDialog
          board={editBoard}
          onClose={() => setEditBoard(null)}
          onSaved={(b) => {
            loadBoards();
            load();
            if (!b && editBoard.id === boardId) pickBoard("");
          }}
        />
      )}

      {managingMembersBoard && (
        <BoardMembersModal
          board={managingMembersBoard}
          onClose={() => setManagingMembersBoard(null)}
          onUpdated={() => {
            loadBoards();
            load();
          }}
        />
      )}

      {/* Unified Toolbar: Board Dropdown, Search, Filter, Columns (Left) + View Switcher (Right) */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between print:hidden">
        {/* Left Group: Board Dropdown + Search + Filter + Columns */}
        <div className="flex items-center gap-2 flex-wrap">
          {!projectId && (() => {
            const currentBoard = boards.find((b) => b.id === boardId);
            return (
              <div className="flex items-center gap-1.5 shrink-0">
                <select
                  value={boardId}
                  onChange={(e) => pickBoard(e.target.value)}
                  className="h-10 max-w-[180px] sm:max-w-[220px] truncate rounded-full border bg-surface px-4 text-xs sm:text-sm font-semibold text-ink shadow-xs outline-none hover:bg-surface2 cursor-pointer transition-all"
                  data-testid="board-dropdown-select"
                >
                  <option value="">{t("tasks_all_boards", "Semua Board")}</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.task_count || 0})
                    </option>
                  ))}
                </select>

                {currentBoard && (
                  <button
                    type="button"
                    onClick={() => setManagingMembersBoard(currentBoard)}
                    className="flex h-10 items-center gap-1.5 rounded-full border bg-surface px-4 text-xs sm:text-sm font-semibold text-ink shadow-xs hover:bg-surface2 transition-all cursor-pointer shrink-0"
                    title="Anggota & Undang Orang ke Board"
                    data-testid="board-manage-members-btn"
                  >
                    <Users size={14} className="text-brand shrink-0" />
                    <span className="hidden sm:inline">Anggota</span>
                    <span className="rounded-full bg-brand/10 text-brand px-1.5 py-0.2 text-[10px] font-bold">
                      + Invite
                    </span>
                  </button>
                )}
              </div>
            );
          })()}

          <div className="relative flex h-10 w-44 sm:w-56 md:w-64 shrink-0 items-center rounded-full border bg-surface px-4 shadow-xs transition-all focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand">
            <Search size={14} className="text-sub mr-2 shrink-0" />
            <input
              value={f.q}
              onChange={(e) => setF({ ...f, q: e.target.value })}
              placeholder={t("tasks_search_placeholder", "Cari tugas atau ID...")}
              className="w-full bg-transparent text-xs sm:text-sm outline-none placeholder:text-sub text-ink"
              data-testid="task-search-input"
            />
            {f.q && (
              <button onClick={() => setF({ ...f, q: "" })} className="text-sub hover:text-ink p-1 rounded-full" aria-label="Hapus pencarian">
                <X size={13} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-xs sm:text-sm font-semibold transition-all shadow-xs ${
              showFilters || active > 0
                ? "bg-brand text-white border-transparent"
                : "bg-surface text-sub hover:text-ink hover:bg-surface2"
            }`}
            data-testid="mobile-filters-btn"
          >
            <SlidersHorizontal size={14} />
            <span>{t("tasks_filter", "Filter")}</span>
            {active > 0 && (
              <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold ${
                showFilters || active > 0 ? "bg-white text-brand" : "bg-brand text-white"
              }`}>
                {active}
              </span>
            )}
          </button>

          {view === "list" && (() => {
            const standardKeys = new Set(COLS.map((c) => c[0].toLowerCase()));
            const standardNames = new Set(COLS.map((c) => c[1].toLowerCase()));
            const customCols = (ws.task_fields || [])
              .filter((field) => {
                const k = (field.key || field.name || "").toLowerCase();
                const n = (field.name || "").toLowerCase();
                return n !== "estimate" && !standardKeys.has(k) && !standardNames.has(n);
              })
              .map((field) => [field.key || field.name, field.name, 10]);

            const rawCols = [...COLS, ...customCols];
            const seen = new Set();
            const allCols = rawCols.filter(([k]) => {
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });

            const targetPrefix = ["requestor_id", "assignee_id", "label_ids", "item_type", "title", "priority", "link_url", "status"];
            const isOutdatedOrder =
              !prefs.task_sheet?.order ||
              prefs.task_sheet.order.includes("deadline_compliance") ||
              prefs.task_sheet.order.indexOf("link_url") > prefs.task_sheet.order.indexOf("status") ||
              prefs.task_sheet.order.indexOf("priority") > prefs.task_sheet.order.indexOf("link_url") ||
              prefs.task_sheet.order.filter((x) => x === "priority").length > 1;

            const effectiveOrder = isOutdatedOrder ? targetPrefix : prefs.task_sheet.order;
            const sheetCols = [
              ...(effectiveOrder || []).map((k) => allCols.find((c) => c[0] === k)).filter(Boolean),
              ...allCols.filter((c) => !(effectiveOrder || []).includes(c[0]))
            ];
            return <ColumnMenu cols={sheetCols} cfg={prefs.task_sheet || { hidden: DEFAULT_HIDDEN }} save={(c) => savePrefs({ task_sheet: c })} />;
          })()}
        </div>

        {/* Display Modes (Board, List, Timeline, Calendar, Arsip) on Right */}
        <div className="inline-flex h-10 items-center gap-0.5 rounded-full border bg-surface p-1 shadow-2xs shrink-0 self-start sm:self-auto" data-testid="view-switcher">
          {VIEWS.map(([k, l, I]) => (
            <button
              key={k}
              onClick={() => switchView(k)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs sm:text-sm font-semibold transition-all ${
                view === k
                  ? "bg-brand text-white shadow-xs"
                  : "text-sub hover:text-ink hover:bg-surface2"
              }`}
              data-testid={`view-${k}`}
            >
              <I size={14} />
              <span className="hidden sm:inline">{t(`tasks_tab_${k}`, l)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 4. Collapsible Clean Filter Bar (shown when toggled or when active filters exist) */}
      {(showFilters || active > 0) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-2xl border bg-surface p-2.5 shadow-2xs animate-subpage-enter print:hidden"
          data-testid="filter-strip"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-sub px-1">Filter:</span>
          <select
            value={saved}
            onChange={(e) => { setSaved(e.target.value); setSelected([]); }}
            className="h-8 rounded-lg border bg-surface2 px-2 text-xs font-medium text-ink outline-none hover:bg-surface transition-colors"
            data-testid="filter-saved-view"
          >
            <optgroup label="Tampilan Utama">
              {PRIMARY_SAVED_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </optgroup>
            <optgroup label="Tampilan Lainnya">
              {MORE_SAVED_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </optgroup>
          </select>
          <select
            value={f.label}
            onChange={(e) => setF({ ...f, label: e.target.value })}
            className="h-8 rounded-lg border bg-surface2 px-2 text-xs font-medium text-ink outline-none hover:bg-surface transition-colors"
            data-testid="filter-label"
          >
            <option value="">Semua Brand</option>
            {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select
            value={f.assignee_id}
            onChange={(e) => setF({ ...f, assignee_id: e.target.value })}
            className="h-8 rounded-lg border bg-surface2 px-2 text-xs font-medium text-ink outline-none hover:bg-surface transition-colors"
            data-testid="filter-assignee"
          >
            <option value="">Semua Assignee</option>
            {users.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
          </select>
          <select
            value={f.priority}
            onChange={(e) => setF({ ...f, priority: e.target.value })}
            className="h-8 rounded-lg border bg-surface2 px-2 text-xs font-medium text-ink outline-none hover:bg-surface transition-colors"
            data-testid="filter-priority"
          >
            <option value="">Semua Prioritas</option>
            {Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
          </select>
          <select
            value={f.department}
            onChange={(e) => setF({ ...f, department: e.target.value })}
            className="h-8 rounded-lg border bg-surface2 px-2 text-xs font-medium text-ink outline-none hover:bg-surface transition-colors"
            data-testid="filter-task-department"
          >
            <option value="">Semua Divisi</option>
            {depts.map((d) => <option key={d}>{d}</option>)}
          </select>
          {view === "list" && (
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className="h-8 rounded-lg border bg-surface2 px-2 text-xs font-medium text-ink outline-none hover:bg-surface transition-colors"
              data-testid="group-by-select"
            >
              <option value="status">Group: Status</option>
              <option value="assignee">Group: Assignee</option>
              <option value="department">Group: Department</option>
              <option value="label">Group: IP / Brand</option>
              <option value="none">No grouping</option>
            </select>
          )}
          {active > 0 && (
            <button
              onClick={() => setF({ q: "", label: "", assignee_id: "", priority: "", department: "" })}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors ml-auto"
              data-testid="clear-filters-btn"
            >
              <X size={13} /> Reset Filter
            </button>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <div className="sticky top-16 md:top-2 z-30 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border bg-surface p-2.5 shadow-lg print:hidden" data-testid="bulk-actions-bar">
          <span className="px-2 text-sm font-semibold">{selected.length} selected</span>
          <select onChange={(e) => e.target.value && bulk({ status: e.target.value })} value="" className="h-10 rounded-full border bg-surface2 px-4 text-sm font-medium" data-testid="bulk-status"><option value="">Set status…</option>{statuses.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select>
          <select onChange={(e) => e.target.value && bulk({ priority: e.target.value })} value="" className="h-10 rounded-full border bg-surface2 px-4 text-sm font-medium" data-testid="bulk-priority"><option value="">Set priority…</option>{Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</select>
          <select onChange={(e) => e.target.value && bulk({ assignee_id: e.target.value })} value="" className="h-10 rounded-full border bg-surface2 px-4 text-sm font-medium" data-testid={`bulk-assignee`}><option value="">Assign to…</option>{users.filter((u) => !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant").map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select>
          <button onClick={() => bulk({ archived: saved !== "archived" })} className="inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold hover:bg-surface2 transition-colors" data-testid="bulk-archive">{saved === "archived" ? "Unarchive" : "Archive"}</button>
          <button onClick={() => exp("csv", selected)} className="inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold hover:bg-surface2 transition-colors" data-testid="bulk-export">Export</button>
          <button onClick={() => setSelected([])} className="ml-auto text-sub" aria-label="Clear selection"><X size={16} /></button>
        </div>
      )}
        <div className="min-h-[350px]">
          {(view === "archive" || saved === "archived") ? <ArchiveView tasks={tasks} onOpen={open} reload={load} projects={projects} />
          : view === "board" ? (
            <Board
              tasks={tasks}
              board={boards.find((b) => b.id === boardId)}
              onInvite={() => {
                const b = boards.find((x) => x.id === boardId);
                if (b) setManagingMembersBoard(b);
                else if (boards.length > 0) setManagingMembersBoard(boards[0]);
              }}
              onOpen={open}
              onNew={(status) => newTask({ status })}
              reload={load}
              onMoveTask={updateTaskLocally}
            />
          )
          : view === "list" ? <ListView tasks={tasks} projects={projects} onOpen={open} selected={selected} setSelected={setSelected} reload={load} groupBy={groupBy} boardId={boardId} reportMode={reportMode} onReportModeChange={setReportMode} />
          : view === "timeline" ? <Timeline tasks={tasks} onOpen={open} /> : <Calendar tasks={tasks} onOpen={open} />}
        </div>

      {/* Import Target Division/Board Modal */}
      <Dialog open={!!importModal} onOpenChange={(v) => !v && setImportModal(null)}>
        <DialogContent className="bg-surface rounded-3xl max-w-md" data-testid="task-import-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              {importModal === "json" ? <Upload size={18} className="text-blue-600" /> : <FileSpreadsheet size={18} className="text-emerald-600" />}
              Impor Tugas ({importModal === "json" ? "JSON" : "CSV"})
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-sub">
                Divisi / Board Tujuan
              </label>
              <select
                value={importTargetBoardId}
                onChange={(e) => setImportTargetBoardId(e.target.value)}
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm font-medium text-ink outline-none"
                data-testid="import-target-board-select"
              >
                <option value="">Otomatis (sesuai kolom Department / Board di file)</option>
                {allImportBoards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.department ? `(${b.department})` : ""}
                  </option>
                ))}
              </select>
            </div>
            {importTargetBoardId && (
              <label className="flex items-start gap-2 rounded-xl border bg-surface2/60 p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideImportBoard}
                  onChange={(e) => setOverrideImportBoard(e.target.checked)}
                  className="mt-0.5 accent-[var(--c-accent)]"
                  data-testid="import-override-board-checkbox"
                />
                <span className="text-ink">
                  <b>Masukkan semua data impor ke board ini</b>
                  <span className="block text-sub mt-0.5">
                    Centang agar semua baris masuk ke divisi terpilih meski file tidak memiliki kolom Board/Department atau nilainya berbeda.
                  </span>
                </span>
              </label>
            )}
            <div className="rounded-xl bg-surface2 p-3 text-xs text-sub space-y-1">
              <p className="font-semibold text-ink">Kolom yang didukung:</p>
              <p>Title, Requestor, Assignee, Brand, Item, Priority, Link, Deadline, Status, Department/Board</p>
              <p className="opacity-80">Mendukung pemisah koma (,) dan titik koma (;) dari Excel.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <GhostButton type="button" onClick={() => setImportModal(null)} className="h-10 rounded-full px-4 text-sm">
              Batal
            </GhostButton>
            <AccentButton
              type="button"
              onClick={() => {
                if (importModal === "json") jsonInputRef.current?.click();
                else csvInputRef.current?.click();
              }}
              className="h-10 rounded-full px-5 text-sm font-semibold"
              data-testid="confirm-pick-import-file-btn"
            >
              Pilih File &amp; Impor
            </AccentButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskCreate
        open={!!create}
        onOpenChange={(v) => !v && setCreate(null)}
        defaults={{ ...create, project_id: projectId }}
        onCreated={(newT) => {
          if (newT?.id) {
            upsertTaskImmediately(newT);
          }
          load();
        }}
      />
      <TaskDetail
        id={openId}
        onClose={close}
        onChanged={(updatedT) => {
          if (updatedT?.id) {
            upsertTaskImmediately(updatedT);
          }
          load();
        }}
      />
      <PrintPreviewDialog
        open={printPreviewOpen}
        onOpenChange={setPrintPreviewOpen}
        mode="list"
        tasks={tasks}
        boardName={activeBoardName}
        view={view}
        reportMode={reportMode}
        userMap={userMap}
        labelMap={labelMap}
        statuses={statuses}
      />
    </div>
  );
}

export default function Tasks() {
  return <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10 animate-crossfade print:max-w-none print:p-0" data-testid="tasks-page"><TaskWorkspace /></div>;
}
