/**
 * Ежедневная загрузка КИЗов WB.
 *
 * Первый этап:
 * - Google Таблица хранит рабочие листы;
 * - лист "Настройки" хранит юрлица и WB API токены;
 * - Apps Script ежедневно загружает вчерашние КИЗы из WB;
 * - КИЗы движутся между листами "к выводу", "к вводу" и "архив";
 * - отдельного HTML-интерфейса пока нет.
 */

const TZ = 'Europe/Moscow';

const SHEETS = {
  settings: 'Настройки',
  syncLog: 'Журнал синхронизации',
  errors: 'Ошибки'
};

const SHEET_ALIASES = {
  'Настройки': ['settings'],
  'Журнал синхронизации': ['sync_log'],
  'Ошибки': ['errors'],
  'Юрлицо 1 - КИЗы к выводу': ['entity_1_withdraw'],
  'Юрлицо 1 - КИЗы к вводу': ['entity_1_introduce'],
  'Юрлицо 1 - Архив выведенных КИЗов': ['entity_1_archive'],
  'Юрлицо 2 - КИЗы к выводу': ['entity_2_withdraw'],
  'Юрлицо 2 - КИЗы к вводу': ['entity_2_introduce'],
  'Юрлицо 2 - Архив выведенных КИЗов': ['entity_2_archive']
};

const LEGACY_DATA_SHEETS = {
  entity_1_data: 'Старые данные юрлица 1',
  entity_2_data: 'Старые данные юрлица 2'
};

const DEFAULT_ENTITIES = [
  {
    entityId: 'entity_1',
    legalName: 'Юрлицо 1',
    withdrawSheetName: 'Юрлицо 1 - КИЗы к выводу',
    introduceSheetName: 'Юрлицо 1 - КИЗы к вводу',
    archiveSheetName: 'Юрлицо 1 - Архив выведенных КИЗов'
  },
  {
    entityId: 'entity_2',
    legalName: 'Юрлицо 2',
    withdrawSheetName: 'Юрлицо 2 - КИЗы к выводу',
    introduceSheetName: 'Юрлицо 2 - КИЗы к вводу',
    archiveSheetName: 'Юрлицо 2 - Архив выведенных КИЗов'
  }
];

const SETTINGS_KEYS = [
  'entityId',
  'legalName',
  'inn',
  'wbToken',
  'isActive',
  'withdrawSheetName',
  'introduceSheetName',
  'archiveSheetName',
  'apiMode',
  'lastSyncAt',
  'lastSyncStatus',
  'comment'
];

const SETTINGS_HEADERS = [
  'ID юрлица',
  'Название юрлица',
  'ИНН',
  'WB API токен',
  'Активно',
  'Лист: КИЗы к выводу',
  'Лист: КИЗы к вводу',
  'Лист: архив выведенных КИЗов',
  'Режим WB API',
  'Последняя синхронизация',
  'Статус последней синхронизации',
  'Комментарий'
];

const DATA_KEYS = [
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
  'supplierStatus',
  'wbStatus',
  'wbDate',
  'status',
  'source',
  'createdAt',
  'updatedAt',
  'dedupeKey',
  'comment'
];

const DATA_HEADERS = [
  'Дата загрузки',
  'ID юрлица',
  'Название юрлица',
  'ИНН',
  'Операция',
  'КИЗ / SGTIN',
  'Артикул',
  'Баркод',
  'ID заказа WB',
  'SRID',
  'Статус продавца WB',
  'Статус WB',
  'Дата заказа WB',
  'Состояние строки',
  'Источник',
  'Создано',
  'Обновлено',
  'Ключ дубля',
  'Комментарий'
];

const LOG_KEYS = [
  'startedAt',
  'finishedAt',
  'entityId',
  'legalName',
  'periodFrom',
  'periodTo',
  'rowsLoaded',
  'newRows',
  'duplicateRows',
  'withdrawNewRows',
  'introduceNewRows',
  'errors',
  'status',
  'message'
];

const LOG_HEADERS = [
  'Начало',
  'Окончание',
  'ID юрлица',
  'Название юрлица',
  'Период с',
  'Период по',
  'КИЗов найдено',
  'Новых строк',
  'Дублей',
  'Новых к выводу',
  'Новых к вводу',
  'Ошибок',
  'Статус',
  'Сообщение'
];

const ERROR_KEYS = [
  'createdAt',
  'entityId',
  'step',
  'orderId',
  'kiz',
  'message',
  'rawResponse'
];

const ERROR_HEADERS = [
  'Создано',
  'ID юрлица',
  'Шаг',
  'ID заказа WB',
  'КИЗ / SGTIN',
  'Сообщение',
  'Сырой ответ'
];

const SETTINGS_ALIASES = {
  entityId: ['ID юрлица', 'entityId'],
  legalName: ['Название юрлица', 'legalName'],
  inn: ['ИНН', 'inn'],
  wbToken: ['WB API токен', 'wbToken'],
  isActive: ['Активно', 'isActive'],
  withdrawSheetName: ['Лист: КИЗы к выводу', 'withdrawSheetName'],
  introduceSheetName: ['Лист: КИЗы к вводу', 'introduceSheetName'],
  archiveSheetName: ['Лист: архив выведенных КИЗов', 'archiveSheetName'],
  apiMode: ['Режим WB API', 'apiMode'],
  lastSyncAt: ['Последняя синхронизация', 'lastSyncAt'],
  lastSyncStatus: ['Статус последней синхронизации', 'lastSyncStatus'],
  comment: ['Комментарий', 'comment']
};

const DATA_ALIASES = {
  syncDate: ['Дата загрузки', 'syncDate'],
  entityId: ['ID юрлица', 'entityId'],
  legalName: ['Название юрлица', 'legalName'],
  inn: ['ИНН', 'inn'],
  operation: ['Операция', 'operation'],
  kiz: ['КИЗ / SGTIN', 'kiz'],
  article: ['Артикул', 'article'],
  barcode: ['Баркод', 'barcode'],
  orderId: ['ID заказа WB', 'orderId'],
  srid: ['SRID', 'srid'],
  supplierStatus: ['Статус продавца WB', 'supplierStatus'],
  wbStatus: ['Статус WB', 'wbStatus'],
  wbDate: ['Дата заказа WB', 'wbDate'],
  status: ['Состояние строки', 'status'],
  source: ['Источник', 'source'],
  createdAt: ['Создано', 'createdAt'],
  updatedAt: ['Обновлено', 'updatedAt'],
  dedupeKey: ['Ключ дубля', 'dedupeKey'],
  comment: ['Комментарий', 'comment']
};

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
  renameLegacyDataSheets_();
  const entities = ensureSettingsSheet_();
  entities.forEach(entity => {
    ensureSheet_(entity.withdrawSheetName, DATA_HEADERS, []);
    ensureSheet_(entity.introduceSheetName, DATA_HEADERS, []);
    ensureSheet_(entity.archiveSheetName, DATA_HEADERS, []);
  });
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
    if (shouldToast) SpreadsheetApp.getActive().toast('Нет активных юрлиц на листе Настройки', 'WB КИЗы', 8);
    throw new Error('Нет активных юрлиц на листе Настройки');
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
    const withdrawRows = results.reduce((sum, result) => sum + result.withdrawNewRows, 0);
    const introduceRows = results.reduce((sum, result) => sum + result.introduceNewRows, 0);
    SpreadsheetApp.getActive().toast(
      'Готово: успешно ' + ok + ' / ошибок ' + errors + ' · к выводу: ' + withdrawRows + ' · к вводу: ' + introduceRows + ' · дублей: ' + duplicateRows,
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
  let withdrawNewRows = 0;
  let introduceNewRows = 0;
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
    withdrawNewRows = result.withdrawNewRows;
    introduceNewRows = result.introduceNewRows;
    updateSettingsSyncStatus_(entity.entityId, 'Успешно: к выводу ' + withdrawNewRows + ', к вводу ' + introduceNewRows + ', дублей ' + duplicateRows);
  } catch (err) {
    status = 'ERROR';
    errorCount = 1;
    message = err && err.message ? err.message : String(err);
    appendError_(entity.entityId, 'syncEntity', '', '', message, err && err.stack ? err.stack : '');
    updateSettingsSyncStatus_(entity.entityId, 'Ошибка: ' + message.slice(0, 150));
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
      withdrawNewRows,
      introduceNewRows,
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
    withdrawNewRows,
    introduceNewRows,
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
  if (!entity.withdrawSheetName) throw new Error(entity.entityId + ': не указан лист для КИЗов к выводу');
  if (!entity.introduceSheetName) throw new Error(entity.entityId + ': не указан лист для КИЗов к вводу');
  if (!entity.archiveSheetName) throw new Error(entity.entityId + ': не указан лист архива');
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
      const statusMap = fetchOrderStatusMap_(mode, entity.wbToken, orders, entity.entityId);

      orders.forEach(order => {
        const orderId = getOrderId_(order);
        if (!orderId) return;
        const statusInfo = statusMap[String(orderId)] || {};
        if (mode === 'fbs' && !statusInfo.id && !statusInfo.orderId && !statusInfo.orderID) {
          appendError_(entity.entityId, 'orderWithoutStatus:' + mode, String(orderId), '', 'WB не вернул статус заказа', JSON.stringify(order).slice(0, 3000));
          return;
        }
        const operation = classifyOperation_(order, statusInfo);
        if (operation === 'skip') return;

        const kizList = metaMap[String(orderId)] || [];
        if (!kizList.length) {
          appendError_(entity.entityId, 'orderWithoutSgtin:' + mode, String(orderId), '', 'В метаданных заказа не найден sgtin', JSON.stringify(order).slice(0, 3000));
          return;
        }

        kizList.forEach(kiz => {
          rows.push(normalizeKizRow_(entity, mode, order, statusInfo, operation, kiz, period));
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

function fetchOrderStatusMap_(mode, token, orders, entityId) {
  if (!orders.length) return {};
  if (mode !== 'fbs') return {};

  const out = {};
  const errors = [];
  const orderIds = orders.map(getOrderId_).filter(Boolean);
  chunk_(orderIds, 100).forEach(ids => {
    try {
      const response = wbPostJson_(
        'https://marketplace-api.wildberries.ru/api/v3/orders/status',
        token,
        { orders: ids.map(Number) }
      );
      extractBulkStatusItems_(response).forEach(item => {
        const id = String(item.id || item.orderId || item.orderID || '');
        if (!id) return;
        out[id] = item;
      });
    } catch (err) {
      errors.push(err.message);
      appendError_(entityId, 'fetchOrdersStatusBulk:' + mode, ids.join(','), '', err.message, '');
    }
  });
  if (errors.length) {
    throw new Error('WB не вернул статусы заказов: ' + errors.join(' | '));
  }
  return out;
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

function normalizeKizRow_(entity, sourceMode, order, statusInfo, operation, kiz, period) {
  const orderId = String(getOrderId_(order) || '');
  const srid = String(order.srid || '');
  const article = String(order.article || order.articleVendorCode || order.vendorCode || order.nmId || '');
  const barcode = firstBarcode_(order);
  const supplierStatus = String(statusInfo.supplierStatus || order.supplierStatus || '');
  const wbStatus = String(statusInfo.wbStatus || order.wbStatus || order.status || order.state || '');
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
    supplierStatus,
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

function classifyOperation_(order, statusInfo) {
  const supplierStatus = String(statusInfo.supplierStatus || order.supplierStatus || '').toLowerCase();
  const wbStatus = String(statusInfo.wbStatus || order.wbStatus || order.status || order.state || '').toLowerCase();

  if (wbStatus === 'canceled_by_client') {
    return 'introduce';
  }

  if (
    supplierStatus === 'cancel' ||
    wbStatus === 'canceled' ||
    wbStatus === 'declined_by_client' ||
    wbStatus === 'defect'
  ) {
    return 'skip';
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

function extractBulkStatusItems_(response) {
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
  const withdrawSheet = getOrCreateSheet_(entity.withdrawSheetName, DATA_HEADERS);
  const introduceSheet = getOrCreateSheet_(entity.introduceSheetName, DATA_HEADERS);
  const archiveSheet = getOrCreateSheet_(entity.archiveSheetName, DATA_HEADERS);
  const withdrawKeys = readExistingKeys_(withdrawSheet);
  const introduceKeys = readExistingKeys_(introduceSheet);
  const archiveKizKeys = readExistingKizKeys_(archiveSheet);
  const introduceKizKeys = readExistingKizKeys_(introduceSheet);
  const withdrawValues = [];
  const introduceValues = [];
  let duplicateRows = 0;

  rows.forEach(row => {
    if (row.operation === 'withdraw') {
      if (withdrawKeys.has(row.dedupeKey) || archiveKizKeys.has(row.kiz) || introduceKizKeys.has(row.kiz)) {
        duplicateRows += 1;
        return;
      }
      withdrawKeys.add(row.dedupeKey);
      withdrawValues.push(dataValues_(row));
      return;
    }

    if (row.operation === 'introduce') {
      if (!archiveKizKeys.has(row.kiz)) {
        appendError_(entity.entityId, 'introduceWithoutArchive', row.orderId, row.kiz, 'КИЗ к вводу обратно не найден в архиве', '');
        return;
      }
      if (introduceKeys.has(row.dedupeKey)) {
        duplicateRows += 1;
        return;
      }
      introduceKeys.add(row.dedupeKey);
      introduceValues.push(dataValues_(row));
      return;
    }

    if (row.operation === 'skip') {
      return;
    }

    duplicateRows += 1;
  });

  appendValues_(withdrawSheet, withdrawValues);
  appendValues_(introduceSheet, introduceValues);

  return {
    newRows: withdrawValues.length + introduceValues.length,
    duplicateRows,
    withdrawNewRows: withdrawValues.length,
    introduceNewRows: introduceValues.length
  };
}

function confirmWithdrawDone(entityId) {
  setupWorkbook_();
  const entity = getEntityById_(entityId);
  const withdrawSheet = getOrCreateSheet_(entity.withdrawSheetName, DATA_HEADERS);
  const archiveSheet = getOrCreateSheet_(entity.archiveSheetName, DATA_HEADERS);
  const rows = readDataObjects_(withdrawSheet);
  const archiveKeys = readExistingKeys_(archiveSheet);
  const archiveValues = [];
  const timestamp = now_();

  rows.forEach(row => {
    if (archiveKeys.has(row.dedupeKey)) return;
    row.status = 'archived';
    row.updatedAt = timestamp;
    archiveKeys.add(row.dedupeKey);
    archiveValues.push(dataValues_(row));
  });

  appendValues_(archiveSheet, archiveValues);
  clearDataRows_(withdrawSheet);
  SpreadsheetApp.getActive().toast('Выведенные КИЗы перенесены в архив: ' + archiveValues.length, 'WB КИЗы', 8);
  return archiveValues.length;
}

function confirmIntroduceDone(entityId) {
  setupWorkbook_();
  const entity = getEntityById_(entityId);
  const introduceSheet = getOrCreateSheet_(entity.introduceSheetName, DATA_HEADERS);
  const archiveSheet = getOrCreateSheet_(entity.archiveSheetName, DATA_HEADERS);
  const introduceRows = readDataObjects_(introduceSheet);
  const introducedKiz = new Set(introduceRows.map(row => String(row.kiz || '')).filter(Boolean));
  const removed = removeArchiveKiz_(archiveSheet, introducedKiz);
  clearDataRows_(introduceSheet);
  SpreadsheetApp.getActive().toast('КИЗы введены обратно: ' + introduceRows.length + ' · удалено из архива: ' + removed, 'WB КИЗы', 8);
  return { introduced: introduceRows.length, removedFromArchive: removed };
}

function appendValues_(sheet, values) {
  if (!values.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, DATA_HEADERS.length).setValues(values);
}

function readDataObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => objectFromRowWithAliases_(headers, row, DATA_ALIASES));
}

function clearDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
}

function removeArchiveKiz_(sheet, introducedKiz) {
  if (!introducedKiz.size) return 0;
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return 0;
  const headers = values[0].map(String);
  const kizIndex = findColumnIndex_(headers, DATA_ALIASES.kiz);
  if (kizIndex === -1) return 0;

  const keptRows = [];
  let removed = 0;
  values.slice(1).forEach(row => {
    const kiz = String(row[kizIndex] || '');
    if (introducedKiz.has(kiz)) {
      removed += 1;
      return;
    }
    keptRows.push(row);
  });

  clearDataRows_(sheet);
  if (keptRows.length) {
    sheet.getRange(2, 1, keptRows.length, headers.length).setValues(keptRows);
  }
  return removed;
}

function readExistingKizKeys_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return new Set();
  const headers = values[0].map(String);
  const kizIndex = findColumnIndex_(headers, DATA_ALIASES.kiz);
  if (kizIndex === -1) return new Set();
  return new Set(values.slice(1).map(row => String(row[kizIndex] || '')).filter(Boolean));
}

function getEntityById_(entityId) {
  const entity = readSettings_().find(item => item.entityId === entityId);
  if (!entity) throw new Error('Юрлицо не найдено: ' + entityId);
  return entity;
}

function ensureSettingsSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = getSheetByNameOrAlias_(SHEETS.settings);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.settings);
  }
  const values = sheet.getDataRange().getValues();
  const oldHeaders = values.length ? values[0].map(String) : [];
  const oldRows = values.length > 1
    ? values.slice(1).filter(row => row.some(cell => cell !== '')).map(row => objectFromRowWithAliases_(oldHeaders, row, SETTINGS_ALIASES))
    : [];
  const rowsById = {};
  oldRows.forEach(row => {
    const entityId = String(row.entityId || '').trim();
    if (entityId) rowsById[entityId] = row;
  });

  const seedRows = DEFAULT_ENTITIES.map(defaultEntity => {
    const row = rowsById[defaultEntity.entityId] || {};
    const legalName = row.legalName || defaultEntity.legalName;
    return {
      entityId: defaultEntity.entityId,
      legalName,
      inn: row.inn || '',
      wbToken: row.wbToken || '',
      isActive: row.isActive == null || row.isActive === '' ? 'TRUE' : row.isActive,
      withdrawSheetName: normalizeEntitySheetName_(defaultEntity.entityId, 'withdraw', row.withdrawSheetName, legalName, defaultEntity),
      introduceSheetName: normalizeEntitySheetName_(defaultEntity.entityId, 'introduce', row.introduceSheetName, legalName, defaultEntity),
      archiveSheetName: normalizeEntitySheetName_(defaultEntity.entityId, 'archive', row.archiveSheetName, legalName, defaultEntity),
      apiMode: row.apiMode || 'fbs',
      lastSyncAt: row.lastSyncAt || '',
      lastSyncStatus: row.lastSyncStatus || '',
      comment: row.comment || ''
    };
  });

  oldRows.forEach(row => {
    const entityId = String(row.entityId || '').trim();
    if (!entityId || rowsById[entityId] !== row) return;
    if (DEFAULT_ENTITIES.some(defaultEntity => defaultEntity.entityId === entityId)) return;
    const legalName = row.legalName || entityId;
    seedRows.push({
      entityId,
      legalName,
      inn: row.inn || '',
      wbToken: row.wbToken || '',
      isActive: row.isActive == null || row.isActive === '' ? 'TRUE' : row.isActive,
      withdrawSheetName: normalizeEntitySheetName_(entityId, 'withdraw', row.withdrawSheetName, legalName, null),
      introduceSheetName: normalizeEntitySheetName_(entityId, 'introduce', row.introduceSheetName, legalName, null),
      archiveSheetName: normalizeEntitySheetName_(entityId, 'archive', row.archiveSheetName, legalName, null),
      apiMode: row.apiMode || 'fbs',
      lastSyncAt: row.lastSyncAt || '',
      lastSyncStatus: row.lastSyncStatus || '',
      comment: row.comment || ''
    });
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, SETTINGS_HEADERS.length).setValues([SETTINGS_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, SETTINGS_HEADERS.length).setFontWeight('bold').setBackground('#eeeeee');
  if (seedRows.length) {
    sheet.getRange(2, 1, seedRows.length, SETTINGS_HEADERS.length)
      .setValues(seedRows.map(row => settingsValues_(row)));
  }

  return seedRows.map(row => ({
    entityId: String(row.entityId || '').trim(),
    legalName: String(row.legalName || '').trim(),
    inn: String(row.inn || '').trim(),
    wbToken: String(row.wbToken || '').trim(),
    isActive: parseActiveValue_(row.isActive),
    withdrawSheetName: String(row.withdrawSheetName || '').trim(),
    introduceSheetName: String(row.introduceSheetName || '').trim(),
    archiveSheetName: String(row.archiveSheetName || '').trim(),
    apiMode: String(row.apiMode || 'auto').trim() || 'auto'
  }));
}

function readExistingKeys_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return new Set();
  const headers = values[0].map(String);
  const keyIndex = findColumnIndex_(headers, DATA_ALIASES.dedupeKey);
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
    .map(row => objectFromRowWithAliases_(headers, row, SETTINGS_ALIASES))
    .map(row => ({
      entityId: String(row.entityId || '').trim(),
      legalName: String(row.legalName || '').trim(),
      inn: String(row.inn || '').trim(),
      wbToken: String(row.wbToken || '').trim(),
      isActive: parseActiveValue_(row.isActive),
      withdrawSheetName: normalizeEntitySheetName_(row.entityId, 'withdraw', row.withdrawSheetName, row.legalName, getDefaultEntity_(row.entityId)),
      introduceSheetName: normalizeEntitySheetName_(row.entityId, 'introduce', row.introduceSheetName, row.legalName, getDefaultEntity_(row.entityId)),
      archiveSheetName: normalizeEntitySheetName_(row.entityId, 'archive', row.archiveSheetName, row.legalName, getDefaultEntity_(row.entityId)),
      apiMode: String(row.apiMode || 'auto').trim() || 'auto'
    }));
}

function updateSettingsSyncStatus_(entityId, statusText) {
  const sheet = getOrCreateSheet_(SHEETS.settings, SETTINGS_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const entityIndex = findColumnIndex_(headers, SETTINGS_ALIASES.entityId);
  const lastSyncAtIndex = findColumnIndex_(headers, SETTINGS_ALIASES.lastSyncAt);
  const lastSyncStatusIndex = findColumnIndex_(headers, SETTINGS_ALIASES.lastSyncStatus);

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][entityIndex]) !== entityId) continue;
    sheet.getRange(i + 1, lastSyncAtIndex + 1).setValue(now_());
    sheet.getRange(i + 1, lastSyncStatusIndex + 1).setValue(statusText);
    return;
  }
}

function appendLog_(log) {
  const sheet = getOrCreateSheet_(SHEETS.syncLog, LOG_HEADERS);
  sheet.appendRow(LOG_KEYS.map(key => displayLogValue_(key, log[key])));
}

function appendError_(entityId, step, orderId, kiz, message, rawResponse) {
  const sheet = getOrCreateSheet_(SHEETS.errors, ERROR_HEADERS);
  const errorRow = {
    createdAt: now_(),
    entityId,
    step: displayErrorStep_(step),
    orderId,
    kiz,
    message,
    rawResponse
  };
  sheet.appendRow(ERROR_KEYS.map(key => errorRow[key] == null ? '' : errorRow[key]));
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
  let sheet = getSheetByNameOrAlias_(name);
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

function getSheetByNameOrAlias_(name) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  const aliases = SHEET_ALIASES[name] || [];
  for (let i = 0; i < aliases.length; i++) {
    sheet = ss.getSheetByName(aliases[i]);
    if (!sheet) continue;
    sheet.setName(name);
    return sheet;
  }
  return null;
}

function renameLegacyDataSheets_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(LEGACY_DATA_SHEETS).forEach(oldName => {
    const newName = LEGACY_DATA_SHEETS[oldName];
    const oldSheet = ss.getSheetByName(oldName);
    if (!oldSheet || ss.getSheetByName(newName)) return;
    oldSheet.setName(newName);
  });
}

function normalizeEntitySheetName_(entityId, kind, value, legalName, defaultEntity) {
  const raw = String(value || '').trim();
  const normalizedEntityId = String(entityId || '').trim();
  const normalizedLegalName = String(legalName || normalizedEntityId || 'Юрлицо').trim();
  const legacyName = normalizedEntityId ? normalizedEntityId + '_' + kind : '';
  if (raw && raw !== legacyName) return raw;
  if (defaultEntity) {
    if (kind === 'withdraw') return defaultEntity.withdrawSheetName;
    if (kind === 'introduce') return defaultEntity.introduceSheetName;
    if (kind === 'archive') return defaultEntity.archiveSheetName;
  }
  if (kind === 'withdraw') return normalizedLegalName + ' - КИЗы к выводу';
  if (kind === 'introduce') return normalizedLegalName + ' - КИЗы к вводу';
  return normalizedLegalName + ' - Архив выведенных КИЗов';
}

function getDefaultEntity_(entityId) {
  const normalizedEntityId = String(entityId || '').trim();
  return DEFAULT_ENTITIES.find(entity => entity.entityId === normalizedEntityId) || null;
}

function settingsValues_(row) {
  return SETTINGS_KEYS.map(key => {
    if (key === 'isActive') return parseActiveValue_(row[key]) ? 'Да' : 'Нет';
    return row[key] == null ? '' : row[key];
  });
}

function dataValues_(row) {
  return DATA_KEYS.map(key => displayDataValue_(key, row[key]));
}

function displayDataValue_(key, value) {
  if (value == null) return '';
  if (key === 'operation') return displayOperation_(value);
  if (key === 'status') return displayRowStatus_(value);
  if (key === 'source') return displaySource_(value);
  return value;
}

function displayOperation_(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'withdraw') return 'К выводу из оборота';
  if (raw === 'introduce') return 'К вводу обратно в оборот';
  if (raw === 'skip') return 'Пропустить';
  return value;
}

function displayRowStatus_(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'new') return 'Новая строка';
  if (raw === 'archived') return 'В архиве';
  return value;
}

function displaySource_(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'fbs') return 'FBS';
  if (raw === 'dbs') return 'DBS';
  if (raw === 'dbw') return 'DBW';
  return value;
}

function displayLogValue_(key, value) {
  if (value == null) return '';
  if (key === 'status') {
    if (value === 'OK') return 'Успешно';
    if (value === 'ERROR') return 'Ошибка';
  }
  return value;
}

function displayErrorStep_(step) {
  const raw = String(step || '');
  if (raw === 'syncEntity') return 'Синхронизация юрлица';
  if (raw.indexOf('orderWithoutStatus:') === 0) return 'Заказ без статуса WB (' + raw.split(':')[1].toUpperCase() + ')';
  if (raw.indexOf('orderWithoutSgtin:') === 0) return 'Заказ без КИЗа в metadata (' + raw.split(':')[1].toUpperCase() + ')';
  if (raw.indexOf('fetchCompletedOrders:') === 0) return 'Загрузка заказов WB (' + raw.split(':')[1].toUpperCase() + ')';
  if (raw.indexOf('fetchOrdersStatusBulk:') === 0) return 'Загрузка статусов WB (' + raw.split(':')[1].toUpperCase() + ')';
  if (raw.indexOf('fetchOrdersMetaBulk:') === 0) return 'Загрузка КИЗов WB (' + raw.split(':')[1].toUpperCase() + ')';
  if (raw === 'introduceWithoutArchive') return 'КИЗ к вводу не найден в архиве';
  return raw;
}

function parseActiveValue_(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (raw === 'нет' || raw === 'false' || raw === '0' || raw === 'no') return false;
  return true;
}

function findColumnIndex_(headers, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const index = headers.indexOf(aliases[i]);
    if (index !== -1) return index;
  }
  return -1;
}

function objectFromRowWithAliases_(headers, row, aliasesByKey) {
  const out = {};
  Object.keys(aliasesByKey).forEach(key => {
    const index = findColumnIndex_(headers, aliasesByKey[key]);
    out[key] = index === -1 ? '' : row[index];
  });
  return out;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function formatDate_(date) {
  return Utilities.formatDate(date, TZ, 'yyyy-MM-dd HH:mm:ss');
}
