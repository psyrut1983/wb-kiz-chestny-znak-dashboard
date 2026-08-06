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
- `entity_1_data` и `entity_2_data` хранят нормализованные КИЗы.
- `sync_log` хранит историю запусков.
- `errors` хранит ошибки WB/API/обработки.
- Дубли отсекаются по `entityId + operation + kiz + orderId`.
