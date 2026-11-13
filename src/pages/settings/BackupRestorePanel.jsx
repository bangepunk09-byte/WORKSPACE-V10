import { useCallback, useEffect, useState } from "react";
import {
  Database,
  Download,
  Upload,
  Cloud,
  CloudUpload,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  MessageCircle,
  CheckSquare,
  Users,
  Newspaper,
  FolderKanban,
  FileArchive,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { googleSignIn } from "../../lib/auth";
import {
  subscribeFirebaseAuth,
  saveBackupToFirestore,
  listFirestoreBackups,
  loadBackupFromFirestore,
  deleteFirestoreBackup,
} from "../../lib/firestoreBackup";
import { Card } from "./AdminPanels";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog";

function clearWorkspaceCaches() {
  try {
    const prefixes = [
      "circle_tasks_cache",
      "circle_cache_tasks",
      "circle_users_cache",
      "circle_projects_cache",
      "circle_groups_cache",
      "circle_cache_posts",
      "circle_posts_cache",
      "circle_cache_meetings",
      "circle_cache_conversations",
      "circle_convs_cache",
      "circle_drive_shortcuts_cache",
      "circle_stats_team_cache",
      "circle_org_units_cache",
      "circle_admin_",
      "circle_boards_cache",
      "circle_notifications_cache",
      "circle_labels_cache",
    ];
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

function summarizeBackupPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.summary && typeof payload.summary === "object") {
    return payload.summary;
  }
  const d = payload.data && typeof payload.data === "object" ? payload.data : payload;
  return {
    users: Array.isArray(d.users)
      ? d.users.filter((u) => !u?.is_bot && u?.role !== "assistant").length
      : 0,
    tasks: Array.isArray(d.tasks) ? d.tasks.length : 0,
    projects: Array.isArray(d.projects) ? d.projects.length : 0,
    boards: Array.isArray(d.boards) ? d.boards.length : 0,
    conversations: Array.isArray(d.conversations) ? d.conversations.length : 0,
    groups: Array.isArray(d.groups) ? d.groups.length : 0,
    messages: Array.isArray(d.messages) ? d.messages.length : 0,
    posts: Array.isArray(d.posts) ? d.posts.length : 0,
  };
}

export default function BackupRestorePanel() {
  const { checkAuth, reloadAll, reloadWs, reloadUsers, reloadTasks, reloadLabels } = useApp();
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // File restore confirmation dialog
  const [pendingRestore, setPendingRestore] = useState(null); // { source: 'file' | 'cloud', label, payload, summary }

  // Cloud Firestore state
  const [fbUser, setFbUser] = useState(null);
  const [cloudLabel, setCloudLabel] = useState("");
  const [cloudBackups, setCloudBackups] = useState([]);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [savingCloud, setSavingCloud] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const { data } = await api.get("/admin/backup/summary");
      setSummary(data?.summary || null);
    } catch (e) {
      toast.error(errMsg(e, "Gagal memuat ringkasan data workspace"));
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const fetchCloudSnapshots = useCallback(async (user) => {
    if (!user) {
      setCloudBackups([]);
      return;
    }
    setLoadingCloud(true);
    setCloudError("");
    try {
      const rows = await listFirestoreBackups();
      setCloudBackups(rows);
    } catch (e) {
      const rawMsg = e?.message || "";
      if (rawMsg.includes("Missing or insufficient permissions") || rawMsg.includes("permission-denied")) {
        setCloudError("Aturan keamanan Firestore (firestore.rules) belum dipublikasikan ke project Firebase Anda, atau akun belum terverifikasi. Anda tetap dapat menggunakan Backup/Restore File (.json) di atas.");
      } else {
        setCloudError("Gagal memuat daftar snapshot Cloud Firestore.");
      }
    } finally {
      setLoadingCloud(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    const unsub = subscribeFirebaseAuth((user) => {
      setFbUser(user || null);
      if (user) {
        fetchCloudSnapshots(user);
      } else {
        setCloudBackups([]);
      }
    });
    return () => unsub();
  }, [fetchCloudSnapshots]);

  const handleDownloadJson = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get("/admin/backup/export");
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const dateTag = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `circle-workspace-backup-${dateTag}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Full backup berhasil diunduh (.json)!");
    } catch (e) {
      toast.error(errMsg(e, "Gagal mengunduh file backup"));
    } finally {
      setDownloading(false);
    }
  };

  const handleSelectRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const sum = summarizeBackupPayload(parsed);
      const rawData = parsed?.data || parsed;
      if (!rawData || typeof rawData !== "object") {
        throw new Error("Struktur file tidak valid");
      }
      setPendingRestore({
        source: "file",
        label: file.name,
        payload: parsed,
        summary: sum,
      });
    } catch {
      toast.error("File backup tidak valid. Pastikan memilih file .json hasil export CIRCLE Workspace.");
    } finally {
      e.target.value = "";
    }
  };

  const executeRestore = async () => {
    if (!pendingRestore?.payload) return;
    setRestoring(true);
    try {
      const { data } = await api.post("/admin/backup/restore", pendingRestore.payload);
      clearWorkspaceCaches();
      await Promise.allSettled([
        checkAuth?.(),
        reloadWs?.(),
        reloadUsers?.(),
        reloadTasks?.(),
        reloadLabels?.(),
        reloadAll?.(),
      ]);
      setSummary(data?.summary || pendingRestore.summary);
      setPendingRestore(null);
      toast.success("Semua data workspace (chat, task, member, feed, dll) berhasil dipulihkan! 🎉");
      fetchSummary();
    } catch (e) {
      toast.error(errMsg(e, "Gagal memulihkan data backup"));
    } finally {
      setRestoring(false);
    }
  };

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    setCloudError("");
    try {
      await googleSignIn();
      toast.success("Akun Google terhubung untuk Cloud Backup!");
    } catch (e) {
      toast.error("Gagal menghubungkan akun Google. Pastikan popup tidak diblokir browser.");
    } finally {
      setConnectingGoogle(false);
    }
  };

  const handleSaveToCloud = async () => {
    setSavingCloud(true);
    setCloudError("");
    try {
      const { data } = await api.get("/admin/backup/export");
      const saved = await saveBackupToFirestore(data, cloudLabel.trim() || undefined);
      setCloudLabel("");
      toast.success(`Snapshot "${saved.label}" berhasil disimpan ke Cloud Firestore!`);
      await fetchCloudSnapshots(fbUser);
    } catch (e) {
      const rawMsg = e?.message || "";
      if (rawMsg.includes("Missing or insufficient permissions") || rawMsg.includes("permission-denied")) {
        setCloudError("Gagal menulis ke Firestore karena rules keamanan belum aktif/sesuai di project Firebase. Gunakan Download Backup (.json) di atas atau deploy firestore.rules ke project Firebase Anda.");
      }
      toast.error("Gagal menyimpan backup ke Cloud Firestore.");
    } finally {
      setSavingCloud(false);
    }
  };

  const handlePrepareCloudRestore = async (record) => {
    setLoadingCloud(true);
    try {
      const payload = await loadBackupFromFirestore(record.id);
      setPendingRestore({
        source: "cloud",
        label: record.label,
        payload,
        summary: record.summary || summarizeBackupPayload(payload),
      });
    } catch {
      toast.error("Gagal mengunduh snapshot dari Cloud Firestore.");
    } finally {
      setLoadingCloud(false);
    }
  };

  const handleDeleteCloudSnapshot = async (record) => {
    try {
      await deleteFirestoreBackup(record.id);
      setCloudBackups((prev) => prev.filter((x) => x.id !== record.id));
      toast.success("Snapshot cloud dihapus.");
    } catch {
      toast.error("Gagal menghapus snapshot cloud.");
    }
  };

  const metrics = summary
    ? [
        { label: "Chatting & Pesan", value: `${summary.conversations || 0} room · ${summary.messages || 0} pesan`, icon: MessageCircle, tone: "bg-soft-blue text-blue-700 dark:text-blue-300" },
        { label: "Task & Proyek", value: `${summary.tasks || 0} task · ${summary.projects || 0} proyek`, icon: CheckSquare, tone: "bg-soft-red text-rose-700 dark:text-rose-300" },
        { label: "Member & Divisi", value: `${summary.users || 0} member · ${summary.org_units || 0} unit`, icon: Users, tone: "bg-soft-green text-emerald-700 dark:text-emerald-300" },
        { label: "Feed Beranda & Polling", value: `${summary.posts || 0} postingan · ${summary.polls || 0} polling`, icon: Newspaper, tone: "bg-soft-purple text-violet-700 dark:text-violet-300" },
        { label: "Board & Label", value: `${summary.boards || 0} board · ${summary.labels || 0} label`, icon: FolderKanban, tone: "bg-soft-yellow text-amber-700 dark:text-amber-300" },
        { label: "File & Stiker", value: `${summary.upload_files || 0} file upload · ${summary.stickers || 0} stiker`, icon: FileArchive, tone: "bg-surface2 text-ink" },
      ]
    : [];

  return (
    <div className="space-y-5 animate-crossfade" data-testid="backup-restore-panel">
      {/* Live Inventory */}
      <Card title="Data Workspace Saat Ini" testid="backup-summary-card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
          <p className="text-xs text-sub">
            Seluruh data chatting, tugas, proyek, member, feed Beranda, struktur divisi, pengaturan branding, dan file terunggah akan ikut dicadangkan.
          </p>
          <button
            type="button"
            onClick={fetchSummary}
            disabled={loadingSummary}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border bg-surface2 px-3 text-xs font-semibold text-ink hover:bg-surface transition-colors"
            data-testid="refresh-backup-summary-btn"
          >
            <RefreshCw size={13} className={loadingSummary ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>

        {loadingSummary && !summary ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-surface2 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {metrics.map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.label}
                  className="flex items-center gap-3 rounded-2xl border bg-surface2/50 p-3"
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${m.tone}`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-sub">{m.label}</p>
                    <p className="text-xs font-bold text-ink truncate">{m.value}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* File JSON Backup & Restore */}
      <Card title="Backup & Restore File (.json) — Siap Sebelum & Sesudah Republish" testid="backup-file-card">
        <div className="space-y-4">
          <div className="rounded-2xl border border-brand/20 bg-brand/5 p-3.5 text-xs text-ink leading-relaxed">
            <p className="font-bold flex items-center gap-1.5 text-brand mb-1">
              <Database size={14} />
              <span>Cara menjaga data tetap utuh saat Republish aplikasi:</span>
            </p>
            <ol className="list-decimal pl-4 space-y-1 text-sub">
              <li>Sebelum melakukan <strong>Republish</strong>, klik <strong>Download Full Backup (.json)</strong> untuk menyimpan semua chat, task, member, feed, board, &amp; file ke komputer Anda.</li>
              <li>Setelah aplikasi selesai di-republish, buka menu <strong>Settings → Backup &amp; Restore</strong> lalu unggah file <code>.json</code> tersebut melalui tombol <strong>Restore dari File (.json)</strong>.</li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadJson}
              disabled={downloading}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 transition-opacity disabled:opacity-50"
              data-testid="backup-download-json-btn"
            >
              <Download size={15} />
              <span>{downloading ? "Menyiapkan Backup..." : "Download Full Backup (.json)"}</span>
            </button>

            <label
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border bg-surface2 px-4 text-xs font-bold text-ink hover:bg-surface transition-colors shadow-2xs"
              data-testid="backup-restore-file-label"
            >
              <Upload size={15} className="text-brand" />
              <span>Restore dari File (.json)</span>
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={handleSelectRestoreFile}
                data-testid="backup-restore-file-input"
              />
            </label>
          </div>
        </div>
      </Card>

      {/* Cloud Backup (Firebase Firestore) */}
      <Card title="Cloud Backup (Firebase Firestore)" testid="backup-cloud-card">
        <div className="space-y-4">
          <p className="text-xs text-sub">
            Simpan snapshot workspace langsung ke database cloud Firestore agar dapat dipulihkan dari perangkat mana saja setelah republish.
          </p>

          {!fbUser ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface2/60 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Cloud size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink">Hubungkan Akun Google untuk Cloud Backup</p>
                  <p className="text-[11px] text-sub">Autentikasi Firebase diperlukan agar snapshot Anda tersimpan aman di Firestore.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={connectingGoogle}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50"
                data-testid="backup-connect-google-btn"
              >
                <ShieldCheck size={14} />
                <span>{connectingGoogle ? "Menghubungkan..." : "Hubungkan Google"}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-ink truncate">
                    Terhubung ke Firestore sebagai <strong>{fbUser.email || fbUser.displayName}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => fetchCloudSnapshots(fbUser)}
                  disabled={loadingCloud}
                  className="text-[11px] font-bold text-brand hover:underline"
                >
                  {loadingCloud ? "Memuat..." : "Muat Ulang Daftar"}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={cloudLabel}
                  onChange={(e) => setCloudLabel(e.target.value)}
                  placeholder="Label snapshot (contoh: Sebelum Republish v2)"
                  maxLength={100}
                  className="h-10 flex-1 rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none"
                  data-testid="cloud-backup-label-input"
                />
                <button
                  type="button"
                  onClick={handleSaveToCloud}
                  disabled={savingCloud}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50 shrink-0"
                  data-testid="cloud-backup-save-btn"
                >
                  <CloudUpload size={15} />
                  <span>{savingCloud ? "Menyimpan ke Cloud..." : "Backup ke Cloud"}</span>
                </button>
              </div>

              {cloudError && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{cloudError}</p>
                </div>
              )}

              {cloudBackups.length > 0 ? (
                <div className="divide-y rounded-2xl border bg-surface">
                  {cloudBackups.map((bk) => (
                    <div key={bk.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-ink truncate">{bk.label}</p>
                        <p className="text-[11px] text-sub mt-0.5">
                          {new Date(bk.createdAtIso).toLocaleString("id-ID")} · {bk.summary?.messages || 0} pesan · {bk.summary?.tasks || 0} task · {bk.summary?.users || 0} member · {bk.summary?.posts || 0} post
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePrepareCloudRestore(bk)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-brand/10 px-3 text-xs font-bold text-brand hover:bg-brand hover:text-white transition-colors"
                          data-testid={`cloud-restore-${bk.id}`}
                        >
                          <RefreshCw size={12} />
                          <span>Pulihkan</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCloudSnapshot(bk)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-sub hover:bg-rose-500/10 hover:text-rose-600 transition-colors"
                          title="Hapus snapshot"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                !loadingCloud && !cloudError && (
                  <p className="rounded-2xl border border-dashed p-4 text-center text-xs text-sub">
                    Belum ada snapshot cloud tersimpan. Klik <strong>Backup ke Cloud</strong> untuk membuat snapshot pertama.
                  </p>
                )
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Restore Confirmation Dialog */}
      <Dialog open={Boolean(pendingRestore)} onOpenChange={(open) => { if (!open && !restoring) setPendingRestore(null); }}>
        <DialogContent className="max-w-md rounded-3xl bg-surface p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-ink">
              <AlertTriangle size={18} className="text-amber-500" />
              <span>Konfirmasi Pemulihan Data</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-sub pt-1">
              Data workspace saat ini akan digantikan oleh isi backup <strong>{pendingRestore?.label}</strong>. Pastikan Anda sudah membuat cadangan jika masih ada data baru yang ingin disimpan.
            </DialogDescription>
          </DialogHeader>

          {pendingRestore?.summary && (
            <div className="grid grid-cols-2 gap-2 rounded-2xl border bg-surface2/60 p-3 text-xs">
              <div><span className="text-sub">Member:</span> <strong className="text-ink">{pendingRestore.summary.users || 0}</strong></div>
              <div><span className="text-sub">Task:</span> <strong className="text-ink">{pendingRestore.summary.tasks || 0}</strong></div>
              <div><span className="text-sub">Chat Room:</span> <strong className="text-ink">{pendingRestore.summary.conversations || 0}</strong></div>
              <div><span className="text-sub">Pesan Chat:</span> <strong className="text-ink">{pendingRestore.summary.messages || 0}</strong></div>
              <div><span className="text-sub">Feed Post:</span> <strong className="text-ink">{pendingRestore.summary.posts || 0}</strong></div>
              <div><span className="text-sub">Proyek / Board:</span> <strong className="text-ink">{pendingRestore.summary.projects || 0} / {pendingRestore.summary.boards || 0}</strong></div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              disabled={restoring}
              onClick={() => setPendingRestore(null)}
              className="h-10 rounded-xl border bg-surface2 px-4 text-xs font-semibold text-ink hover:bg-surface"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={restoring}
              onClick={executeRestore}
              className="h-10 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50"
              data-testid="confirm-backup-restore-btn"
            >
              {restoring ? "Memulihkan Data..." : "Ya, Pulihkan Semua Data"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
