// ====== CONFIG ======
const API_BASE   = 'http://192.168.176.114:3333/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, ''); // http://192.168.176.112:3333

// ====== STATE ======
let venues = [];
let categories = loadCategories();
let events = [];
let bookings = [];
let editingId = null;

// ====== HELPERS ======
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const toast = (m, t = 2200) => {
    const el = $('#toast');
    if (!el) return;
    el.textContent = m;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', t);
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const pad2 = n => String(n).padStart(2, '0');

const ymd = d => {
    const x = (d instanceof Date) ? d : new Date(d);
    return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
};

const hm = d => {
    const x = (d instanceof Date) ? d : new Date(d);
    return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
};

const toISO = (date, time) => `${date}T${time}:00-06:00`;

// ====== FECHAS ======
function parseFlexibleTime(str) {
    if (!str) return null;
    const s = str.toString().toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
    if (!m) return null;

    let H = parseInt(m[1], 10);
    let M = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3];

    if (ap === 'pm' && H < 12) H += 12;
    if (ap === 'am' && H === 12) H = 0;
    if (H > 23 || M > 59) return null;

    return `${pad2(H)}:${pad2(M)}`;
}

function fmtHumanRange(start, end) {
    const ds = new Date(start), de = new Date(end);
    const sameDay = ds.toDateString() === de.toDateString();
    const opts = { day: '2-digit', month: 'short' };

    if (sameDay) return `${ds.toLocaleDateString('es-MX', opts)} ${hm(ds)}–${hm(de)}`;
    return `${ds.toLocaleDateString('es-MX', opts)} ${hm(ds)} — ${de.toLocaleDateString('es-MX', opts)} ${hm(de)}`;
}

function diffHuman(start, end) {
    const ms = new Date(end) - new Date(start);
    if (ms <= 0) return '—';

    let mins = Math.floor(ms / 60000);
    const days = Math.floor(mins / (60 * 24));
    mins -= days * 60 * 24;
    const hours = Math.floor(mins / 60);
    mins -= hours * 60;

    const parts = [];
    if (days)  parts.push(`${days} día${days > 1 ? 's' : ''}`);
    if (hours) parts.push(`${hours} h`);
    if (!days && mins) parts.push(`${mins} min`);

    return parts.join(', ') || '—';
}

// ====== INIT ======
document.addEventListener('DOMContentLoaded', async () => {
    bindNav();
    bindEventsView();
    bindVenuesView();
    bindCategoriesView();
    bindBookingsView();

    // Filtros por defecto
    const now = new Date();
    const f1 = $('#f-from');
    const f2 = $('#f-to');
    if (f1) f1.value = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    if (f2) f2.value = ymd(new Date(now.getFullYear(), now.getMonth() + 2, 1));

    await loadVenues();
    renderVenueSelect();
    renderVenuesFilter();
    renderCategorySelect();
    renderCategoriesFilter();

    await loadEvents();
    await tryLoadBookings();
});

// ====== NAV ======
function bindNav() {
    $$('.nav-item').forEach(b => {
        b.onclick = () => {
            $$('.nav-item').forEach(x => x.classList.remove('active'));
            b.classList.add('active');

            const viewId = b.dataset.view;
            $$('.view').forEach(v => v.classList.remove('active'));

            const view = $('#' + viewId);
            if (view) view.classList.add('active');

            const pt = $('#page-title');
            if (pt) pt.textContent = b.textContent.trim();

            if (viewId === 'view-venues')     renderVenuesList();
            if (viewId === 'view-categories') renderCategoriesList();
            if (viewId === 'view-bookings')   tryLoadBookings();
        };
    });
}

// ====== EVENTS ======
function bindEventsView() {
    $('#btn-search')?.addEventListener('click', applyFilters);
    $('#btn-apply-filters')?.addEventListener('click', applyFilters);
    $('#btn-clear-filters')?.addEventListener('click', () => {
        ['search-input', 'f-status', 'f-category', 'f-venue', 'f-from', 'f-to'].forEach(id => {
            const el = $('#' + id);
            if (el) el.value = '';
        });
        applyFilters();
    });

    $('#btn-new-event')?.addEventListener('click', openDrawerCreate);
    $('#drawer-close')?.addEventListener('click', closeDrawer);
    $('#ev-cancel')?.addEventListener('click', closeDrawer);

    ['ev-date', 'ev-start', 'ev-date-end', 'ev-end'].forEach(id => {
        const el = $('#' + id);
        if (el) {
            el.addEventListener('input', updateDurationPreview);
            el.addEventListener('change', updateDurationPreview);
        }
    });

    $('#form-event')?.addEventListener('submit', onSubmitEvent);
    $('#img-upload')?.addEventListener('click', uploadFilesForEvent);
    $('#img-add-url')?.addEventListener('click', addImageByUrl);
}

async function applyFilters() {
    await loadEvents({
        q:        $('#search-input')?.value.trim(),
        status:   $('#f-status')?.value,
        category: $('#f-category')?.value,
        venue_id: $('#f-venue')?.value,
        from:     $('#f-from')?.value || undefined,
        to:       $('#f-to')?.value   || undefined
    });
}

async function loadEvents(filters = {}) {
    try {
        const url = new URL(`${API_BASE}/events`);
        const now = new Date();
        const defaultFrom = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
        const defaultTo   = ymd(new Date(now.getFullYear(), now.getMonth() + 2, 1));

        url.searchParams.set('page', '1');
        url.searchParams.set('pageSize', '300');
        url.searchParams.set('from', filters.from || defaultFrom);
        url.searchParams.set('to',   filters.to   || defaultTo);

        if (filters.q)        url.searchParams.set('q', filters.q);
        if (filters.status)   url.searchParams.set('status', filters.status);
        if (filters.category) url.searchParams.set('category', filters.category);
        if (filters.venue_id) url.searchParams.set('venue_id', filters.venue_id);

        const r = await fetch(url);
        if (!r.ok) throw new Error('No se pudieron cargar eventos');

        const data = await r.json();
        events = data.items || [];
        renderEventsTable();
    } catch (error) {
        console.error('Error loading events:', error);
        toast('Error cargando eventos');
    }
}

function renderEventsTable() {
    const box = $('#events-table');
    if (!box) return;

    if (!events.length) {
        box.innerHTML = '<div class="td">No hay eventos para este criterio.</div>';
        return;
    }

    const head = `
        <div class="tr th-row">
            <div class="th">Título</div>
            <div class="th">Categoría</div>
            <div class="th">Sede</div>
            <div class="th">Rango</div>
            <div class="th">Cupo</div>
            <div class="th">Estado</div>
            <div class="th">Acciones</div>
        </div>`;

    const rows = events.map(ev => {
        const venue = ev.venue_name ?? (venues.find(v => v.id === ev.venue_id)?.name || '');
        const cap   = `${ev.capacity_reserved ?? 0}/${ev.capacity_total ?? 0}`;

        return `
            <div class="tr">
                <div class="td">${esc(ev.title)}</div>
                <div class="td">${esc(ev.category || '')}</div>
                <div class="td">${esc(venue)}</div>
                <div class="td">${fmtHumanRange(ev.start_at, ev.end_at)}</div>
                <div class="td">${cap}</div>
                <div class="td">${ev.status}</div>
                <div class="td actions">
                    <button class="btn" onclick="editEvent('${ev.id}')">Editar</button>
                    <button class="btn btn-danger" onclick="deleteEvent('${ev.id}')">Eliminar</button>
                </div>
            </div>`;
    }).join('');

    box.innerHTML = head + rows;
}

// Drawer
function openDrawer() {
    $('#drawer')?.classList.add('open');
}

function closeDrawer() {
    $('#drawer')?.classList.remove('open');
    editingId = null;
}

function openDrawerCreate() {
    editingId = null;
    const t = $('#form-title'); if (t) t.textContent = 'Nuevo evento';
    const f = $('#form-event'); if (f) f.reset();

    const imgBox = $('#ev-images');
    if (imgBox) imgBox.innerHTML = '<span class="muted">Guarda el evento para añadir imágenes.</span>';

    const d = $('#duration-hint'); if (d) d.textContent = '—';
    openDrawer();
}

// Editar evento
async function editEvent(id) {
    try {
        const r = await fetch(`${API_BASE}/events/${id}`);
        if (!r.ok) {
            toast('No se pudo cargar');
            return;
        }

        const ev = await r.json();
        editingId = ev.id;

        $('#form-title').textContent = 'Editar evento';
        $('#ev-id').value           = ev.id;
        $('#ev-title').value        = ev.title || '';
        $('#ev-summary').value      = ev.summary || '';
        $('#ev-description').value  = ev.description || '';
        $('#ev-category').value     = ev.category || '';
        $('#ev-status').value       = ev.status || 'scheduled';
        $('#ev-capacity').value     = ev.capacity_total ?? 0;
        $('#ev-tags').value         = (ev.tags || []).join(', ');

        if (ev.venue_id) $('#ev-venue').value = ev.venue_id;

        const ds = new Date(ev.start_at), de = new Date(ev.end_at);
        $('#ev-date').value     = ymd(ds);
        $('#ev-start').value    = hm(ds);
        $('#ev-date-end').value = ymd(de);
        $('#ev-end').value      = hm(de);

        const d = $('#duration-hint');
        if (d) d.textContent = diffHuman(ev.start_at, ev.end_at);

        renderImagesChips(ev.images || []);
        openDrawer();
    } catch (error) {
        console.error('Error editing event:', error);
        toast('Error cargando evento');
    }
}

// ====== SUBMIT ======
async function onSubmitEvent(e) {
    e.preventDefault();
    try {
        const payload = await collectEventPayload();
        const url    = editingId ? `${API_BASE}/events/${editingId}` : `${API_BASE}/events`;
        const method = editingId ? 'PATCH' : 'POST';

        const r = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!r.ok) {
            const t = await r.text();
            throw new Error(`Error (${r.status}). ${t}`);
        }

        toast(editingId ? 'Evento actualizado' : 'Evento creado');
        closeDrawer();
        await loadEvents();
    } catch (err) {
        console.error('Error saving event:', err);
        alert(err.message || 'No se pudo guardar');
    }
}

async function collectEventPayload() {
    const title       = $('#ev-title').value.trim();
    const summary     = $('#ev-summary').value.trim();
    const description = $('#ev-description').value.trim();
    const category    = $('#ev-category').value;
    const status      = $('#ev-status').value;
    const capacity_total = parseInt($('#ev-capacity').value || '0', 10);
    const tags = $('#ev-tags').value.split(',').map(s => s.trim()).filter(Boolean);

    const dateStart         = $('#ev-date').value;
    const timeStartFlexible = parseFlexibleTime($('#ev-start').value);
    if (!dateStart || !timeStartFlexible) throw new Error('Inicio inválido.');

    let dateEnd        = $('#ev-date-end').value;
    let timeEndFlexible = $('#ev-end').value ? parseFlexibleTime($('#ev-end').value) : null;

    if (!dateEnd && !timeEndFlexible) {
        dateEnd = dateStart;
        const dd = new Date(`${dateStart}T${timeStartFlexible}:00`);
        dd.setHours(dd.getHours() + 2);
        timeEndFlexible = hm(dd);
    } else {
        if (!dateEnd)        dateEnd = dateStart;
        if (!timeEndFlexible) throw new Error('Hora de fin inválida.');
    }

    let venue_id = $('#ev-venue').value;
    const newVenue = $('#ev-venue-new').value.trim();

    if (!venue_id && newVenue) {
        const r = await fetch(`${API_BASE}/venues`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: newVenue })
        });
        if (!r.ok) throw new Error('No se pudo crear la sede');

        const v = await r.json();
        venue_id = v.id;

        await loadVenues();
        renderVenueSelect();
        renderVenuesFilter();

        $('#ev-venue').value     = venue_id;
        $('#ev-venue-new').value = '';
    }

    const startISO = toISO(dateStart, timeStartFlexible);
    const endISO   = toISO(dateEnd,   timeEndFlexible);
    if (new Date(endISO) <= new Date(startISO)) throw new Error('El fin debe ser posterior al inicio.');

    return {
        title,
        summary,
        description,
        category,
        venue_id,
        start_at: startISO,
        end_at:   endISO,
        capacity_total,
        status,
        tags
    };
}

// ====== IMÁGENES MEJORADO ======
function renderImagesChips(images) {
    const c = $('#ev-images');
    if (!c) return;

    if (!images?.length) {
        c.innerHTML = '<div class="muted">Sin imágenes.</div>';
        return;
    }

    c.innerHTML = images
        .sort((a, b) => a.position - b.position)
        .map(img => {
            const href    = img.url?.startsWith('/uploads') ? (API_ORIGIN + img.url) : img.url;
            const isCover = img.is_cover;

            return `
                <div class="image-preview-card ${isCover ? 'cover-image' : ''}">
                    <div class="image-container">
                        <img src="${esc(href)}"
                             alt="${esc(img.alt || 'Imagen del evento')}"
                             onclick="openImageModal('${esc(href)}')" />
                        ${isCover ? '<div class="cover-badge">⭐ Portada</div>' : ''}
                    </div>
                    <div class="image-info">
                        <div class="image-meta">
                            <span class="pos">#${img.position}</span>
                            <span class="size">${img.alt ? esc(img.alt) : 'Sin descripción'}</span>
                        </div>
                        <div class="image-actions">
                            ${!isCover
                                ? `<button class="btn btn-small" onclick="setAsCover('${editingId}','${img.id}')">Marcar portada</button>`
                                : `<span class="btn btn-small btn-primary">Es portada</span>`
                            }
                            <button class="btn btn-small btn-danger" onclick="removeImage('${editingId}','${img.id}')">Eliminar</button>
                        </div>
                    </div>
                </div>`;
        }).join('');
}

async function setAsCover(eventId, imageId) {
    try {
        const r = await fetch(`${API_BASE}/events/${eventId}/images/${imageId}/set-cover`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!r.ok) throw new Error('No se pudo establecer como portada');

        const re = await fetch(`${API_BASE}/events/${eventId}`);
        const ev = await re.json();
        renderImagesChips(ev.images || []);
        toast('Imagen establecida como portada');
    } catch (err) {
        console.error('Error setting cover:', err);
        alert('Error al establecer como portada');
    }
}

// Modal para vista ampliada
function openImageModal(src) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-backdrop" onclick="closeImageModal()"></div>
        <div class="modal-content">
            <button class="modal-close" onclick="closeImageModal()">✕</button>
            <img src="${esc(src)}" alt="Vista previa ampliada" />
        </div>
    `;
    document.body.appendChild(modal);

    const closeOnEsc = (e) => {
        if (e.key === 'Escape') closeImageModal();
    };
    modal._closeOnEsc = closeOnEsc;
    document.addEventListener('keydown', closeOnEsc);
}

function closeImageModal() {
    const modal = document.querySelector('.image-modal');
    if (modal) {
        document.removeEventListener('keydown', modal._closeOnEsc);
        modal.remove();
    }
}

// Agregar imagen por URL
async function addImageByUrl() {
    if (!editingId) {
        toast('Guarda o edita un evento primero');
        return;
    }

    const url       = $('#img-url')?.value.trim();
    const alt       = $('#img-alt')?.value.trim() || '';
    const position  = parseInt($('#img-pos')?.value || '1', 10);

    if (!url) {
        toast('Ingresa una URL válida');
        return;
    }

    try {
        const body = { url, alt, position };

        const r = await fetch(`${API_BASE}/events/${editingId}/images`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body)
        });

        if (!r.ok) throw new Error(`Error agregando imagen: ${r.status}`);

        $('#img-url').value = '';
        $('#img-pos').value = '1';

        const re = await fetch(`${API_BASE}/events/${editingId}`);
        const ev = await re.json();
        renderImagesChips(ev.images || []);
        toast('Imagen agregada por URL');
    } catch (err) {
        console.error('Error adding image by URL:', err);
        alert(err.message || 'Error agregando imagen por URL.');
    }
}

// Subida de archivos
async function uploadFilesForEvent() {
    if (!editingId) {
        toast('Guarda o edita un evento primero');
        return;
    }

    const inp = $('#img-file');
    if (!inp || !inp.files || !inp.files.length) {
        toast('Selecciona 1 o más imágenes');
        return;
    }

    const alt       = $('#img-alt')?.value.trim() || '';
    const makeCover = $('#img-make-cover')?.checked || false;

    try {
        const progressBar      = $('#upload-progress');
        const progressBarInner = progressBar?.querySelector('.bar');
        if (progressBar) progressBar.style.display = 'block';

        let uploaded = 0;
        const total = inp.files.length;

        for (const file of inp.files) {
            const fd = new FormData();
            fd.append('file', file);

            const up = await fetch(`${API_BASE}/uploads`, {
                method: 'POST',
                body:   fd
            });

            if (!up.ok) throw new Error(`Upload falló (${up.status})`);
            const info = await up.json();
            if (!info?.url) throw new Error('Respuesta sin URL');

            const isCover = makeCover && uploaded === 0;

            const body = {
                url:      info.url,
                alt,
                position: uploaded + 1,
                is_cover: isCover
            };

            const r = await fetch(`${API_BASE}/events/${editingId}/images`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body)
            });

            if (!r.ok) {
                const t = await r.text();
                throw new Error(`POST /images ${r.status}: ${t}`);
            }

            uploaded++;

            if (progressBarInner) {
                const progress = (uploaded / total) * 100;
                progressBarInner.style.width = `${progress}%`;
            }
        }

        inp.value = '';
        const altInput  = $('#img-alt');        if (altInput)  altInput.value = '';
        const chk       = $('#img-make-cover'); if (chk)       chk.checked    = false;
        if (progressBar) progressBar.style.display = 'none';

        const re = await fetch(`${API_BASE}/events/${editingId}`);
        const ev = await re.json();
        renderImagesChips(ev.images || []);
        await loadEvents();

        toast(`¡${uploaded} imagen(es) subida(s) correctamente!`);
    } catch (err) {
        console.error('Error uploading images:', err);
        alert(err.message || 'Error subiendo imágenes.');
        const progressBar = $('#upload-progress');
        if (progressBar) progressBar.style.display = 'none';
    }
}

async function removeImage(eventId, imageId) {
    if (!confirm('¿Eliminar esta imagen?')) return;

    try {
        const r = await fetch(`${API_BASE}/events/${eventId}/images/${imageId}`, {
            method: 'DELETE'
        });
        if (r.status !== 204) {
            alert('No se pudo eliminar la imagen');
            return;
        }

        const re = await fetch(`${API_BASE}/events/${eventId}`);
        const ev = await re.json();
        renderImagesChips(ev.images || []);
        await loadEvents();
        toast('Imagen eliminada');
    } catch (error) {
        console.error('Error removing image:', error);
        alert('Error eliminando imagen');
    }
}

function updateDurationPreview() {
    const ds   = $('#ev-date')?.value;
    const ts   = parseFlexibleTime($('#ev-start')?.value);
    const de   = $('#ev-date-end')?.value || ds;
    const teRaw = $('#ev-end')?.value;
    const te   = teRaw ? parseFlexibleTime(teRaw) : null;
    const h    = $('#duration-hint');

    if (!ds || !ts || !de || !te) {
        if (h) h.textContent = '—';
        return;
    }
    if (h) h.textContent = diffHuman(toISO(ds, ts), toISO(de, te));
}

// ====== VENUES ======
function bindVenuesView() {
    $('#venue-add')?.addEventListener('click', addVenue);
}

async function loadVenues() {
    try {
        const r = await fetch(`${API_BASE}/venues`);
        if (!r.ok) throw new Error('Error cargando sedes');
        venues = await r.json();
        renderVenuesList();
    } catch (error) {
        console.error('Error loading venues:', error);
        venues = [];
        renderVenuesList();
    }
}

async function addVenue() {
    const name = $('#venue-name').value.trim();
    if (!name) {
        toast('Ingresa un nombre para la sede');
        return;
    }

    try {
        const r = await fetch(`${API_BASE}/venues`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name })
        });
        if (!r.ok) throw new Error('No se pudo crear la sede');

        $('#venue-name').value = '';
        await loadVenues();
        renderVenueSelect();
        renderVenuesFilter();
        toast('Sede creada correctamente');
    } catch (error) {
        console.error('Error adding venue:', error);
        alert('Error creando sede');
    }
}

async function deleteVenue(id) {
    if (!confirm('¿Eliminar esta sede?')) return;

    try {
        const r = await fetch(`${API_BASE}/venues/${id}`, { method: 'DELETE' });
        if (r.status !== 204) throw new Error('No se pudo eliminar');

        await loadVenues();
        renderVenueSelect();
        renderVenuesFilter();
        await loadEvents();
        toast('Sede eliminada');
    } catch (error) {
        console.error('Error deleting venue:', error);
        alert('Error eliminando sede');
    }
}

function renderVenuesList() {
    const box = $('#venues-list');
    if (!box) return;

    if (!venues.length) {
        box.innerHTML = '<div class="td">No hay sedes registradas.</div>';
        return;
    }

    const head = `
        <div class="tr th-row">
            <div class="th">Nombre</div>
            <div class="th">Acciones</div>
        </div>`;

    const rows = venues.map(venue => `
        <div class="tr">
            <div class="td">${esc(venue.name)}</div>
            <div class="td actions">
                <button class="btn btn-danger" onclick="deleteVenue('${venue.id}')">Eliminar</button>
            </div>
        </div>
    `).join('');

    box.innerHTML = head + rows;
}

function renderVenueSelect() {
    const sel = $('#ev-venue');
    if (!sel) return;

    sel.innerHTML =
        `<option value="">– Selecciona sede –</option>` +
        venues.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
}

function renderVenuesFilter() {
    const sel = $('#f-venue');
    if (!sel) return;

    sel.innerHTML =
        `<option value="">Sede (todas)</option>` +
        venues.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
}

// ====== CATEGORIES (localStorage) ======
function loadCategories() {
    const raw = localStorage.getItem('ceart_categories');
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch (error) {
            console.error('Error parsing categories:', error);
        }
    }
    const def = ['taller', 'exposición', 'concierto', 'teatro', 'danza', 'cine'];
    localStorage.setItem('ceart_categories', JSON.stringify(def));
    return def;
}

function saveCategories() {
    localStorage.setItem('ceart_categories', JSON.stringify(categories));
}

function bindCategoriesView() {
    $('#category-add')?.addEventListener('click', addCategory);
    renderCategoriesList();
}

function addCategory() {
    const name = $('#category-name').value.trim();
    if (!name) {
        toast('Ingresa un nombre para la categoría');
        return;
    }

    if (!categories.includes(name)) {
        categories.push(name);
        saveCategories();
        renderCategoriesList();
        renderCategorySelect();
        renderCategoriesFilter();
        $('#category-name').value = '';
        toast('Categoría agregada');
    } else {
        toast('La categoría ya existe');
    }
}

function renderCategoriesList() {
    const box = $('#categories-list');
    if (!box) return;

    if (!categories.length) {
        box.innerHTML = '<div class="td">No hay categorías registradas.</div>';
        return;
    }

    const head = `
        <div class="tr th-row">
            <div class="th">Nombre</div>
            <div class="th">Acciones</div>
        </div>`;

    const rows = categories.map(cat => `
        <div class="tr">
            <div class="td">${esc(cat)}</div>
            <div class="td actions">
                <button class="btn btn-danger" onclick="removeCategory('${esc(cat)}')">Eliminar</button>
            </div>
        </div>
    `).join('');

    box.innerHTML = head + rows;
}

function removeCategory(name) {
    if (!confirm(`¿Eliminar la categoría "${name}"?`)) return;

    categories = categories.filter(c => c !== name);
    saveCategories();
    renderCategoriesList();
    renderCategorySelect();
    renderCategoriesFilter();
    toast('Categoría eliminada');
}

function renderCategorySelect() {
    const s = $('#ev-category');
    if (s) {
        s.innerHTML =
            '<option value="">– Selecciona categoría –</option>' +
            categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    }
}

function renderCategoriesFilter() {
    const s = $('#f-category');
    if (s) {
        s.innerHTML =
            `<option value="">Categoría (todas)</option>` +
            categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    }
}

// ====== BOOKINGS MEJORADO ======
function bindBookingsView() {
    $('#booking-add')?.addEventListener('click', openBookingModal);
    $('#booking-form')?.addEventListener('submit', createBooking);
    $('#booking-modal-close')?.addEventListener('click', closeBookingModal);
    $('#booking-event-select')?.addEventListener('change', updateEventCapacity);
}

async function tryLoadBookings() {
    try {
        const r = await fetch(`${API_BASE}/bookings`);
        if (!r.ok) throw new Error('Error cargando reservas');
        bookings = await r.json();
        renderBookingsTable();
    } catch (error) {
        console.error('Error loading bookings:', error);
        const b = $('#bookings-table');
        if (b) b.innerHTML = '<div class="td">No se pudieron cargar las reservas.</div>';
    }
}

function renderBookingsTable() {
    const b = $('#bookings-table');
    if (!b) return;

    if (!bookings.length) {
        b.innerHTML = '<div class="td">No hay reservas registradas.</div>';
        return;
    }

    const head = `
        <div class="tr th-row">
            <div class="th">Evento</div>
            <div class="th">Persona</div>
            <div class="th">Contacto</div>
            <div class="th">Cantidad</div>
            <div class="th">Estado</div>
            <div class="th">Fecha</div>
            <div class="th">Acciones</div>
        </div>`;

    const rows = bookings.map(bk => {
        const eventDate = bk.event_date ? new Date(bk.event_date).toLocaleDateString('es-MX') : '—';
        const statusBadge = bk.status === 'confirmed'
            ? '<span class="status-badge confirmed">Confirmada</span>'
            : '<span class="status-badge cancelled">Cancelada</span>';

        return `
            <div class="tr">
                <div class="td">
                    <strong>${esc(bk.event_title || 'Evento')}</strong>
                    <div class="muted">${eventDate}</div>
                </div>
                <div class="td">
                    <strong>${esc(bk.name)}</strong>
                    ${bk.notes ? `<div class="muted">${esc(bk.notes)}</div>` : ''}
                </div>
                <div class="td">
                    <div>${esc(bk.email)}</div>
                    ${bk.phone ? `<div class="muted">${esc(bk.phone)}</div>` : ''}
                </div>
                <div class="td">
                    <span class="qty-badge">${bk.qty}</span>
                </div>
                <div class="td">${statusBadge}</div>
                <div class="td">${ymd(bk.created_at)}</div>
                <div class="td actions">
                    ${bk.status === 'confirmed'
                        ? `<button class="btn btn-warning" onclick="cancelBooking('${bk.id}')">Cancelar</button>`
                        : `<span class="muted">Cancelada</span>`
                    }
                    <button class="btn btn-danger" onclick="deleteBooking('${bk.id}')">Eliminar</button>
                </div>
            </div>`;
    }).join('');

    b.innerHTML = head + rows;
}

// Modal reservas
function openBookingModal() {
    loadEventsForBooking();
    $('#booking-modal').style.display = 'flex';
}

function closeBookingModal() {
    $('#booking-modal').style.display = 'none';
    $('#booking-form').reset();
    $('#capacity-info').innerHTML = '';
}

async function loadEventsForBooking() {
    try {
        const r = await fetch(`${API_BASE}/events?status=scheduled&pageSize=100`);
        if (!r.ok) throw new Error('Error cargando eventos');

        const data = await r.json();
        const select = $('#booking-event-select');

        select.innerHTML = '<option value="">Selecciona un evento</option>' +
            data.items.map(event =>
                `<option value="${event.id}" data-capacity="${event.capacity_total}">
                    ${esc(event.title)} - ${new Date(event.start_at).toLocaleDateString('es-MX')}
                 </option>`
            ).join('');
    } catch (error) {
        console.error('Error loading events for booking:', error);
        toast('Error cargando eventos');
    }
}

async function updateEventCapacity() {
    const select       = $('#booking-event-select');
    const eventId      = select.value;
    const capacityInfo = $('#capacity-info');

    if (!eventId) {
        capacityInfo.innerHTML = '';
        return;
    }

    try {
        const r = await fetch(`${API_BASE}/events/${eventId}/availability`);
        if (!r.ok) throw new Error('Error verificando disponibilidad');

        const availability = await r.json();

        let message;
        if (availability.is_sold_out) {
            message = `<div class="alert alert-warning">⚠️ Este evento está AGOTADO</div>`;
            $('#booking-add-btn').disabled = true;
        } else {
            message = `
                <div class="capacity-info">
                    <strong>Disponibilidad:</strong>
                    <span class="available">${availability.available_qty}</span> /
                    ${availability.capacity_total} lugares disponibles
                </div>`;
            $('#booking-add-btn').disabled = false;
        }

        capacityInfo.innerHTML = message;
    } catch (error) {
        console.error('Error updating capacity:', error);
        capacityInfo.innerHTML = '<div class="alert alert-error">Error verificando disponibilidad</div>';
    }
}

async function createBooking(e) {
    e.preventDefault();

    const eventId = $('#booking-event-select').value;
    const name    = $('#booking-name').value.trim();
    const email   = $('#booking-email').value.trim();
    const phone   = $('#booking-phone').value.trim();
    const qty     = parseInt($('#booking-qty').value);
    const notes   = $('#booking-notes').value.trim();

    if (!eventId || !name || !email) {
        toast('Por favor completa los campos requeridos');
        return;
    }

    if (qty < 1) {
        toast('La cantidad debe ser al menos 1');
        return;
    }

    try {
        const payload = { event_id: eventId, name, email, phone, qty, notes };

        const r = await fetch(`${API_BASE}/bookings`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });

        if (!r.ok) {
            const errorData = await r.json();
            throw new Error(errorData.error || 'Error creando reserva');
        }

        const result = await r.json();
        toast(result.message || 'Reserva creada exitosamente');
        closeBookingModal();
        await tryLoadBookings();
        await loadEvents();
    } catch (error) {
        console.error('Error creating booking:', error);
        alert(error.message || 'Error creando reserva');
    }
}

async function cancelBooking(id) {
    if (!confirm('¿Cancelar esta reserva? Esto liberará los lugares reservados.')) return;

    try {
        const r = await fetch(`${API_BASE}/bookings/${id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ status: 'cancelled' })
        });

        if (!r.ok) throw new Error('Error cancelando reserva');

        toast('Reserva cancelada');
        await tryLoadBookings();
        await loadEvents();
    } catch (error) {
        console.error('Error canceling booking:', error);
        alert('Error cancelando reserva');
    }
}

async function deleteBooking(id) {
    if (!confirm('¿Eliminar permanentemente esta reserva?')) return;

    try {
        const r = await fetch(`${API_BASE}/bookings/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error('Error eliminando reserva');

        toast('Reserva eliminada');
        await tryLoadBookings();
        await loadEvents();
    } catch (error) {
        console.error('Error deleting booking:', error);
        alert('Error eliminando reserva');
    }
}

// ====== GLOBALS ======
window.editEvent         = editEvent;
window.deleteEvent       = async (id) => {
    if (!confirm('¿Eliminar este evento?')) return;

    try {
        const r = await fetch(`${API_BASE}/events/${id}`, { method: 'DELETE' });
        if (r.status !== 204) throw new Error('No se pudo eliminar');
        await loadEvents();
        toast('Evento eliminado');
    } catch (error) {
        console.error('Error deleting event:', error);
        alert('Error eliminando evento');
    }
};
window.removeImage       = removeImage;
window.setAsCover        = setAsCover;
window.openImageModal    = openImageModal;
window.closeImageModal   = closeImageModal;
window.cancelBooking     = cancelBooking;
window.deleteBooking     = deleteBooking;
window.openBookingModal  = openBookingModal;
window.closeBookingModal = closeBookingModal;
window.updateEventCapacity = updateEventCapacity;
window.deleteVenue       = deleteVenue;
