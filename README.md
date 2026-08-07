# WB KIZ Daily Sync

Первый этап: только Google Таблица и Apps Script.

## Таблица

https://docs.google.com/spreadsheets/d/1Ol0SdvkxilSx5wnjwiUqWjDL6lpzWU8bGR5-xERWCe8/edit

## Запуск

1. Открыть таблицу.
2. `Расширения` -> `Apps Script`.
3. Вставить `Code.gs`.
4. Сохранить.
5. Обновить таблицу.
6. Меню `WB КИЗы` -> `1. Подготовить таблицу`.
7. На листе `settings` заполнить два юрлица: название, ИНН, WB token.
   - Для текущих FBS-заказов оставить `apiMode = fbs`.
8. Меню `WB КИЗы` -> `2. Загрузить данные за вчера`.
9. После успешной ручной проверки: `WB КИЗы` -> `3. Создать триггер 08:00`.

## Логика

- `settings` хранит настройки двух юрлиц.
- Для каждого юрлица создаются три листа:
  - `<entity>_withdraw` — КИЗы к выводу из оборота;
  - `<entity>_introduce` — КИЗы к вводу обратно в оборот;
  - `<entity>_archive` — КИЗы, которые уже выведены из оборота.
- `sync_log` хранит историю запусков.
- `errors` хранит ошибки WB/API/обработки.
- Дубли отсекаются по `entityId + operation + kiz + orderId`.
- Для FBS скрипт получает статусы через `POST /api/v3/orders/status`.
- КИЗы берутся из metadata через `POST /api/marketplace/v3/orders/meta`.
- `wbStatus = canceled_by_client` попадает во ввод обратно в оборот.
- КИЗ к вводу обратно добавляется только если он уже есть в архиве.
- Отмены продавца, отмены в первый час и брак пропускаются.
- Остальные заказы с найденным `sgtin` попадают в вывод из оборота, если этот КИЗ ещё не лежит в архиве.

## Будущий HTML

HTML-панель должна вызывать серверные функции Apps Script:

- `confirmWithdrawDone(entityId)` — после ручного вывода в Честном знаке переносит строки из `<entity>_withdraw` в `<entity>_archive`.
- `confirmIntroduceDone(entityId)` — после ручного ввода обратно очищает `<entity>_introduce` и удаляет эти КИЗы из `<entity>_archive`.
