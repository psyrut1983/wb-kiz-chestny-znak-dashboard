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
const MAX_PUBLIC_BATCH_ROWS = 1000;

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
    legalName: 'Юрлицо 1'
  },
  {
    entityId: 'entity_2',
    legalName: 'Юрлицо 2'
  }
];

const ENTITY_SHEET_KINDS = [
  { key: 'withdrawSheetName', kind: 'withdraw' },
  { key: 'introduceSheetName', kind: 'introduce' },
  { key: 'archiveSheetName', kind: 'archive' }
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
  'czReason',
  'czDocumentType',
  'czVersion',
  'fiasId',
  'kpp',
  'wbReportCountry',
  'exciseReportLookbackDays',
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
  'Причина вывода ЧЗ',
  'Тип первичного документа ЧЗ',
  'Версия CSV ЧЗ',
  'ФИАС / МОД',
  'КПП',
  'Страна отчёта WB',
  'Окно догрузки отчёта маркировки, дней',
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
  'czKi',
  'unitPrice',
  'priceCurrency',
  'fiscalDocNumber',
  'fiscalDocDate',
  'fiscalDriveNumber',
  'wbSaleDate',
  'wbSaleAmount',
  'wbRid',
  'wbMarkingOperationType',
  'fiscalDataSource',
  'fiscalDataUpdatedAt',
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
  'КИ для ЧЗ',
  'Цена за единицу',
  'Валюта цены',
  'Номер чека',
  'Дата чека',
  'Номер ФН',
  'Дата продажи WB',
  'Сумма продажи WB',
  'RID WB',
  'Тип операции маркировки WB',
  'Источник фискальных данных',
  'Дата обновления фискальных данных',
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
  czReason: ['Причина вывода ЧЗ', 'czReason'],
  czDocumentType: ['Тип первичного документа ЧЗ', 'czDocumentType'],
  czVersion: ['Версия CSV ЧЗ', 'czVersion'],
  fiasId: ['ФИАС / МОД', 'fiasId'],
  kpp: ['КПП', 'kpp'],
  wbReportCountry: ['Страна отчёта WB', 'wbReportCountry'],
  exciseReportLookbackDays: ['Окно догрузки отчёта маркировки, дней', 'exciseReportLookbackDays'],
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
  czKi: ['КИ для ЧЗ', 'czKi'],
  unitPrice: ['Цена за единицу', 'unitPrice'],
  priceCurrency: ['Валюта цены', 'priceCurrency'],
  fiscalDocNumber: ['Номер чека', 'fiscalDocNumber'],
  fiscalDocDate: ['Дата чека', 'fiscalDocDate'],
  fiscalDriveNumber: ['Номер ФН', 'fiscalDriveNumber'],
  wbSaleDate: ['Дата продажи WB', 'wbSaleDate'],
  wbSaleAmount: ['Сумма продажи WB', 'wbSaleAmount'],
  wbRid: ['RID WB', 'wbRid'],
  wbMarkingOperationType: ['Тип операции маркировки WB', 'wbMarkingOperationType'],
  fiscalDataSource: ['Источник фискальных данных', 'fiscalDataSource'],
  fiscalDataUpdatedAt: ['Дата обновления фискальных данных', 'fiscalDataUpdatedAt'],
  comment: ['Комментарий', 'comment']
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WB КИЗы')
    .addItem('1. Подготовить таблицу', 'setupWorkbook')
    .addItem('2. Загрузить данные за вчера', 'syncYesterdayManual')
    .addItem('3. Обновить WB API токен', 'updateWbTokenManual')
    .addItem('4. Догрузить чеки и цены WB', 'refreshFiscalDataManual')
    .addToUi();
}

function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('Public')
    .setTitle('КИЗы Честный знак')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getPublicDashboardData() {
  const entities = readSettings_()
    .filter(entity => entity.isActive)
    .map(entity => {
      const withdrawSheet = getOrCreateSheet_(entity.withdrawSheetName, DATA_HEADERS);
      const introduceSheet = getOrCreateSheet_(entity.introduceSheetName, DATA_HEADERS);
      const archiveSheet = getOrCreateSheet_(entity.archiveSheetName, DATA_HEADERS);
      return {
        id: entity.entityId,
        legalName: entity.legalName,
        inn: entity.inn,
        czReason: entity.czReason,
        czDocumentType: entity.czDocumentType,
        czVersion: entity.czVersion,
        fiasId: entity.fiasId,
        kpp: entity.kpp,
        lastSyncAt: entity.lastSyncAt || '',
        lastSyncStatus: entity.lastSyncStatus || '',
        withdraw: readDataObjects_(withdrawSheet).map(publicRow_),
        introduce: readDataObjects_(introduceSheet).map(publicRow_),
        archiveCount: readDataObjects_(archiveSheet).length
      };
    });
  return {
    updatedAt: now_(),
    maxBatchRows: MAX_PUBLIC_BATCH_ROWS,
    entities
  };
}

function confirmPublicWithdraw(entityId, keys) {
  const selectedKeys = normalizePublicKeys_(keys);
  if (!selectedKeys.length) throw new Error('Не выбраны строки для подтверждения вывода');
  if (selectedKeys.length > MAX_PUBLIC_BATCH_ROWS) throw new Error('Слишком большая партия: максимум ' + MAX_PUBLIC_BATCH_ROWS + ' строк');

  const entity = getEntityById_(entityId);
  const withdrawSheet = getOrCreateSheet_(entity.withdrawSheetName, DATA_HEADERS);
  const archiveSheet = getOrCreateSheet_(entity.archiveSheetName, DATA_HEADERS);
  const selectedSet = new Set(selectedKeys);
  const timestamp = now_();
  const withdrawRows = readDataObjects_(withdrawSheet);
  const archiveRows = readDataObjects_(archiveSheet);
  const keptWithdrawRows = [];
  const archiveByKey = new Map(archiveRows.map(row => [publicRowKey_(row), row]));
  let moved = 0;

  withdrawRows.forEach(row => {
    const key = publicRowKey_(row);
    if (!selectedSet.has(key)) {
      keptWithdrawRows.push(row);
      return;
    }
    row.status = 'archived';
    row.updatedAt = timestamp;
    archiveByKey.set(key, row);
    moved += 1;
  });

  rewriteDataSheet_(withdrawSheet, keptWithdrawRows);
  rewriteDataSheet_(archiveSheet, Array.from(archiveByKey.values()));
  return { moved, archiveCount: archiveByKey.size };
}

function confirmPublicIntroduce(entityId, keys) {
  const selectedKeys = normalizePublicKeys_(keys);
  if (!selectedKeys.length) throw new Error('Не выбраны строки для подтверждения ввода');
  if (selectedKeys.length > MAX_PUBLIC_BATCH_ROWS) throw new Error('Слишком большая партия: максимум ' + MAX_PUBLIC_BATCH_ROWS + ' строк');

  const entity = getEntityById_(entityId);
  const introduceSheet = getOrCreateSheet_(entity.introduceSheetName, DATA_HEADERS);
  const archiveSheet = getOrCreateSheet_(entity.archiveSheetName, DATA_HEADERS);
  const selectedSet = new Set(selectedKeys);
  const introduceRows = readDataObjects_(introduceSheet);
  const keptIntroduceRows = [];
  const introducedKiz = new Set();
  let introduced = 0;

  introduceRows.forEach(row => {
    const key = publicRowKey_(row);
    if (!selectedSet.has(key)) {
      keptIntroduceRows.push(row);
      return;
    }
    if (row.kiz) introducedKiz.add(String(row.kiz));
    introduced += 1;
  });

  const archiveRows = readDataObjects_(archiveSheet);
  const keptArchiveRows = archiveRows.filter(row => !introducedKiz.has(String(row.kiz || '')));
  rewriteDataSheet_(introduceSheet, keptIntroduceRows);
  rewriteDataSheet_(archiveSheet, keptArchiveRows);
  return {
    introduced,
    removedFromArchive: archiveRows.length - keptArchiveRows.length,
    archiveCount: keptArchiveRows.length
  };
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

function updateWbTokenManual() {
  setupWorkbook_();
  const ui = SpreadsheetApp.getUi();
  const entities = readSettings_().filter(entity => entity.isActive);
  if (!entities.length) {
    ui.alert('Нет активных юрлиц на листе "Настройки"');
    return null;
  }

  const entity = chooseEntityForTokenUpdate_(ui, entities);
  if (!entity) return null;

  const tokenPrompt = ui.prompt(
    'Обновить WB API токен',
    'Вставь новый токен для "' + entity.legalName + '". Нужны категории Marketplace и Аналитика.',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenPrompt.getSelectedButton() !== ui.Button.OK) return null;

  const token = String(tokenPrompt.getResponseText() || '').trim();
  if (!token) {
    ui.alert('Токен пустой. Старый токен не изменён.');
    return null;
  }

  const check = checkWbToken_(token);
  if (!check.ok) {
    ui.alert('Токен не прошёл проверку. Старый токен не изменён.\n\n' + check.errors.join('\n'));
    return { updated: false, errors: check.errors };
  }

  writeWbToken_(entity.entityId, token);
  updateSettingsSyncStatus_(entity.entityId, 'WB токен обновлён и проверен: Marketplace + Аналитика');
  ui.alert('Готово: WB токен обновлён и проверен для "' + entity.legalName + '".');
  return { updated: true, entityId: entity.entityId };
}

function chooseEntityForTokenUpdate_(ui, entities) {
  if (entities.length === 1) return entities[0];
  const list = entities.map(entity => entity.entityId + ' — ' + entity.legalName).join('\n');
  const prompt = ui.prompt(
    'Для какого юрлица обновить токен?',
    'Введи ID юрлица из списка:\n' + list,
    ui.ButtonSet.OK_CANCEL
  );
  if (prompt.getSelectedButton() !== ui.Button.OK) return null;
  const value = String(prompt.getResponseText() || '').trim().toLowerCase();
  const entity = entities.find(item =>
    String(item.entityId || '').toLowerCase() === value ||
    String(item.legalName || '').toLowerCase() === value
  );
  if (!entity) ui.alert('Юрлицо не найдено. Токен не изменён.');
  return entity || null;
}

function checkWbToken_(token) {
  const errors = [];
  const period = getTodayPeriod_();
  try {
    wbFetchJson_(
      'https://marketplace-api.wildberries.ru/api/v3/orders?limit=1&next=0&dateFrom=' + encodeURIComponent(period.fromUnix),
      token
    );
  } catch (err) {
    errors.push('Marketplace: ' + err.message);
  }

  try {
    const url = 'https://seller-analytics-api.wildberries.ru/api/v1/analytics/excise-report'
      + '?dateFrom=' + encodeURIComponent(period.syncDate)
      + '&dateTo=' + encodeURIComponent(period.syncDate);
    wbPostJson_(url, token, { countries: ['RU'] });
  } catch (err) {
    errors.push('Аналитика: ' + err.message);
  }

  return { ok: errors.length === 0, errors };
}

function writeWbToken_(entityId, token) {
  const sheet = getOrCreateSheet_(SHEETS.settings, SETTINGS_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const entityIndex = findColumnIndex_(headers, SETTINGS_ALIASES.entityId);
  const tokenIndex = findColumnIndex_(headers, SETTINGS_ALIASES.wbToken);
  if (entityIndex === -1 || tokenIndex === -1) throw new Error('Не найдены колонки ID юрлица или WB API токен');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][entityIndex]) !== entityId) continue;
    sheet.getRange(i + 1, tokenIndex + 1).setValue(token);
    return;
  }
  throw new Error('Юрлицо не найдено: ' + entityId);
}

function refreshFiscalDataManual() {
  setupWorkbook_();
  const period = getTodayPeriod_();
  const entities = readSettings_().filter(entity => entity.isActive);
  let updatedEntities = 0;
  entities.forEach(entity => {
    validateEntity_(entity);
    const exciseRows = fetchWbExciseRowsSafely_(entity, period);
    updateExistingFiscalData_(entity, buildExciseIndex_(exciseRows));
    updatedEntities += 1;
  });
  SpreadsheetApp.getActive().toast('Чеки и цены WB догружены для юрлиц: ' + updatedEntities, 'WB КИЗы', 8);
  return updatedEntities;
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
    const exciseRows = fetchWbExciseRowsSafely_(entity, period);
    const exciseIndex = buildExciseIndex_(exciseRows);
    const loadedRows = fetchWbKizRows_(entity, period).map(row => enrichRowWithExcise_(row, exciseIndex));
    updateExistingFiscalData_(entity, exciseIndex);
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

function fetchWbExciseRowsSafely_(entity, period) {
  try {
    return fetchWbExciseRows_(entity, period);
  } catch (err) {
    appendError_(entity.entityId, 'fetchExciseReport', '', '', err.message, '');
    return [];
  }
}

function fetchWbExciseRows_(entity, period) {
  const reportPeriod = getExciseReportPeriod_(entity, period);
  const payload = {};
  if (entity.wbReportCountry) payload.countries = [entity.wbReportCountry];
  const url = 'https://seller-analytics-api.wildberries.ru/api/v1/analytics/excise-report'
    + '?dateFrom=' + encodeURIComponent(reportPeriod.dateFrom)
    + '&dateTo=' + encodeURIComponent(reportPeriod.dateTo);
  return extractExciseItems_(wbPostJson_(url, entity.wbToken, payload));
}

function getExciseReportPeriod_(entity, period) {
  const lookbackDays = Math.max(1, Math.min(90, Number(entity.exciseReportLookbackDays || 14) || 14));
  const from = new Date(period.to.getTime());
  from.setDate(from.getDate() - lookbackDays + 1);
  from.setHours(0, 0, 0, 0);
  return {
    dateFrom: Utilities.formatDate(from, TZ, 'yyyy-MM-dd'),
    dateTo: Utilities.formatDate(period.to, TZ, 'yyyy-MM-dd')
  };
}

function extractExciseItems_(response) {
  if (Array.isArray(response)) return response;
  const candidates = [
    response && response.data,
    response && response.data && response.data.data,
    response && response.data && response.data.items,
    response && response.data && response.data.report,
    response && response.report,
    response && response.items,
    response && response.result,
    response && response.rows
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) return candidates[i];
  }
  return [];
}

function buildExciseIndex_(items) {
  const index = { bySrid: {}, byKi: {} };
  items.forEach(item => {
    const normalized = normalizeExciseItem_(item);
    if (!normalized) return;
    if (normalized.srid && !index.bySrid[normalized.srid]) index.bySrid[normalized.srid] = normalized;
    if (normalized.czKi && !index.byKi[normalized.czKi]) index.byKi[normalized.czKi] = normalized;
    if (normalized.rawKi && !index.byKi[normalized.rawKi]) index.byKi[normalized.rawKi] = normalized;
  });
  return index;
}

function normalizeExciseItem_(item) {
  if (!item) return null;
  const rawKi = String(item.excise_short || item.exciseShort || item.kiz || item.excise || '').trim();
  const czKi = normalizeKiForCz_(rawKi);
  const srid = String(item.srid || '').trim();
  if (!rawKi && !srid) return null;
  return {
    rawKi,
    czKi,
    srid,
    rid: String(item.rid || '').trim(),
    price: item.price == null ? '' : String(item.price).trim(),
    currency: String(item.currency_name_short || item.currencyNameShort || item.currency || '').trim(),
    fiscalDocNumber: String(item.fiscal_doc_number || item.fiscalDocNumber || '').trim(),
    fiscalDocDate: formatWbDateOnly_(item.fiscal_dt || item.fiscalDt || ''),
    fiscalDriveNumber: String(item.fiscal_drive_number || item.fiscalDriveNumber || '').trim(),
    operationType: String(item.operation_type_id || item.operationTypeId || '').trim()
  };
}

function enrichRowWithExcise_(row, exciseIndex) {
  const matched = matchExciseForRow_(row, exciseIndex);
  if (!matched) {
    row.czKi = row.czKi || normalizeKiForCz_(row.kiz);
    return row;
  }
  const timestamp = now_();
  row.czKi = matched.czKi || row.czKi || normalizeKiForCz_(row.kiz);
  row.unitPrice = matched.price || row.unitPrice || '';
  row.priceCurrency = matched.currency || row.priceCurrency || '';
  row.fiscalDocNumber = matched.fiscalDocNumber || row.fiscalDocNumber || '';
  row.fiscalDocDate = matched.fiscalDocDate || row.fiscalDocDate || '';
  row.fiscalDriveNumber = matched.fiscalDriveNumber || row.fiscalDriveNumber || '';
  row.wbSaleDate = matched.fiscalDocDate || row.wbSaleDate || '';
  row.wbSaleAmount = matched.price || row.wbSaleAmount || '';
  row.wbRid = matched.rid || row.wbRid || '';
  row.wbMarkingOperationType = matched.operationType || row.wbMarkingOperationType || '';
  row.fiscalDataSource = 'WB excise-report';
  row.fiscalDataUpdatedAt = timestamp;
  row.updatedAt = timestamp;
  return row;
}

function matchExciseForRow_(row, exciseIndex) {
  const srid = String(row.srid || '').trim();
  if (srid && exciseIndex.bySrid[srid]) return exciseIndex.bySrid[srid];
  const czKi = normalizeKiForCz_(row.kiz);
  if (czKi && exciseIndex.byKi[czKi]) return exciseIndex.byKi[czKi];
  const rawKi = String(row.kiz || '').trim();
  if (rawKi && exciseIndex.byKi[rawKi]) return exciseIndex.byKi[rawKi];
  return null;
}

function updateExistingFiscalData_(entity, exciseIndex) {
  const withdrawSheet = getOrCreateSheet_(entity.withdrawSheetName, DATA_HEADERS);
  const rows = readDataObjects_(withdrawSheet);
  let changed = false;
  rows.forEach(row => {
    const before = JSON.stringify([
      row.czKi,
      row.unitPrice,
      row.fiscalDocNumber,
      row.fiscalDocDate,
      row.fiscalDriveNumber
    ]);
    enrichRowWithExcise_(row, exciseIndex);
    const after = JSON.stringify([
      row.czKi,
      row.unitPrice,
      row.fiscalDocNumber,
      row.fiscalDocDate,
      row.fiscalDriveNumber
    ]);
    if (before !== after) changed = true;
  });
  if (changed) rewriteDataSheet_(withdrawSheet, rows);
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
    czKi: normalizeKiForCz_(kiz),
    unitPrice: '',
    priceCurrency: '',
    fiscalDocNumber: '',
    fiscalDocDate: '',
    fiscalDriveNumber: '',
    wbSaleDate: '',
    wbSaleAmount: '',
    wbRid: '',
    wbMarkingOperationType: '',
    fiscalDataSource: '',
    fiscalDataUpdatedAt: '',
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

function rewriteDataSheet_(sheet, rows) {
  clearDataRows_(sheet);
  if (!rows.length) return;
  sheet.getRange(2, 1, rows.length, DATA_HEADERS.length)
    .setValues(rows.map(row => dataValues_(row)));
}

function publicRow_(row) {
  return {
    key: publicRowKey_(row),
    kiz: String(row.kiz || ''),
    czKi: String(row.czKi || normalizeKiForCz_(row.kiz) || ''),
    article: String(row.article || ''),
    barcode: String(row.barcode || ''),
    orderId: String(row.orderId || ''),
    srid: String(row.srid || ''),
    supplierStatus: String(row.supplierStatus || ''),
    wbStatus: String(row.wbStatus || ''),
    wbDate: formatMaybeDate_(row.wbDate),
    unitPrice: String(row.unitPrice || ''),
    priceCurrency: String(row.priceCurrency || ''),
    fiscalDocNumber: String(row.fiscalDocNumber || ''),
    fiscalDocDate: formatMaybeDate_(row.fiscalDocDate),
    fiscalDriveNumber: String(row.fiscalDriveNumber || ''),
    wbSaleDate: formatMaybeDate_(row.wbSaleDate),
    wbSaleAmount: String(row.wbSaleAmount || ''),
    wbRid: String(row.wbRid || ''),
    wbMarkingOperationType: String(row.wbMarkingOperationType || ''),
    fiscalDataSource: String(row.fiscalDataSource || ''),
    fiscalDataUpdatedAt: formatMaybeDate_(row.fiscalDataUpdatedAt),
    status: String(row.status || ''),
    source: String(row.source || ''),
    syncDate: formatMaybeDate_(row.syncDate),
    comment: String(row.comment || '')
  };
}

function publicRowKey_(row) {
  const dedupeKey = String(row.dedupeKey || '').trim();
  if (dedupeKey) return dedupeKey;
  return [
    row.kiz,
    row.orderId,
    row.operation,
    row.legalName
  ].map(value => String(value || '').trim()).join('|');
}

function normalizePublicKeys_(keys) {
  if (!Array.isArray(keys)) return [];
  return uniqueStrings_(keys.map(key => String(key || '').trim()).filter(Boolean));
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
      withdrawSheetName: buildEntitySheetName_(legalName, 'withdraw'),
      introduceSheetName: buildEntitySheetName_(legalName, 'introduce'),
      archiveSheetName: buildEntitySheetName_(legalName, 'archive'),
      apiMode: row.apiMode || 'fbs',
      lastSyncAt: row.lastSyncAt || '',
      lastSyncStatus: row.lastSyncStatus || '',
      czReason: row.czReason || 'Дистанционная продажа',
      czDocumentType: row.czDocumentType || 'Кассовый чек',
      czVersion: row.czVersion || '7',
      fiasId: row.fiasId || '',
      kpp: row.kpp || '',
      wbReportCountry: row.wbReportCountry || 'RU',
      exciseReportLookbackDays: row.exciseReportLookbackDays || '14',
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
      withdrawSheetName: buildEntitySheetName_(legalName, 'withdraw'),
      introduceSheetName: buildEntitySheetName_(legalName, 'introduce'),
      archiveSheetName: buildEntitySheetName_(legalName, 'archive'),
      apiMode: row.apiMode || 'fbs',
      lastSyncAt: row.lastSyncAt || '',
      lastSyncStatus: row.lastSyncStatus || '',
      czReason: row.czReason || 'Дистанционная продажа',
      czDocumentType: row.czDocumentType || 'Кассовый чек',
      czVersion: row.czVersion || '7',
      fiasId: row.fiasId || '',
      kpp: row.kpp || '',
      wbReportCountry: row.wbReportCountry || 'RU',
      exciseReportLookbackDays: row.exciseReportLookbackDays || '14',
      comment: row.comment || ''
    });
  });

  renameEntitySheetsFromSettings_(seedRows, rowsById);

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
    apiMode: String(row.apiMode || 'auto').trim() || 'auto',
    czReason: String(row.czReason || 'Дистанционная продажа').trim(),
    czDocumentType: String(row.czDocumentType || 'Кассовый чек').trim(),
    czVersion: String(row.czVersion || '7').trim(),
    fiasId: String(row.fiasId || '').trim(),
    kpp: String(row.kpp || '').trim(),
    wbReportCountry: String(row.wbReportCountry || 'RU').trim() || 'RU',
    exciseReportLookbackDays: String(row.exciseReportLookbackDays || '14').trim() || '14'
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
      withdrawSheetName: buildEntitySheetName_(row.legalName || row.entityId, 'withdraw'),
      introduceSheetName: buildEntitySheetName_(row.legalName || row.entityId, 'introduce'),
      archiveSheetName: buildEntitySheetName_(row.legalName || row.entityId, 'archive'),
      apiMode: String(row.apiMode || 'auto').trim() || 'auto',
      lastSyncAt: formatMaybeDate_(row.lastSyncAt),
      lastSyncStatus: String(row.lastSyncStatus || '').trim(),
      czReason: String(row.czReason || 'Дистанционная продажа').trim(),
      czDocumentType: String(row.czDocumentType || 'Кассовый чек').trim(),
      czVersion: String(row.czVersion || '7').trim(),
      fiasId: String(row.fiasId || '').trim(),
      kpp: String(row.kpp || '').trim(),
      wbReportCountry: String(row.wbReportCountry || 'RU').trim() || 'RU',
      exciseReportLookbackDays: String(row.exciseReportLookbackDays || '14').trim() || '14'
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

function getTodayPeriod_() {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(now);
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

function renameEntitySheetsFromSettings_(entities, oldRowsById) {
  const ss = SpreadsheetApp.getActive();
  entities.forEach(entity => {
    const oldRow = oldRowsById[entity.entityId] || {};
    const defaultEntity = getDefaultEntity_(entity.entityId);
    ENTITY_SHEET_KINDS.forEach(sheetKind => {
      const newName = entity[sheetKind.key];
      if (!newName || ss.getSheetByName(newName)) return;
      const aliases = uniqueStrings_([
        oldRow[sheetKind.key],
        entity.entityId ? entity.entityId + '_' + sheetKind.kind : '',
        defaultEntity ? buildEntitySheetName_(defaultEntity.legalName, sheetKind.kind) : ''
      ]);

      for (let i = 0; i < aliases.length; i++) {
        const oldName = aliases[i];
        if (!oldName || oldName === newName) continue;
        const oldSheet = ss.getSheetByName(oldName);
        if (!oldSheet) continue;
        oldSheet.setName(newName);
        return;
      }
    });
  });
}

function buildEntitySheetName_(legalName, kind) {
  const normalizedLegalName = String(legalName || 'Юрлицо').trim();
  if (kind === 'withdraw') return normalizedLegalName + ' - КИЗы к выводу';
  if (kind === 'introduce') return normalizedLegalName + ' - КИЗы к вводу';
  return normalizedLegalName + ' - Архив выведенных КИЗов';
}

function getDefaultEntity_(entityId) {
  const normalizedEntityId = String(entityId || '').trim();
  return DEFAULT_ENTITIES.find(entity => entity.entityId === normalizedEntityId) || null;
}

function uniqueStrings_(values) {
  const seen = {};
  return values
    .map(value => String(value || '').trim())
    .filter(value => {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
}

function normalizeKiForCz_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length >= 31 && text.slice(0, 2) === '01' && text.slice(16, 18) === '21') {
    return text.slice(0, 31);
  }
  return text;
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
  if (raw === 'fetchExciseReport') return 'Загрузка отчёта WB по маркировке';
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

function formatMaybeDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return formatDate_(value);
  }
  return String(value).trim();
}

function formatWbDateOnly_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text;
}
