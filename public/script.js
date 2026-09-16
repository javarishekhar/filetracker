const openModalBtn = document.getElementById('openModalBtn');
const cancelBtn = document.getElementById('cancelBtn');
const modalOverlay = document.getElementById('modalOverlay');
const entryForm = document.getElementById('entryForm');
const formError = document.getElementById('formError');
const entriesBody = document.getElementById('entriesBody');
const emptyMsg = document.getElementById('emptyMsg');

openModalBtn.addEventListener('click', () => {
  formError.textContent = '';
  entryForm.reset();
  modalOverlay.style.display = 'flex';
});

cancelBtn.addEventListener('click', () => {
  modalOverlay.style.display = 'none';
});

entryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';

  const formData = new FormData(entryForm);

  try {
    const res = await fetch('/api/entries', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (!res.ok) {
      formError.textContent = data.error || 'Failed to submit';
      return;
    }

    modalOverlay.style.display = 'none';
    await loadEntries();
  } catch (err) {
    formError.textContent = 'Network error: ' + err.message;
  }
});

async function loadEntries() {
  const res = await fetch('/api/entries');
  const entries = await res.json();

  entriesBody.innerHTML = '';

  if (entries.length === 0) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  for (const entry of entries) {
    const tr = document.createElement('tr');

    const filesHtml = entry.files.map(f =>
      `<a href="/uploads/${encodeURIComponent(f.stored_name)}" target="_blank">${escapeHtml(f.original_name)}</a>`
    ).join('');

    tr.innerHTML = `
      <td>${entry.serial_no}</td>
      <td>${escapeHtml(entry.heading)}</td>
      <td>${escapeHtml(entry.description || '')}</td>
      <td class="fileList">${filesHtml || '-'}</td>
      <td>${new Date(entry.created_at).toLocaleString()}</td>
      <td><span class="deleteBtn" data-id="${entry.id}">Delete</span></td>
    `;

    entriesBody.appendChild(tr);
  }

  document.querySelectorAll('.deleteBtn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      await fetch('/api/entries/' + btn.dataset.id, { method: 'DELETE' });
      await loadEntries();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadEntries();
