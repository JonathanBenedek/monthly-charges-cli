const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');

const DEFAULT_FOLDER_NAME = 'Monthly Expenses Data';
const MONTH_ORDER = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function monthSortKey(a, b) {
  const key = m => {
    const l = m.toLowerCase();
    const mi = MONTH_ORDER.findIndex(x => l.startsWith(x));
    const yr = (l.match(/\d+/) || ['99'])[0].padStart(4, '0');
    return yr + String(mi < 0 ? 99 : mi).padStart(2, '0');
  };
  return key(a).localeCompare(key(b));
}

function escapeQ(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function guessMime(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'xls') return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}

function toStream(content) {
  return Readable.from([content]);
}

/**
 * Node port of js/storage.js's Drive operations. Same folder layout/semantics
 * (root "Monthly Expenses Data" folder, "months"/"raw" subfolders, loadJSON/
 * saveJSON path convention), but authenticated via a cached OAuth2Client instead
 * of the browser gapi flow, and using the googleapis Drive v3 client directly.
 */
function createDriveClient(auth, { folderName } = {}) {
  const drive = google.drive({ version: 'v3', auth });
  let rootFolderId = null, monthsFolderId = null, rawFolderId = null;
  const fileIdCache = {};

  async function findOrCreateFolder(name, parentId) {
    const q = parentId
      ? `name='${escapeQ(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `name='${escapeQ(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await drive.files.list({ q, fields: 'files(id)', includeItemsFromAllDrives: true, supportsAllDrives: true });
    if (res.data.files.length > 0) return res.data.files[0].id;
    const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) meta.parents = [parentId];
    const created = await drive.files.create({ resource: meta, fields: 'id', supportsAllDrives: true });
    return created.data.id;
  }

  async function ensureFolders() {
    rootFolderId = await findOrCreateFolder(folderName || DEFAULT_FOLDER_NAME, null);
    monthsFolderId = await findOrCreateFolder('months', rootFolderId);
    rawFolderId = await findOrCreateFolder('raw', rootFolderId);
    return { rootFolderId, monthsFolderId, rawFolderId };
  }

  function getRootFolderId() { return rootFolderId; }

  async function findFile(filename, parentId) {
    const cacheKey = parentId + '/' + filename;
    if (fileIdCache[cacheKey]) return fileIdCache[cacheKey];
    const q = `name='${escapeQ(filename)}' and '${parentId}' in parents and trashed=false`;
    const res = await drive.files.list({ q, fields: 'files(id)', includeItemsFromAllDrives: true, supportsAllDrives: true });
    const id = res.data.files.length > 0 ? res.data.files[0].id : null;
    if (id) fileIdCache[cacheKey] = id;
    return id;
  }

  // path is like 'budget.json' (root) or 'months/Jan26.json' (months subfolder)
  function resolvePath(p) {
    const parts = p.split('/');
    if (parts.length === 2) return { parentId: monthsFolderId, filename: parts[1] };
    return { parentId: rootFolderId, filename: p };
  }

  async function loadJSON(p) {
    const { parentId, filename } = resolvePath(p);
    if (!parentId) return null;
    const fileId = await findFile(filename, parentId);
    if (!fileId) return null;
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );
    if (res.data === '' || res.data == null) return null;
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  }

  async function saveJSON(p, data) {
    const { parentId, filename } = resolvePath(p);
    const content = JSON.stringify(data, null, 2);
    const existingId = await findFile(filename, parentId);
    const media = { mimeType: 'application/json', body: toStream(content) };
    if (existingId) {
      await drive.files.update({ fileId: existingId, media, supportsAllDrives: true });
    } else {
      const created = await drive.files.create({
        resource: { name: filename, parents: [parentId] },
        media,
        fields: 'id',
        supportsAllDrives: true
      });
      fileIdCache[parentId + '/' + filename] = created.data.id;
    }
  }

  async function listMonths() {
    if (!monthsFolderId) return [];
    const q = `'${monthsFolderId}' in parents and trashed=false and mimeType='application/json'`;
    const res = await drive.files.list({ q, fields: 'files(id,name)', includeItemsFromAllDrives: true, supportsAllDrives: true });
    return res.data.files.map(f => f.name.replace(/\.json$/, '')).sort(monthSortKey);
  }

  async function deleteFile(p) {
    const { parentId, filename } = resolvePath(p);
    const cacheKey = parentId + '/' + filename;
    const fileId = await findFile(filename, parentId);
    if (!fileId) return;
    await drive.files.delete({ fileId, supportsAllDrives: true });
    delete fileIdCache[cacheKey];
  }

  async function _getOrCreateRawMonthFolder(monthName) {
    if (!rawFolderId) throw new Error('Drive client not initialized — call ensureFolders() first.');
    return findOrCreateFolder(monthName, rawFolderId);
  }

  async function saveRawFile(monthName, localFilePath) {
    const monthFolder = await _getOrCreateRawMonthFolder(monthName);
    const filename = path.basename(localFilePath);
    const q = `name='${escapeQ(filename)}' and '${monthFolder}' in parents and trashed=false`;
    const res = await drive.files.list({ q, fields: 'files(id)', includeItemsFromAllDrives: true, supportsAllDrives: true });
    const existingId = res.data.files.length > 0 ? res.data.files[0].id : null;
    const media = { mimeType: guessMime(filename), body: fs.createReadStream(localFilePath) };
    if (existingId) {
      await drive.files.update({ fileId: existingId, media, supportsAllDrives: true });
    } else {
      await drive.files.create({
        resource: { name: filename, parents: [monthFolder] },
        media,
        fields: 'id',
        supportsAllDrives: true
      });
    }
  }

  async function listRawFiles(monthName) {
    if (!rawFolderId) return [];
    const q = `name='${escapeQ(monthName)}' and '${rawFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const folderRes = await drive.files.list({ q, fields: 'files(id)', includeItemsFromAllDrives: true, supportsAllDrives: true });
    if (!folderRes.data.files.length) return [];
    const monthFolder = folderRes.data.files[0].id;
    const fileQ = `'${monthFolder}' in parents and trashed=false`;
    const res = await drive.files.list({
      q: fileQ,
      fields: 'files(id,name,size,modifiedTime)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });
    return res.data.files.map(f => ({
      id: f.id,
      name: f.name,
      size: f.size ? parseInt(f.size) : 0,
      mtime: f.modifiedTime
    }));
  }

  return {
    ensureFolders, getRootFolderId,
    loadJSON, saveJSON, listMonths, deleteFile,
    saveRawFile, listRawFiles
  };
}

module.exports = { createDriveClient, DEFAULT_FOLDER_NAME, monthSortKey };
