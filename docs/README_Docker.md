# Docker — mvp-slavyanka

Контейнеризация проекта «Славянка Текстиль» MVP (Node.js + Express + SQLite) с помощью Docker.

## Что это

`Dockerfile` описывает образ контейнера: берём официальный образ `node:22-slim`,
устанавливаем зависимости, копируем код и запускаем `server.js`. Проект использует
встроенный модуль `node:sqlite`, поэтому SQLite-база создаётся автоматически при первом
запуске в папке `data/`.

## Предварительные требования

- Установленный **Docker Desktop**:
  https://www.docker.com/products/docker-desktop/
- После установки Docker Desktop **перезагрузить компьютер** (использует виртуализацию Windows).

Проверка установки:

```bash
docker --version
docker run hello-world
```

## Сборка образа

Из папки проекта (где лежит `Dockerfile`):

```bash
docker build -t mvp-slavyanka .
```

## Запуск контейнера

Без проброса портов контейнер будет недоступен с хоста, поэтому пробрасываем порт 4000:

```bash
docker run -p 4000:4000 mvp-slavyanka
```

Затем откройте http://localhost:4000

### Переменные окружения

Для уведомлений в Telegram (необязательно) передайте ключи через `-e`:

```bash
docker run -p 4000:4000 -e TELEGRAM_BOT_TOKEN=ваш_токен -e TELEGRAM_CHAT_ID=ваш_чат mvp-slavyanka
```

⚠️ Не вносите реальные токены в код и в git — только через переменные окружения.

### Сохранение базы (volume)

Чтобы база не терялась при пересоздании контейнера, смонтируйте том на `data/`:

```bash
docker run -p 4000:4000 -v mvp_slavyanka_data:/app/data mvp-slavyanka
```

## Основные команды

```bash
docker build -t mvp-slavyanka .          # сборка образа
docker images                            # список образов
docker run -p 4000:4000 mvp-slavyanka    # запуск контейнера
docker ps                                # список запущенных контейнеров
docker ps -a                             # все контейнеры
docker stop <id|name>                    # остановить контейнер
docker rm <id|name>                      # удалить контейнер
docker rmi mvp-slavyanka                 # удалить образ
```

## Структура Docker-файлов

```
mvp-slavyanka/
├── Dockerfile       # описание образа (node:22-slim, npm install, node server.js)
├── .dockerignore    # что НЕ попадает в образ (node_modules, .env, data, .git и т.д.)
└── README.md        # это описание
```
