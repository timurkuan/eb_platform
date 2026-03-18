# ЭО Платформа — Серверлік нұсқа

## Орнату

### 1. MySQL дерекқор
```sql
mysql -u root -p < schema.sql
```

### 2. Конфигурация
```bash
cp .env.example .env
# .env файлын өзгертіңіз:
# DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET
```

### 3. Іске қосу
```bash
npm install
npm start
# → http://localhost:3000
```

### Admin аккаунты (бірінші іске қосқанда автоматты жасалады)
- Email: admin@eo.kz  
- Пароль: admin123

## Орналастыру (production)

### Nginx config
```nginx
server {
    listen 80;
    server_name example.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 100M;
    }
}
```

### PM2 арқылы іске қосу
```bash
npm install -g pm2
pm2 start server.js --name eo-platform
pm2 save && pm2 startup
```

## API маршруттары

| Method | URL | Сипаттама |
|--------|-----|-----------|
| POST | /api/auth/register | Тіркелу |
| POST | /api/auth/login | Кіру |
| POST | /api/auth/logout | Шығу |
| GET | /api/auth/me | Ағымдағы пайдаланушы |
| GET | /api/ebooks | Пайдаланушының ЭО тізімі |
| POST | /api/ebooks | Жаңа ЭО сақтау |
| PUT | /api/ebooks/:id | ЭО жаңарту |
| GET | /api/ebooks/:id/html | ЭО HTML жүктеу |
| DELETE | /api/ebooks/:id | ЭО жою |
| GET | /api/admin/users | Барлық пайдаланушылар (admin) |
| PATCH | /api/admin/users/:id/activate | Белсендіру (admin) |
| PATCH | /api/admin/users/:id/block | Блоктау (admin) |
| PATCH | /api/admin/users/:id/unblock | Қалпына келтіру (admin) |
| PATCH | /api/admin/users/:id/limit | Лимит белгілеу (admin) |
| GET | /api/admin/ebooks | Барлық ЭО (admin) |
| GET | /api/admin/stats | Статистика (admin) |
