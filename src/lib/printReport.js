import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PRIORITY, fmtDate, getTaskCompliance } from "../components/common";

export function tryNativePrint() {
  let fired = false;
  const onBeforePrint = () => {
    fired = true;
  };
  window.addEventListener("beforeprint", onBeforePrint);
  try {
    window.print();
  } catch {
    fired = false;
  }
  window.removeEventListener("beforeprint", onBeforePrint);
  return fired;
}

function getReqIds(t) {
  if (!t) return [];
  if (Array.isArray(t.requestor_ids) && t.requestor_ids.length) return t.requestor_ids.filter(Boolean);
  if (t.requestor_id) return [t.requestor_id];
  if (t.created_by) return [t.created_by];
  return [];
}

function getAssigneeIds(t) {
  if (!t) return [];
  if (Array.isArray(t.assignee_ids) && t.assignee_ids.length) return t.assignee_ids.filter(Boolean);
  if (t.assignee_id) return [t.assignee_id];
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

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildTaskReportRows(tasks, { userMap = {}, labelMap = {}, reportMode = "checkpoint" } = {}) {
  const rows = [];
  let seq = 1;

  (tasks || []).forEach((t) => {
    const reqNames = getReqIds(t)
      .map((id) => userMap[id]?.name || id)
      .filter(Boolean)
      .join(", ") || "—";
    const brandNames = (t.label_ids || [])
      .map((id) => labelMap[id]?.name)
      .filter(Boolean)
      .join(", ") || "—";
    const itemType = t.item_type || "—";
    const priorityName = (PRIORITY[t.priority] || PRIORITY.medium)?.name || t.priority || "Medium";
    const linkStr = t.link_url ? String(t.link_url).replace(/^https?:\/\//i, "") : "—";

    const cps = Array.isArray(t.checkpoints) ? t.checkpoints : [];
    if (reportMode === "checkpoint" && cps.length > 0) {
      cps.forEach((cp, idx) => {
        const picName = cp.assignee_id ? (userMap[cp.assignee_id]?.name || cp.assignee_id) : "Unassigned";
        const stageLabel = `${idx + 1}/${cps.length} · ${cp.title || "Tahap"}${cp.deadline ? ` (${fmtDate(cp.deadline, "d MMM")})` : ""}`;
        const statusVal = getCheckpointCompliance(cp, t);
        const deadlineStr = cp.deadline
          ? fmtDate(cp.deadline, "d MMM yyyy")
          : (t.deadline ? fmtDate(t.deadline, "d MMM yyyy") : "—");
        rows.push({
          no: seq++,
          requestor: reqNames,
          assignee: picName,
          brand: brandNames,
          item: itemType,
          title: t.title || "",
          stage: stageLabel,
          priority: priorityName,
          link: linkStr,
          deadline: deadlineStr,
          status: statusVal,
          taskId: t.id,
          numberStr: t.number_str || ""
        });
      });
    } else {
      const assNames = getAssigneeIds(t)
        .map((id) => userMap[id]?.name || id)
        .filter(Boolean)
        .join(", ") || "Unassigned";
      const statusVal = getTaskCompliance(t);
      rows.push({
        no: seq++,
        requestor: reqNames,
        assignee: assNames,
        brand: brandNames,
        item: itemType,
        title: t.title || "",
        stage: cps.length > 0 ? `${cps.filter((c) => c.done).length}/${cps.length} tahap` : "",
        priority: priorityName,
        link: linkStr,
        deadline: t.deadline ? fmtDate(t.deadline, "d MMM yyyy") : "—",
        status: statusVal,
        taskId: t.id,
        numberStr: t.number_str || ""
      });
    }
  });

  return rows;
}

export function downloadTaskReportPDF({
  tasks = [],
  boardName = "Semua Board",
  view = "list",
  reportMode = "checkpoint",
  userMap = {},
  labelMap = {}
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const rows = buildTaskReportRows(tasks, { userMap, labelMap, reportMode });
  const nowStr = fmtDate(new Date().toISOString(), "d MMM yyyy HH:mm");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("CIRCLE WORKSPACE · TASK REPORT", 14, 13);

  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(`Laporan Tugas — ${boardName}`, 14, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Mode: ${reportMode === "checkpoint" ? "Per Tahap (Checkpoint PIC)" : "Per Card Tugas"}  |  Tampilan: ${view}  |  Total: ${rows.length} baris (${tasks.length} card)  |  Dicetak: ${nowStr}`,
    14,
    26
  );

  const body = rows.map((r) => [
    String(r.no),
    r.requestor,
    r.assignee,
    r.brand,
    r.item,
    r.stage ? `${r.title}  [${r.stage}]` : r.title,
    r.priority,
    r.deadline,
    r.status
  ]);

  autoTable(doc, {
    startY: 31,
    head: [["#", "Requestor", "Assignee / PIC", "Brand", "Item", "Title & Tahap", "Priority", "Deadline", "Status"]],
    body,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [32, 40, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: "middle"
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: "bold",
      fontSize: 8
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      1: { cellWidth: 26 },
      2: { cellWidth: 28 },
      3: { cellWidth: 24 },
      4: { cellWidth: 30 },
      5: { cellWidth: 74 },
      6: { cellWidth: 20 },
      7: { cellWidth: 26 },
      8: { cellWidth: 26, fontStyle: "bold" }
    },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 8) {
        const v = String(data.cell.raw || "");
        if (v === "On time") {
          data.cell.styles.fillColor = [209, 250, 229];
          data.cell.styles.textColor = [6, 95, 70];
        } else if (v === "Overdue") {
          data.cell.styles.fillColor = [255, 228, 230];
          data.cell.styles.textColor = [159, 18, 57];
        } else {
          data.cell.styles.fillColor = [254, 243, 199];
          data.cell.styles.textColor = [146, 64, 14];
        }
      }
    },
    didDrawPage(data) {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Halaman ${data.pageNumber} dari ${pageCount}`,
        doc.internal.pageSize.getWidth() - 38,
        doc.internal.pageSize.getHeight() - 7
      );
    }
  });

  const slug = String(boardName || "semua-board").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const datePart = new Date().toISOString().slice(0, 10);
  doc.save(`circle-tasks-${slug}-${datePart}.pdf`);
}

export function downloadTaskReportHTML({
  tasks = [],
  boardName = "Semua Board",
  reportMode = "checkpoint",
  userMap = {},
  labelMap = {}
}) {
  const rows = buildTaskReportRows(tasks, { userMap, labelMap, reportMode });
  const nowStr = fmtDate(new Date().toISOString(), "d MMM yyyy HH:mm");
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const statusBadge = (st) => {
    const cls =
      st === "On time"
        ? "background:#d1fae5;color:#065f46"
        : st === "Overdue"
        ? "background:#ffe4e6;color:#9f1239"
        : "background:#fef3c7;color:#92400e";
    return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-weight:700;font-size:11px;${cls}">${esc(st)}</span>`;
  };

  const trs = rows
    .map(
      (r) => `<tr>
        <td style="text-align:center;color:#64748b">${r.no}</td>
        <td>${esc(r.requestor)}</td>
        <td>${esc(r.assignee)}</td>
        <td>${esc(r.brand)}</td>
        <td>${esc(r.item)}</td>
        <td><b>${esc(r.title)}</b>${r.stage ? ` <span style="display:inline-block;background:#ffe4e6;color:#e11d48;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:600;margin-left:4px">${esc(r.stage)}</span>` : ""}</td>
        <td>${esc(r.priority)}</td>
        <td>${esc(r.deadline)}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`
    )
    .join("");

  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Laporan Tugas — ${esc(boardName)}</title>
<style>
  @page { size: landscape; margin: 10mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; color: #1e293b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1e293b; padding-bottom: 10px; margin-bottom: 14px; }
  .btn { background: #ff5364; color: #fff; border: none; padding: 9px 18px; border-radius: 999px; font-weight: 700; cursor: pointer; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
  th { background: #f1f5f9; font-weight: 700; }
  tr:nth-child(even) { background: #f8fafc; }
  @media print { .no-print { display: none !important; } body { margin: 0; } }
</style>
</head>
<body>
  <div class="top">
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#64748b">CIRCLE WORKSPACE · TASK REPORT</div>
      <h1 style="margin:4px 0 0;font-size:20px">Laporan Tugas — ${esc(boardName)}</h1>
    </div>
    <div style="text-align:right;font-size:12px;color:#475569">
      <div>Total: <b>${rows.length} baris</b> (${tasks.length} card)</div>
      <div>Dicetak: ${esc(nowStr)}</div>
      <button class="btn no-print" style="margin-top:8px" onclick="window.print()">Cetak Sekarang (Print)</button>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:32px;text-align:center">#</th>
        <th>Requestor</th>
        <th>Assignee / PIC</th>
        <th>Brand</th>
        <th>Item</th>
        <th>Title &amp; Tahap</th>
        <th>Priority</th>
        <th>Deadline</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${trs}</tbody>
  </table>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `circle-tasks-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadTaskDetailPDF({ task, userMap = {}, labelMap = {}, statuses = [], boardName = "" }) {
  if (!task) return;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const reqNames = getReqIds(task).map((id) => userMap[id]?.name || id).join(", ") || "—";
  const assNames = getAssigneeIds(task).map((id) => userMap[id]?.name || id).join(", ") || "Unassigned";
  const brandNames = (task.label_ids || []).map((id) => labelMap[id]?.name).filter(Boolean).join(", ") || "—";
  const statusName = statuses.find((s) => s.key === task.status)?.name || task.status || "—";
  const priorityName = (PRIORITY[task.priority] || PRIORITY.medium)?.name || task.priority || "Medium";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`CIRCLE WORKSPACE · ${task.number_str || "TASK DETAIL"}`, 14, 15);

  doc.setFontSize(17);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(task.title || "Detail Tugas", 180);
  doc.text(titleLines, 14, 23);

  let y = 23 + titleLines.length * 7 + 3;

  autoTable(doc, {
    startY: y,
    head: [["Atribut", "Nilai"]],
    body: [
      ["Board / Divisi", boardName || task.department || "—"],
      ["Status", `${statusName} (${getTaskCompliance(task)})`],
      ["Priority", priorityName],
      ["Requestor", reqNames],
      ["Assignee", assNames],
      ["Brand", brandNames],
      ["Item", task.item_type || "—"],
      ["Deadline", task.deadline ? fmtDate(task.deadline, "d MMM yyyy HH:mm") : "—"],
      ["Link File/Folder", task.link_url || "—"]
    ],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 45, fontStyle: "bold", textColor: [71, 85, 105] }, 1: { cellWidth: 135 } }
  });

  y = (doc.lastAutoTable?.finalY || y + 50) + 8;

  const cps = Array.isArray(task.checkpoints) ? task.checkpoints : [];
  if (cps.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Tahapan Checkpoint", 14, y);

    autoTable(doc, {
      startY: y + 3,
      head: [["#", "Nama Tahap", "PIC", "Deadline", "Status"]],
      body: cps.map((cp, idx) => [
        String(idx + 1),
        cp.title || `Tahap ${idx + 1}`,
        cp.assignee_id ? (userMap[cp.assignee_id]?.name || cp.assignee_id) : "Unassigned",
        cp.deadline ? fmtDate(cp.deadline, "d MMM yyyy") : "—",
        getCheckpointCompliance(cp, task)
      ]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2 },
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" }
    });
    y = (doc.lastAutoTable?.finalY || y + 25) + 8;
  }

  const desc = stripHtml(task.description);
  if (desc) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Deskripsi", 14, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const lines = doc.splitTextToSize(desc, 180);
    doc.text(lines, 14, y + 5);
  }

  const numSlug = String(task.number_str || task.id || "task").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  doc.save(`circle-${numSlug}.pdf`);
}
