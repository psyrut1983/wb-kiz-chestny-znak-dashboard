/**
 * WB KIZ Daily Sync.
 *
 * First stage only:
 * - one Google Sheet is the database;
 * - settings contains two legal entities and WB tokens;
 * - Apps Script loads yesterday's WB marking codes every day;
 * - data is written into separate entity tabs;
 * - no HTML/UI here.
 */

const TZ = 'Europe/Moscow';

const SHEETS = {
  settings: 'settings',
  entity1: 'entity_1_data',
  entity2: 'entity_2_data',
  syncLog: 'sync_log',
  errors: 'errors'
};

const SETTINGS_HEADERS = [
  'entityId',
  'legalName',
  'inn',
  'wbToken',
  'isActive',
  'dataSheetName',
  'apiMode',
  'lastSyncAt',
  'lastSyncStatus',
  'comment'
];

const DATA_HEADERS = [
  'syncDate',
  'entityId',
  'legalName',
  'inn',
  'operation',
  'kiz',
  'article',
  'barcode',
  'orderId',
  'srid',
  'wbStatus',
  'wbDate',
  'status',
  'source',
  'createdAt',
  'updatedAt',
  'dedupeKey',
  'comment'
];

const LOG_HEADERS = [
  'startedAt',
  'finishedAt',
  'entityId',
  'legalName',
  'periodFrom',
  'periodTo',
  'rowsLoaded',
  'newRows',
  'duplicateRows',
  'errors',
  'status',
  'message'
];

const ERROR_HEADERS = [
  'createdAt',
  'entityId',
  'step',
  'orderId',
  'kiz',
  'message',
  'rawResponse'
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WB КИЗы')
    .addItem('1. Подготовить таблицу', 'setupWorkbook')
    .addItem('2. Загрузить данные за вчера', 'syncYesterdayManual')
    .addItem('3. Создать триггер 08:00', 'createDailyTrigger')
    .addItem('Удалить триггеры WB', 'deleteDailyTriggers')
    .addToUi();
}

function setupWorkbook() {
  setupWorkbook_();
  SpreadsheetApp.getActive().toast('Структура таблицы готова', 'WB КИЗы', 5);
}

function setupWorkbook_() {
  ensureSheet_(SHEETS.settings, SETTINGS_HEADERS, [
    ['entity_1', 'Юрлицо 1', '', '', 'TRUE', SHEETS.entity1, 'fbs', '', '', ''],
    ['entity_2', 'Юрлицо 2', '', '', 'TRUE', SHEETS.entity2, 'fbs', '', '', '']
  ]);
  ensureSheet_(SHEETS.entity1, DATA_HEADERS, []);
  ensureSheet_(SHEETS.entity2, DATA_HEADERS, []);
  ensureSheet_(SHEETS.syncLog, LOG_HEADERS, []);
  ensureSheet_(SHEETS.errors, ERROR_HEADERS, []);
}

function syncYesterdayManual() {
  syncYesterdayAllEntities(true);
}

function syncYesterdayAllEntities(showToast) {
  const shouldToast = showToast === true;
  setupWorkbook_();
  const period = getYesterdayPeriod_();
  const entities = readSettings_().filter(entity => entity.isActive);

  if (!entities.length) {
    if (shouldToast) SpreadsheetApp.getActive().toast('Нет активных юрлиц в settings', 'WB КИЗы', 8);
    throw new Error('Нет активных юрлиц в settings');
  }

  if (shouldToast) {
    SpreadsheetApp.getActive().toast('Начал загрузку за ' + period.syncDate + ' · юрлиц: ' + entities.length, 'WB КИЗы', 8);
  }

  const results = entities.map(entity => syncEntity_(entity, period));

  if (shouldToast) {
    const ok = results.filter(result => result.status === 'OK').length;
    const errors = results.length - ok;
    const newRows = results.reduce((sum, result) => sum + result.newRows, 0);
    const duplicateRows = results.reduce((sum, result) => sum + result.duplicateRows, 0);
    SpreadsheetApp.getActive().toast(
      'Готово: ' + ok + ' OK / ' + errors + ' ошибок · новых КИЗов: ' + newRows + ' · дублей: ' + duplicateRows,
      'WB КИЗы',
      12
    );
  }

  return results;
}

function createDailyTrigger() {
  deleteDailyTriggers_(true);
  ScriptApp.newTrigger('syncYesterdayAllEntities')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone(TZ)
    .create();
  SpreadsheetApp.getActive().toast('Триггер создан: каждый день в 08:00', 'WB КИЗы', 5);
}

function deleteDailyTriggers() {
  const count = deleteDailyTriggers_(false);
  SpreadsheetApp.getActive().toast('Удалено триггеров WB: ' + count, 'WB КИЗы', 5);
}

function deleteDailyTriggers_(silent) {
  let count = 0;
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncYesterdayAllEntities')
    .forEach(trigger => {
      ScriptApp.deleteTrigger(trigger);
      count += 1;
    });
  return count;
}

function syncEntity_(entity, period) {
  const startedAt = now_();
  let rowsLoaded = 0;
  let newRows = 0;
  let duplicateRows = 0;
  let errorCount = 0;
  let status = 'OK';
  let message = '';

  try {
    validateEntity_(entity);
    const loadedRows = fetchWbKizRows_(entity, period);
    rowsLoaded = loadedRows.length;
    const result = appendNewDataRows_(entity, loadedRows);
    newRows = result.newRows;
    duplicateRows = result.duplicateRows;
    updateSettingsSyncStatus_(entity.entityId, 'OK ' + newRows + ' new / ' + duplicateRows + ' duplicates');
  } catch (err) {
    status = 'ERROR';
    errorCount = 1;
    message = err && err.message ? err.message : String(err);
    appendError_(entity.entityId, 'syncEntity', '', '', message, err && err.stack ? err.stack : '');
    updateSettingsSyncStatus_(entity.entityId, 'ERROR ' + message.slice(0, 150));
  } finally {
    appendLog_({
      startedAt,
      finishedAt: now_(),
      entityId: entity.entityId,
      legalName: entity.legalName,
      periodFrom: period.fromText,
      periodTo: period.toText,
      rowsLoaded,
      newRows,
      duplicateRows,
      errors: errorCount,
      status,
      message
    });
  }

  return {
    entityId: entity.entityId,
    legalName: entity.legalName,
    rowsLoaded,
    newRows,
    duplicateRows,
    errors: errorCount,
    status,
    message
  };
}

function validateEntity_(entity) {
  if (!entity.entityId) throw new Error('entityId пустой');
  if (!entity.legalName) throw new Error(entity.entityId + ': legalName пустой');
  if (!entity.inn) throw new Error(entity.entityId + ': inn пустой');
  if (!entity.wbToken) throw new Error(entity.entityId + ': wbToken пустой');
  if (!entity.dataSheetName) throw new Error(entity.entityId + ': dataSheetName пустой');
}

function fetchWbKizRows_(entity, period) {
  const modes = entity.apiMode === 'auto'
    ? ['fbs', 'dbs', 'dbw']
    : String(entity.apiMode || 'auto').split(',').map(v => v.trim()).filter(Boolean);

  const rows = [];
  const errors = [];

  modes.forEach(mode => {
    try {
      const orders = fetchCompletedOrders_(mode, entity.wbToken, period)
        .filter(order => isOrderInsidePeriod_(order, period));
      const metaMap = fetchOrderMetaMap_(mode, entity.wbToken, orders, entity.entityId);

      orders.forEach(order => {
        const orderId = getOrderId_(order);
        if (!orderId) return;

        const kizList = metaMap[String(orderId)] || [];
        if (!kizList.length) {
          appendError_(entity.entityId, 'orderWithoutSgtin:' + mode, String(orderId), '', 'В метаданных заказа не найден sgtin', JSON.stringify(order).slice(0, 3000));
          return;
        }

        kizList.forEach(kiz => {
          rows.push(normalizeKizRow_(entity, mode, order, kiz, period));
        });
      });
    } catch (err) {
      errors.push(mode + ': ' + err.message);
      appendError_(entity.entityId, 'fetchCompletedOrders:' + mode, '', '', err.message, '');
    }
  });

  if (!rows.length && errors.length) {
    throw new Error('WB не вернул КИЗы. Ошибки: ' + errors.join(' | '));
  }

  return rows;
}

function fetchOrderMetaMap_(mode, token, orders, entityId) {
  if (!orders.length) return {};
  if (mode !== 'fbs') return {};

  const out = {};
  const orderIds = orders.map(getOrderId_).filter(Boolean);
  chunk_(orderIds, 100).forEach(ids => {
    try {
      const response = wbPostJson_(
        'https://marketplace-api.wildberries.ru/api/marketplace/v3/orders/meta',
        token,
        { orders: ids.map(Number) }
      );
      extractBulkMetaItems_(response).forEach(item => {
        const id = String(item.id || item.orderId || item.orderID || '');
        if (!id) return;
        out[id] = extractSgtins_(item);
      });
    } catch (err) {
      appendError_(entityId, 'fetchOrdersMetaBulk:' + mode, ids.join(','), '', err.message, '');
    }
  });
  return out;
}

function fetchCompletedOrders_(mode, token, period) {
  const base = ordersBasePath_(mode);
  const url = 'https://marketplace-api.wildberries.ru' + base
    + '?limit=1000&next=0&dateFrom=' + encodeURIComponent(period.fromUnix);
  const data = wbFetchJson_(url, token);
  if (Array.isArray(data.orders)) return data.orders;
  if (Array.isArray(data)) return data;
  return [];
}

function ordersBasePath_(mode) {
  if (mode === 'dbs') return '/api/v3/dbs/orders';
  if (mode === 'dbw') return '/api/v3/dbw/orders';
  return '/api/v3/orders';
}

function wbFetchJson_(url, token) {
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: token },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('WB HTTP ' + code + ': ' + body.slice(0, 500));
  }
  return body ? JSON.parse(body) : {};
}

function wbPostJson_(url, token, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    headers: { Authorization: token },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('WB HTTP ' + code + ': ' + body.slice(0, 500));
  }
  return body ? JSON.parse(body) : {};
}

function normalizeKizRow_(entity, sourceMode, order, kiz, period) {
  const operation = detectOperation_(order);
  const orderId = String(getOrderId_(order) || '');
  const srid = String(order.srid || '');
  const article = String(order.article || order.articleVendorCode || order.vendorCode || order.nmId || '');
  const barcode = firstBarcode_(order);
  const wbStatus = String(order.status || order.wbStatus || order.state || '');
  const wbDate = String(order.createdAt || order.convertedAt || order.date || order.updatedAt || '');
  const dedupeKey = [entity.entityId, operation, kiz, orderId].join('|');
  const timestamp = now_();

  return {
    syncDate: period.syncDate,
    entityId: entity.entityId,
    legalName: entity.legalName,
    inn: entity.inn,
    operation,
    kiz,
    article,
    barcode,
    orderId,
    srid,
    wbStatus,
    wbDate,
    status: 'new',
    source: sourceMode,
    createdAt: timestamp,
    updatedAt: timestamp,
    dedupeKey,
    comment: ''
  };
}

function detectOperation_(order) {
  const hay = JSON.stringify(order).toLowerCase();
  if (
    hay.indexOf('reject') !== -1 ||
    hay.indexOf('declin') !== -1 ||
    hay.indexOf('cancel') !== -1 ||
    hay.indexOf('return') !== -1 ||
    hay.indexOf('отказ') !== -1 ||
    hay.indexOf('возврат') !== -1
  ) {
    return 'introduce';
  }
  return 'withdraw';
}

function extractSgtins_(metaResponse) {
  const details = Array.isArray(metaResponse.metaDetails) ? metaResponse.metaDetails : [];
  const fromDetails = [];
  details.forEach(detail => {
    if (String(detail.key || '').toLowerCase() !== 'sgtin') return;
    if (Array.isArray(detail.value)) {
      detail.value.forEach(value => value && fromDetails.push(String(value)));
    } else if (detail.value) {
      String(detail.value).split(/[\n,; ]+/).forEach(value => value && fromDetails.push(value));
    }
  });
  if (fromDetails.length) return unique_(fromDetails);

  const meta = metaResponse.meta || metaResponse;
  const sgtin = meta && meta.sgtin ? meta.sgtin : meta;
  const value = sgtin && sgtin.value != null ? sgtin.value : sgtin && sgtin.sgtin;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value) return [String(value)];
  if (Array.isArray(metaResponse.sgtins)) return metaResponse.sgtins.map(String).filter(Boolean);
  if (Array.isArray(metaResponse.sgtin)) return metaResponse.sgtin.map(String).filter(Boolean);
  if (typeof metaResponse.sgtin === 'string') return [metaResponse.sgtin];
  return [];
}

function extractBulkMetaItems_(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.orders)) return response.orders;
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.items)) return response.items;
  if (Array.isArray(response.result)) return response.result;
  return [];
}

function isOrderInsidePeriod_(order, period) {
  const rawDate = order.createdAt || order.convertedAt || order.date || order.updatedAt;
  if (!rawDate) return true;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() >= period.from.getTime() && date.getTime() <= period.to.getTime();
}

function firstBarcode_(order) {
  if (Array.isArray(order.skus) && order.skus.length) return String(order.skus[0]);
  if (Array.isArray(order.barcodes) && order.barcodes.length) return String(order.barcodes[0]);
  return String(order.barcode || '');
}

function getOrderId_(order) {
  return order.id || order.orderId || order.orderID || order.rid || '';
}

function chunk_(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function unique_(items) {
  const seen = {};
  return items.filter(item => {
    const key = String(item);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function appendNewDataRows_(entity, rows) {
  const sheet = getOrCreateSheet_(entity.dataSheetName, DATA_HEADERS);
  const existingKeys = readExistingKeys_(sheet);
  const newValues = [];
  let duplicateRows = 0;

  rows.forEach(row => {
    if (existingKeys.has(row.dedupeKey)) {
      duplicateRows += 1;
      return;
    }
    existingKeys.add(row.dedupeKey);
    newValues.push(DATA_HEADERS.map(header => row[header] == null ? '' : row[header]));
  });

  if (newValues.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newValues.length, DATA_HEADERS.length).setValues(newValues);
  }

  return { newRows: newValues.length, duplicateRows };
}

function readExistingKeys_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return new Set();
  const headers = values[0].map(String);
  const keyIndex = headers.indexOf('dedupeKey');
  if (keyIndex === -1) return new Set();
  return new Set(values.slice(1).map(row => String(row[keyIndex] || '')).filter(Boolean));
}

function readSettings_() {
  const sheet = getOrCreateSheet_(SHEETS.settings, SETTINGS_HEADERS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => objectFromRow_(headers, row))
    .map(row => ({
      entityId: String(row.entityId || '').trim(),
      legalName: String(row.legalName || '').trim(),
      inn: String(row.inn || '').trim(),
      wbToken: String(row.wbToken || '').trim(),
      isActive: String(row.isActive).toUpperCase() !== 'FALSE',
      dataSheetName: String(row.dataSheetName || '').trim(),
      apiMode: String(row.apiMode || 'auto').trim() || 'auto'
    }));
}

function updateSettingsSyncStatus_(entityId, statusText) {
  const sheet = getOrCreateSheet_(SHEETS.settings, SETTINGS_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const entityIndex = headers.indexOf('entityId');
  const lastSyncAtIndex = headers.indexOf('lastSyncAt');
  const lastSyncStatusIndex = headers.indexOf('lastSyncStatus');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][entityIndex]) !== entityId) continue;
    sheet.getRange(i + 1, lastSyncAtIndex + 1).setValue(now_());
    sheet.getRange(i + 1, lastSyncStatusIndex + 1).setValue(statusText);
    return;
  }
}

function appendLog_(log) {
  const sheet = getOrCreateSheet_(SHEETS.syncLog, LOG_HEADERS);
  sheet.appendRow(LOG_HEADERS.map(header => log[header] == null ? '' : log[header]));
}

function appendError_(entityId, step, orderId, kiz, message, rawResponse) {
  const sheet = getOrCreateSheet_(SHEETS.errors, ERROR_HEADERS);
  sheet.appendRow([
    now_(),
    entityId,
    step,
    orderId,
    kiz,
    message,
    rawResponse
  ]);
}

function getYesterdayPeriod_() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 1);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setHours(23, 59, 59, 999);
  return {
    from,
    to,
    fromUnix: Math.floor(from.getTime() / 1000),
    toUnix: Math.floor(to.getTime() / 1000),
    fromText: formatDate_(from),
    toText: formatDate_(to),
    syncDate: Utilities.formatDate(from, TZ, 'yyyy-MM-dd')
  };
}

function ensureSheet_(name, headers, seedRows) {
  const sheet = getOrCreateSheet_(name, headers);
  if (seedRows && seedRows.length && sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
  }
  return sheet;
}

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some((header, index) => String(current[index] || '') !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#eeeeee');
  }
  return sheet;
}

function objectFromRow_(headers, row) {
  const out = {};
  headers.forEach((header, index) => {
    out[header] = row[index];
  });
  return out;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function formatDate_(date) {
  return Utilities.formatDate(date, TZ, 'yyyy-MM-dd HH:mm:ss');
}
