"use strict";

const CONFIG = window.RDO_CONFIG || {};
const IS_CONFIGURED = Boolean(
  CONFIG.SUPABASE_URL &&
  CONFIG.SUPABASE_PUBLISHABLE_KEY &&
  !CONFIG.SUPABASE_URL.includes("COLE_AQUI") &&
  !CONFIG.SUPABASE_PUBLISHABLE_KEY.includes("COLE_AQUI")
);

const LABOR_ROLES = [
  "Gestão Produção", "Ajudante", "Armador", "Carpinteiro", "Escavador",
  "Encanador", "Eletricista", "Pintor", "Pedreiro", "Operador de máquinas",
  "Mão de obra especializada"
];
const STORAGE_BUCKET = "rdo-files";
const HEADER_COLOR = [49, 95, 102];

let db = null;
let currentUser = null;
let currentProfile = null;
let works = [];
let historyRows = [];
let selectedPhotos = [];
let logoDataUrlCache = null;

const byId = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  renderLaborRows();
  setToday();
  bindEvents();

  if (!IS_CONFIGURED) {
    byId("config-warning").classList.remove("hidden");
    byId("login-button").disabled = true;
    return;
  }

  db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const { data, error } = await db.auth.getSession();
  if (error) showToast(error.message, "error");
  if (data?.session?.user) await openApplication(data.session.user);
}

function bindEvents() {
  byId("login-form").addEventListener("submit", handleLogin);
  byId("logout-button").addEventListener("click", handleLogout);
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  byId("work-select").addEventListener("change", updateReportNumberPreview);
  byId("report-date").addEventListener("change", updateDayOfWeek);
  byId("add-activity-button").addEventListener("click", addActivityRow);
  byId("add-occurrence-button").addEventListener("click", addOccurrenceRow);
  byId("photo-upload").addEventListener("change", handlePhotoSelection);
  byId("labor-table-body").addEventListener("input", updateLaborTotal);
  byId("rdo-form").addEventListener("submit", handleSaveRdo);
  byId("clear-form-button").addEventListener("click", () => resetRdoForm(true));

  byId("refresh-history-button").addEventListener("click", loadHistory);
  byId("history-work-filter").addEventListener("change", renderHistory);
  byId("history-search").addEventListener("input", renderHistory);
  byId("history-table-body").addEventListener("click", handleHistoryAction);

  byId("work-form").addEventListener("submit", handleSaveWork);
  byId("cancel-work-edit-button").addEventListener("click", resetWorkForm);
  byId("works-table-body").addEventListener("click", handleWorkAction);
}

async function handleLogin(event) {
  event.preventDefault();
  if (!db) return;
  const button = byId("login-button");
  setButtonLoading(button, true, "Entrando...");

  const { data, error } = await db.auth.signInWithPassword({
    email: byId("login-email").value.trim(),
    password: byId("login-password").value
  });

  if (error) {
    showToast(translateAuthError(error.message), "error");
    setButtonLoading(button, false);
    return;
  }

  try {
    await openApplication(data.user);
    byId("login-form").reset();
  } catch (appError) {
    showToast(appError.message, "error");
    await db.auth.signOut();
  } finally {
    setButtonLoading(button, false);
  }
}

async function openApplication(user) {
  const { data: profile, error } = await db
    .from("profiles")
    .select("id, full_name, role, active")
    .eq("id", user.id)
    .single();

  if (error || !profile) throw new Error("Seu perfil não foi encontrado. Peça ao administrador para verificar o usuário.");
  if (!profile.active) throw new Error("Seu usuário está desativado.");

  currentUser = user;
  currentProfile = profile;
  byId("user-name").textContent = profile.full_name || user.email;
  byId("user-role").textContent = profile.role === "admin" ? "Administrador" : "Usuário";
  byId("admin-tab-button").classList.toggle("hidden", profile.role !== "admin");
  byId("signed-by").value = profile.full_name || "";

  byId("login-view").classList.add("hidden");
  byId("app-view").classList.remove("hidden");
  await loadWorks();
  resetRdoForm(false);
}

async function handleLogout() {
  if (db) await db.auth.signOut();
  currentUser = null;
  currentProfile = null;
  works = [];
  historyRows = [];
  selectedPhotos = [];
  byId("app-view").classList.add("hidden");
  byId("login-view").classList.remove("hidden");
}

function switchTab(tabName) {
  if (tabName === "admin" && currentProfile?.role !== "admin") return;
  document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${tabName}`));
  if (tabName === "history") loadHistory();
  if (tabName === "admin") renderWorksAdmin();
}

async function loadWorks() {
  const { data, error } = await db.from("works").select("id, name, last_number, active, created_at").order("name");
  if (error) {
    showToast(`Não foi possível carregar as obras: ${error.message}`, "error");
    return;
  }
  works = data || [];
  populateWorkSelects();
  renderWorksAdmin();
}

function populateWorkSelects() {
  const currentValue = byId("work-select").value;
  const workSelect = byId("work-select");
  workSelect.innerHTML = '<option value="">Selecione uma obra</option>';
  works.filter((work) => work.active).forEach((work) => workSelect.add(new Option(work.name, work.id)));
  if (works.some((work) => work.id === currentValue && work.active)) workSelect.value = currentValue;

  const filterValue = byId("history-work-filter").value;
  const historyFilter = byId("history-work-filter");
  historyFilter.innerHTML = '<option value="">Todas as obras</option>';
  works.forEach((work) => historyFilter.add(new Option(work.name, work.id)));
  if (works.some((work) => work.id === filterValue)) historyFilter.value = filterValue;
  updateReportNumberPreview();
}

function updateReportNumberPreview() {
  const work = works.find((item) => item.id === byId("work-select").value);
  byId("report-number").value = work ? formatReportNumber(Number(work.last_number) + 1) : "";
}

function renderLaborRows() {
  byId("labor-table-body").innerHTML = LABOR_ROLES.map((role) => `
    <tr>
      <td>${escapeHtml(role)}</td>
      <td><input class="labor-quantity" type="number" min="0" step="1" value="0" data-role="${escapeHtml(role)}" aria-label="Quantidade de ${escapeHtml(role)}"></td>
    </tr>`).join("");
}

function updateLaborTotal() {
  const total = [...document.querySelectorAll(".labor-quantity")].reduce((sum, input) => sum + Math.max(0, Number(input.value) || 0), 0);
  byId("labor-total").textContent = String(Math.round(total));
}

function addActivityRow(value = {}) {
  const row = document.createElement("div");
  row.className = "dynamic-row";
  row.innerHTML = `
    <input class="activity-description" type="text" placeholder="Descrição da atividade" value="${escapeAttribute(value.description || "")}">
    <select class="activity-status">
      ${["Em andamento", "Concluído", "Pendente", "Parado"].map((status) => `<option${value.status === status ? " selected" : ""}>${status}</option>`).join("")}
    </select>
    <button class="button button-danger button-small remove-row" type="button">Remover</button>`;
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
  byId("activities-container").appendChild(row);
}

function addOccurrenceRow(description = "") {
  const row = document.createElement("div");
  row.className = "dynamic-row occurrence-row";
  row.innerHTML = `
    <input class="occurrence-description" type="text" placeholder="Descrição da ocorrência" value="${escapeAttribute(description)}">
    <button class="button button-danger button-small remove-row" type="button">Remover</button>`;
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
  byId("occurrences-container").appendChild(row);
}

async function handlePhotoSelection(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > 20 * 1024 * 1024) {
      showToast(`${file.name} ultrapassa o limite de 20 MB.`, "warning");
      continue;
    }
    selectedPhotos.push({ id: makeId(), file, dataUrl: await fileToDataUrl(file) });
  }
  renderPhotoPreviews();
}

function renderPhotoPreviews() {
  const container = byId("photo-preview-container");
  container.innerHTML = "";
  selectedPhotos.forEach((photo) => {
    const card = document.createElement("div");
    card.className = "photo-card";
    card.innerHTML = `<img src="${photo.dataUrl}" alt="${escapeAttribute(photo.file.name)}"><footer><span class="photo-name" title="${escapeAttribute(photo.file.name)}">${escapeHtml(photo.file.name)}</span><button class="button button-danger button-small remove-photo" type="button">×</button></footer>`;
    card.querySelector(".remove-photo").addEventListener("click", () => {
      selectedPhotos = selectedPhotos.filter((item) => item.id !== photo.id);
      renderPhotoPreviews();
    });
    container.appendChild(card);
  });
}

function collectFormData() {
  const work = works.find((item) => item.id === byId("work-select").value);
  return {
    workId: work?.id || "",
    workName: work?.name || "",
    reportDate: byId("report-date").value,
    dayOfWeek: byId("day-of-week").value,
    signedBy: byId("signed-by").value.trim(),
    weather: {
      morning: { condition: byId("weather-morning").value, practicable: byId("practicable-morning").value },
      afternoon: { condition: byId("weather-afternoon").value, practicable: byId("practicable-afternoon").value }
    },
    labor: [...document.querySelectorAll(".labor-quantity")].map((input) => ({ role: input.dataset.role, quantity: Math.max(0, Number(input.value) || 0) })),
    activities: [...document.querySelectorAll("#activities-container .dynamic-row")].map((row) => ({ description: row.querySelector(".activity-description").value.trim(), status: row.querySelector(".activity-status").value })).filter((item) => item.description),
    occurrences: [...document.querySelectorAll("#occurrences-container .dynamic-row")].map((row) => row.querySelector(".occurrence-description").value.trim()).filter(Boolean)
  };
}

async function handleSaveRdo(event) {
  event.preventDefault();
  const formData = collectFormData();
  if (!formData.workId || !formData.reportDate || !formData.signedBy) {
    showToast("Preencha a obra, a data e o responsável.", "warning");
    return;
  }

  const button = byId("save-rdo-button");
  setButtonLoading(button, true, "Salvando RDO...");
  let createdRdo = null;

  try {
    const { data, error } = await db.rpc("create_rdo", {
      p_work_id: formData.workId,
      p_report_date: formData.reportDate,
      p_day_of_week: formData.dayOfWeek,
      p_weather: formData.weather,
      p_labor: formData.labor,
      p_activities: formData.activities,
      p_occurrences: formData.occurrences,
      p_signed_by: formData.signedBy
    });
    if (error) throw error;

    createdRdo = Array.isArray(data) ? data[0] : data;
    if (!createdRdo?.rdo_id) throw new Error("O banco não retornou o identificador do RDO.");

    const finalData = { ...formData, reportNumber: Number(createdRdo.report_number) };
    const { blob, fileName } = await buildPdf(finalData);
    downloadBlob(blob, fileName);

    const warnings = [];
    const photoFailures = await uploadPhotos(createdRdo.rdo_id, formData.workId);
    if (photoFailures.length) warnings.push(`${photoFailures.length} foto(s) não foram armazenadas`);

    try {
      const pdfPath = `${formData.workId}/${createdRdo.rdo_id}/${fileName}`;
      const { error: pdfUploadError } = await db.storage.from(STORAGE_BUCKET).upload(pdfPath, blob, { contentType: "application/pdf", upsert: true });
      if (pdfUploadError) throw pdfUploadError;
      const { error: updateError } = await db.from("rdos").update({ pdf_path: pdfPath }).eq("id", createdRdo.rdo_id);
      if (updateError) throw updateError;
    } catch (storageError) {
      warnings.push("o PDF foi baixado, mas não foi armazenado");
      console.error(storageError);
    }

    const successMessage = `RDO ${formatReportNumber(finalData.reportNumber)} salvo para ${formData.workName}.`;
    showToast(warnings.length ? `${successMessage} Atenção: ${warnings.join("; ")}.` : successMessage, warnings.length ? "warning" : "success", 6500);
    await loadWorks();
    historyRows = [];
    resetRdoForm(false);
  } catch (error) {
    const prefix = createdRdo ? `O RDO ${formatReportNumber(createdRdo.report_number)} foi reservado, mas houve uma falha: ` : "Não foi possível salvar o RDO: ";
    showToast(prefix + friendlyDatabaseError(error), "error", 7500);
    console.error(error);
  } finally {
    setButtonLoading(button, false);
  }
}

async function uploadPhotos(rdoId, workId) {
  const results = await Promise.all(selectedPhotos.map(async (photo, index) => {
    const path = `${workId}/${rdoId}/fotos/${String(index + 1).padStart(2, "0")}-${safeStorageName(photo.file.name)}`;
    const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(path, photo.file, { contentType: photo.file.type, upsert: false });
    if (uploadError) return { ok: false, error: uploadError };
    const { error: rowError } = await db.from("rdo_photos").insert({ rdo_id: rdoId, storage_path: path, file_name: photo.file.name, display_order: index + 1, uploaded_by: currentUser.id });
    return rowError ? { ok: false, error: rowError } : { ok: true };
  }));
  return results.filter((result) => !result.ok);
}

async function buildPdf(data) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;
  let y = 35;

  const ensureSpace = (height = 12) => {
    if (y + height > pageHeight - margin) { pdf.addPage(); y = margin; }
  };
  const title = (text) => {
    ensureSpace(16); pdf.setFontSize(14); pdf.setTextColor(...HEADER_COLOR); pdf.text(text, margin, y); pdf.setTextColor(0,0,0); y += 9;
  };
  const line = (text, indent = 0) => {
    const lines = pdf.splitTextToSize(String(text), pageWidth - (2 * margin) - indent);
    ensureSpace(lines.length * 6 + 2); pdf.setFontSize(10.5); pdf.text(lines, margin + indent, y); y += lines.length * 6;
  };

  pdf.setFillColor(...HEADER_COLOR);
  pdf.rect(0, 0, pageWidth, 25, "F");
  const logo = await getLogoDataUrl();
  if (logo) { try { pdf.addImage(logo, imageType(logo), margin, 5, 25, 15); } catch (_) {} }
  pdf.setTextColor(255,255,255); pdf.setFontSize(18); pdf.text("Relatório Diário de Obra (RDO)", pageWidth / 2, 14, { align: "center" });
  pdf.setFontSize(10); pdf.text("SEALT CONSTRUTORA", pageWidth / 2, 21, { align: "center" }); pdf.setTextColor(0,0,0);

  title("INFORMAÇÕES GERAIS");
  line(`Relatório nº: ${formatReportNumber(data.reportNumber)}    Data: ${formatDatePt(data.reportDate)}`);
  line(`Dia da semana: ${data.dayOfWeek}    Obra: ${data.workName}`);
  y += 5;

  title("CONDIÇÃO CLIMÁTICA");
  line(`Manhã: ${data.weather.morning.condition} (Praticável: ${data.weather.morning.practicable})`);
  line(`Tarde: ${data.weather.afternoon.condition} (Praticável: ${data.weather.afternoon.practicable})`);
  y += 5;

  const activeLabor = data.labor.filter((item) => item.quantity > 0);
  const totalLabor = activeLabor.reduce((total, item) => total + item.quantity, 0);
  title(`MÃO DE OBRA (Total: ${Math.round(totalLabor)})`);
  if (activeLabor.length) activeLabor.forEach((item) => line(`${item.role}: ${Math.round(item.quantity)}`));
  else line("Nenhuma mão de obra informada.");
  y += 5;

  if (data.activities.length) {
    title("ATIVIDADES");
    data.activities.forEach((item) => line(`• ${item.description} (${item.status})`));
    y += 5;
  }
  if (data.occurrences.length) {
    title("OCORRÊNCIAS");
    data.occurrences.forEach((item) => line(`• ${item}`));
    y += 5;
  }

  if (selectedPhotos.length) {
    title("FOTOS");
    const gap = 8;
    const photoWidth = (pageWidth - (2 * margin) - gap) / 2;
    const photoHeight = photoWidth * .68;
    for (let index = 0; index < selectedPhotos.length; index += 1) {
      const column = index % 2;
      if (column === 0) ensureSpace(photoHeight + 12);
      const x = margin + column * (photoWidth + gap);
      try { pdf.addImage(selectedPhotos[index].dataUrl, imageType(selectedPhotos[index].dataUrl), x, y, photoWidth, photoHeight); } catch (_) {}
      pdf.setFontSize(9); pdf.text(`Foto ${index + 1}`, x, y + photoHeight + 4);
      if (column === 1 || index === selectedPhotos.length - 1) y += photoHeight + 11;
    }
  }

  title("ASSINATURA");
  line(`Assinado por: ${data.signedBy}`);
  ensureSpace(25); y += 14; pdf.line(margin, y, margin + 95, y); pdf.setFontSize(9); pdf.text("Assinatura", margin, y + 5); pdf.text(`Data: ${formatDatePt(data.reportDate)}`, pageWidth - margin - 42, y);

  const fileName = `${formatFileDate(data.reportDate)} ${sanitizeFileName(data.workName)} - RDO.pdf`;
  return { blob: pdf.output("blob"), fileName };
}

async function loadHistory() {
  const button = byId("refresh-history-button");
  setButtonLoading(button, true, "Atualizando...");
  const { data, error } = await db.from("rdos").select("id, work_id, report_number, report_date, signed_by, created_at, pdf_path, works(name)").order("created_at", { ascending: false }).limit(500);
  setButtonLoading(button, false);
  if (error) { showToast(`Erro ao carregar histórico: ${error.message}`, "error"); return; }
  historyRows = data || [];
  renderHistory();
}

function renderHistory() {
  const workFilter = byId("history-work-filter").value;
  const search = normalizeText(byId("history-search").value);
  const filtered = historyRows.filter((row) => {
    const workName = relatedWorkName(row);
    const matchesWork = !workFilter || row.work_id === workFilter;
    const haystack = normalizeText(`${row.report_number} ${formatReportNumber(row.report_number)} ${workName} ${row.signed_by}`);
    return matchesWork && (!search || haystack.includes(search));
  });
  byId("history-table-body").innerHTML = filtered.map((row) => `
    <tr>
      <td><strong>${formatReportNumber(row.report_number)}</strong></td>
      <td>${escapeHtml(relatedWorkName(row))}</td>
      <td>${formatDatePt(row.report_date)}</td>
      <td>${escapeHtml(row.signed_by)}</td>
      <td>${formatDateTime(row.created_at)}</td>
      <td>${row.pdf_path ? `<button class="button button-secondary button-small" type="button" data-download-pdf="${row.id}">Baixar</button>` : '<span class="muted">Indisponível</span>'}</td>
    </tr>`).join("");
  byId("history-empty").classList.toggle("hidden", filtered.length > 0);
}

async function handleHistoryAction(event) {
  const button = event.target.closest("[data-download-pdf]");
  if (!button) return;
  const row = historyRows.find((item) => item.id === button.dataset.downloadPdf);
  if (!row?.pdf_path) return;
  setButtonLoading(button, true, "Abrindo...");
  const { data, error } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(row.pdf_path, 120);
  setButtonLoading(button, false);
  if (error) { showToast(`Não foi possível abrir o PDF: ${error.message}`, "error"); return; }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function renderWorksAdmin() {
  if (currentProfile?.role !== "admin") return;
  byId("works-table-body").innerHTML = works.map((work) => `
    <tr>
      <td>${escapeHtml(work.name)}</td>
      <td>${formatReportNumber(work.last_number)}</td>
      <td><span class="badge ${work.active ? "badge-active" : "badge-inactive"}">${work.active ? "Ativa" : "Inativa"}</span></td>
      <td><div class="table-actions"><button class="button button-secondary button-small" type="button" data-edit-work="${work.id}">Editar</button><button class="button button-ghost button-small" type="button" data-toggle-work="${work.id}">${work.active ? "Desativar" : "Ativar"}</button></div></td>
    </tr>`).join("");
}

async function handleSaveWork(event) {
  event.preventDefault();
  if (currentProfile?.role !== "admin") return;
  const id = byId("work-id").value;
  const payload = { name: byId("work-name").value.trim(), last_number: Math.max(0, Number(byId("work-last-number").value) || 0), active: byId("work-active").checked };
  if (!payload.name) return;
  const button = event.submitter;
  setButtonLoading(button, true, "Salvando...");
  const query = id ? db.from("works").update(payload).eq("id", id) : db.from("works").insert(payload);
  const { error } = await query;
  setButtonLoading(button, false);
  if (error) { showToast(friendlyDatabaseError(error), "error"); return; }
  showToast(id ? "Obra atualizada." : "Obra cadastrada.", "success");
  resetWorkForm();
  await loadWorks();
}

async function handleWorkAction(event) {
  const editButton = event.target.closest("[data-edit-work]");
  const toggleButton = event.target.closest("[data-toggle-work]");
  if (editButton) {
    const work = works.find((item) => item.id === editButton.dataset.editWork);
    if (!work) return;
    byId("work-id").value = work.id; byId("work-name").value = work.name; byId("work-last-number").value = work.last_number; byId("work-active").checked = work.active;
    byId("work-form-title").textContent = "Editar obra"; byId("cancel-work-edit-button").classList.remove("hidden"); byId("work-name").focus();
  }
  if (toggleButton) {
    const work = works.find((item) => item.id === toggleButton.dataset.toggleWork);
    if (!work) return;
    setButtonLoading(toggleButton, true, "Salvando...");
    const { error } = await db.from("works").update({ active: !work.active }).eq("id", work.id);
    if (error) showToast(friendlyDatabaseError(error), "error"); else { showToast(`Obra ${work.active ? "desativada" : "ativada"}.`, "success"); await loadWorks(); }
    setButtonLoading(toggleButton, false);
  }
}

function resetWorkForm() {
  byId("work-form").reset(); byId("work-id").value = ""; byId("work-last-number").value = "0"; byId("work-active").checked = true;
  byId("work-form-title").textContent = "Cadastrar obra"; byId("cancel-work-edit-button").classList.add("hidden");
}

function resetRdoForm(showMessage) {
  byId("rdo-form").reset();
  setToday();
  renderLaborRows(); updateLaborTotal();
  byId("activities-container").innerHTML = ""; byId("occurrences-container").innerHTML = "";
  selectedPhotos = []; renderPhotoPreviews();
  byId("signed-by").value = currentProfile?.full_name || "";
  updateReportNumberPreview();
  if (showMessage) showToast("Formulário limpo.", "success");
}

function setToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,10);
  byId("report-date").value = local;
  updateDayOfWeek();
}

function updateDayOfWeek() {
  const value = byId("report-date").value;
  if (!value) { byId("day-of-week").value = ""; return; }
  const [year, month, day] = value.split("-").map(Number);
  byId("day-of-week").value = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"][new Date(year, month - 1, day).getDay()];
}

function formatReportNumber(value) { return String(Math.max(0, Number(value) || 0)).padStart(3, "0"); }
function formatDatePt(value) { if (!value) return ""; const [y,m,d] = value.slice(0,10).split("-"); return `${d}/${m}/${y}`; }
function formatFileDate(value) { const [year, month, day] = value.split("-"); return `${year.slice(-2)}.${month}.${day}`; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : ""; }
function relatedWorkName(row) { return Array.isArray(row.works) ? row.works[0]?.name || "" : row.works?.name || ""; }
function sanitizeFileName(value) { return (value || "OBRA").trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").slice(0,80); }
function safeStorageName(value) { const clean = sanitizeFileName(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-"); return clean || `foto-${Date.now()}.jpg`; }
function normalizeText(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[char])); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }
function imageType(dataUrl) { if (dataUrl.startsWith("data:image/png")) return "PNG"; if (dataUrl.startsWith("data:image/webp")) return "WEBP"; return "JPEG"; }
function makeId() { return window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }

async function getLogoDataUrl() {
  if (logoDataUrlCache) return logoDataUrlCache;
  try { const response = await fetch("sealt.png", { cache: "force-cache" }); if (!response.ok) return null; logoDataUrlCache = await fileToDataUrl(await response.blob()); return logoDataUrlCache; } catch (_) { return null; }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function showToast(message, type = "default", duration = 4300) {
  const toast = document.createElement("div"); toast.className = `toast ${type === "default" ? "" : `toast-${type}`}`; toast.textContent = message; byId("toast-container").appendChild(toast); setTimeout(() => toast.remove(), duration);
}

function setButtonLoading(button, loading, text) {
  if (!button) return;
  if (loading) { button.dataset.originalText = button.textContent; button.textContent = text; button.disabled = true; }
  else { button.textContent = button.dataset.originalText || button.textContent; button.disabled = false; }
}

function translateAuthError(message) {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme o e-mail antes de entrar.";
  return message;
}

function friendlyDatabaseError(error) {
  const message = error?.message || String(error);
  if (/duplicate key.*works_name_key/i.test(message)) return "Já existe uma obra com esse nome.";
  if (/last_number_below_existing/i.test(message)) return "O último número não pode ser menor que um RDO já registrado para essa obra.";
  if (/inactive_user/i.test(message)) return "Seu usuário está desativado.";
  if (/work_inactive/i.test(message)) return "Essa obra está desativada.";
  if (/not_authenticated/i.test(message)) return "Sua sessão expirou. Entre novamente.";
  return message;
}
